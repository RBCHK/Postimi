"use client";

import { useAnalytics } from "@/contexts/analytics-context";
import { ImportPanel } from "./components/import-panel";
import { StatsCards } from "./components/stats-cards";
import { DualAxisChart } from "./components/dual-axis-chart";
import { FollowerChart } from "./components/follower-chart";
import { PostingFrequencyChart } from "./components/posting-frequency-chart";
import { TopContentTable } from "./components/top-content-table";
import { EngagementHeatmap } from "./components/engagement-heatmap";
import { GoalProgressChart } from "./components/goal-progress-chart";
import { PeriodPicker } from "./components/period-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText } from "lucide-react";
import { PageContainer } from "@/components/page-container";

export function AnalyticsView() {
  const { summary, goalChartData, dateRange, isLoading } = useAnalytics();

  return (
    <PageContainer className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Analytics</h1>
          {dateRange && (
            <p className="text-xs text-muted-foreground">
              {dateRange.from.toISOString().split("T")[0]} —{" "}
              {dateRange.to.toISOString().split("T")[0]}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <PeriodPicker />
          <ImportPanel />
        </div>
      </div>

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

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Account Overview</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-3">
              <DualAxisChart data={summary.dailyStats} />

              <div className="grid gap-3 md:grid-cols-2">
                <FollowerChart data={summary.dailyStats} />
                <PostingFrequencyChart data={summary.postsByDay} />
              </div>

              {goalChartData && <GoalProgressChart data={goalChartData} />}

              <EngagementHeatmap />
            </TabsContent>

            <TabsContent value="content" className="mt-4">
              <TopContentTable topPosts={summary.topPosts} topReplies={summary.topReplies} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageContainer>
  );
}
