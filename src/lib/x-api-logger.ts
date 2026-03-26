import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import type { XApiResourceType } from "@/generated/prisma";

/**
 * Cost per resource in cents (from X API pay-per-use pricing, March 2026)
 */
const COST_PER_RESOURCE: Record<XApiResourceType, number> = {
  POST_READ: 0.5, // $0.005
  POST_WRITE: 50.0, // $0.50
  USER_READ: 1.0, // $0.010
  TREND_READ: 1.0, // $0.010
};

interface LogXApiCallParams {
  endpoint: string;
  resourceType: XApiResourceType;
  resourceCount: number;
  callerJob?: string;
  userId?: string;
  httpStatus?: number;
  error?: string;
}

/**
 * Fire-and-forget X API call logger.
 * Calculates cost and writes to XApiCallLog.
 * Never throws — catches errors and reports to Sentry.
 */
export function logXApiCall(params: LogXApiCallParams): void {
  const costCents = params.resourceCount * COST_PER_RESOURCE[params.resourceType];

  prisma.xApiCallLog
    .create({
      data: {
        endpoint: params.endpoint,
        resourceType: params.resourceType,
        resourceCount: params.resourceCount,
        costCents,
        callerJob: params.callerJob,
        userId: params.userId,
        httpStatus: params.httpStatus,
        error: params.error?.slice(0, 2000),
      },
    })
    .catch((err) => {
      Sentry.captureException(err);
    });
}
