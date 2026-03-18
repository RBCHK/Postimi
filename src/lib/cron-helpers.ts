import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CronJobStatus, Prisma } from "@/generated/prisma";

interface CronResult {
  status: "SUCCESS" | "PARTIAL" | "FAILURE";
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Wraps a cron route handler with:
 * 1. Bearer token auth
 * 2. CronJobConfig enabled check (missing row = enabled)
 * 3. CronJobRun logging (duration, status, result)
 *
 * Uses `after()` from next/server to guarantee DB writes complete
 * on Vercel serverless before the function freezes.
 */
export function withCronLogging(
  jobName: string,
  handler: (req: NextRequest) => Promise<CronResult>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    // 1. Auth: Bearer token
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Check if job is enabled (missing row = enabled)
    const config = await prisma.cronJobConfig.findUnique({
      where: { jobName },
      select: { enabled: true },
    });

    if (config && !config.enabled) {
      after(async () => {
        try {
          await prisma.cronJobRun.create({
            data: {
              jobName,
              status: "SKIPPED" as CronJobStatus,
              durationMs: 0,
              resultJson: { reason: "Job disabled in CronJobConfig" },
            },
          });
        } catch (err) {
          Sentry.captureException(err);
        }
      });

      return NextResponse.json({ ok: false, skipped: true, reason: "Job disabled" });
    }

    // 3. Run handler with timing
    const startedAt = Date.now();
    let result: CronResult;

    try {
      result = await handler(req);
    } catch (err) {
      Sentry.captureException(err);
      const errorMsg = err instanceof Error ? err.message : String(err);

      after(async () => {
        try {
          await prisma.cronJobRun.create({
            data: {
              jobName,
              status: "FAILURE" as CronJobStatus,
              durationMs: Date.now() - startedAt,
              error: errorMsg.slice(0, 2000),
              startedAt: new Date(startedAt),
            },
          });
        } catch (logErr) {
          Sentry.captureException(logErr);
        }
      });

      return NextResponse.json({ ok: false, error: errorMsg }, { status: 500 });
    }

    // 4. Log successful/partial run
    const durationMs = Date.now() - startedAt;

    after(async () => {
      try {
        await prisma.cronJobRun.create({
          data: {
            jobName,
            status: result.status as CronJobStatus,
            durationMs,
            resultJson: (result.data as Prisma.InputJsonValue) ?? undefined,
            error: result.error?.slice(0, 2000) ?? undefined,
            startedAt: new Date(startedAt),
          },
        });
      } catch (err) {
        Sentry.captureException(err);
      }
    });

    return NextResponse.json({
      ok: result.status !== "FAILURE",
      status: result.status,
      durationMs,
      ...result.data,
    });
  };
}
