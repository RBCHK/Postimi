import { prisma } from "@/lib/prisma";

// ADR-008 / C1 refactor: `getScheduleConfig` is called from both
// authenticated action paths and cron. The userId-taking version lives
// here; the wrapper in src/app/actions/schedule.ts enforces auth for
// browser callers.

export type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type SlotRow = {
  id: string;
  time: string;
  days: Record<DayKey, boolean>;
};

export type ContentSchedule = { slots: SlotRow[] };

export type ScheduleConfig = {
  replies: ContentSchedule;
  posts: ContentSchedule;
  threads: ContentSchedule;
  articles: ContentSchedule;
  quotes: ContentSchedule;
};

export async function getScheduleConfig(userId: string): Promise<ScheduleConfig | null> {
  const row = await prisma.strategyConfig.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!row || !row.scheduleConfig) return null;
  return row.scheduleConfig as ScheduleConfig;
}
