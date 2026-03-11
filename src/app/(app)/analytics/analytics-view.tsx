"use client";

import { useAnalytics } from "@/contexts/analytics-context";
import { ImportPanel } from "./components/import-panel";
import { StatsCards } from "./components/stats-cards";
import { ImpressionsChart } from "./components/impressions-chart";
import { FollowerChart } from "./components/follower-chart";
import { EngagementChart } from "./components/engagement-chart";
import { ProfileVisitsChart } from "./components/profile-visits-chart";
import { PostingFrequencyChart } from "./components/posting-frequency-chart";
import { TopContentTable } from "./components/top-content-table";
import { FileText } from "lucide-react";

export function AnalyticsView() {
  const { summary, dateRange, isLoading } = useAnalytics();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Analytics</h1>
          {dateRange && (
            <p className="text-xs text-muted-foreground">
              {dateRange.from.toISOString().split("T")[0]} — {dateRange.to.toISOString().split("T")[0]}
            </p>
          )}
        </div>
        <ImportPanel />
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}

      {!summary && !isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">No analytics data yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Import your X Analytics CSV files to see charts and insights
          </p>
        </div>
      )}

      {summary && (
        <>
          <StatsCards summary={summary} />

          <div className="grid gap-3 md:grid-cols-2">
            <ImpressionsChart data={summary.dailyStats} />
            <FollowerChart data={summary.dailyStats} />
            <EngagementChart data={summary.dailyStats} />
            <ProfileVisitsChart data={summary.dailyStats} />
          </div>

          <PostingFrequencyChart data={summary.postsByDay} />

          <TopContentTable
            topPosts={summary.topPosts}
            topReplies={summary.topReplies}
          />
        </>
      )}
    </div>
  );
}
