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
import { PostVelocityChart } from "./components/post-velocity-chart";
import { PeriodPicker } from "./components/period-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText } from "lucide-react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export function AnalyticsView() {
  const { summary, goalChartData, dateRange, isLoading } = useAnalytics();

  return (
    <PageContainer className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle={
          dateRange
            ? `${dateRange.from.toISOString().split("T")[0]} — ${dateRange.to.toISOString().split("T")[0]}`
            : undefined
        }
      >
        <PeriodPicker />
        <ImportPanel />
      </PageHeader>

      {!summary && !isLoading && (
        <EmptyState
          icon={FileText}
          message="No analytics data yet"
          description="Import your X Analytics CSV files to see charts and insights"
          size="large"
        />
      )}

      {summary && (
        <>
          <StatsCards summary={summary} />

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Account Overview</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="velocity">Post Velocity</TabsTrigger>
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

            <TabsContent value="velocity" className="mt-4">
              <PostVelocityChart />
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageContainer>
  );
}
