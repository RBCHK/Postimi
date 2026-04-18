"use client";

import { useAnalytics } from "@/contexts/analytics-context";
import { ImportPanel } from "./components/import-panel";
import { StatsCards } from "./components/stats-cards";
import { DualAxisChart } from "./components/dual-axis-chart";
import { FollowerChart } from "./components/follower-chart";
import { PostingFrequencyChart } from "./components/posting-frequency-chart";
import { TopContentTable } from "./components/top-content-table";
import { EngagementHeatmap } from "./components/engagement-heatmap";
import { PostVelocityChart } from "./components/post-velocity-chart";
import { PeriodPicker } from "./components/period-picker";
import { SocialPlatformOverview } from "./components/social-platform-overview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText } from "lucide-react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { PLATFORM_CONFIG, type Platform } from "@/lib/types";

function XAnalyticsSection() {
  const { summary, isLoading } = useAnalytics();

  if (!summary && !isLoading) {
    return (
      <EmptyState
        icon={FileText}
        message="No X analytics yet"
        description="Import your X Analytics CSV files or connect the X API to see charts and insights"
        size="large"
      />
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-3">
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

          <EngagementHeatmap />
        </TabsContent>

        <TabsContent value="content" className="mt-4">
          <TopContentTable topPosts={summary.topPosts} topReplies={summary.topReplies} />
        </TabsContent>

        <TabsContent value="velocity" className="mt-4">
          <PostVelocityChart />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function AnalyticsView() {
  const { dateRange, connectedPlatforms, selectedPlatform, setSelectedPlatform } = useAnalytics();

  const visiblePlatforms: Platform[] = connectedPlatforms.length > 0 ? connectedPlatforms : ["X"];

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

      <Tabs value={selectedPlatform} onValueChange={(v) => setSelectedPlatform(v as Platform)}>
        <TabsList>
          {visiblePlatforms.map((p) => (
            <TabsTrigger key={p} value={p}>
              {PLATFORM_CONFIG[p].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {visiblePlatforms.map((p) => (
          <TabsContent key={p} value={p} className="mt-4">
            {p === "X" ? <XAnalyticsSection /> : <SocialPlatformOverview platform={p} />}
          </TabsContent>
        ))}
      </Tabs>
    </PageContainer>
  );
}
