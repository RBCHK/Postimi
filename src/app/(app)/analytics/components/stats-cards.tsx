"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { AnalyticsSummary } from "@/lib/types";

interface Props {
  summary: AnalyticsSummary;
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function StatsCards({ summary }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard
        label="Original Posts"
        value={summary.totalPosts}
        sub={`avg ${summary.avgPostImpressions} impr`}
      />
      <StatCard
        label="Replies"
        value={summary.totalReplies}
        sub={`avg ${summary.avgReplyImpressions} impr`}
      />
      <StatCard
        label="Net Followers"
        value={
          summary.netFollowerGrowth >= 0
            ? `+${summary.netFollowerGrowth}`
            : summary.netFollowerGrowth
        }
        sub={`+${summary.totalNewFollows} / -${summary.totalUnfollows}`}
      />
      <StatCard
        label="Engagement Rate"
        value={`${summary.avgEngagementRate}%`}
        sub={
          summary.avgEngagementRate >= 2.5
            ? "strong"
            : summary.avgEngagementRate >= 1
              ? "average"
              : "low"
        }
      />
      <StatCard
        label="Profile Visits / Day"
        value={summary.avgProfileVisitsPerDay}
        sub={`${summary.periodDays} days`}
      />
    </div>
  );
}
