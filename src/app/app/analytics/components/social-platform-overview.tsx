"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ChartTooltip } from "@/components/chart-tooltip";
import { PLATFORM_CONFIG, type Platform } from "@/lib/types";
import {
  getSocialAnalyticsDateRange,
  getSocialAnalyticsSummary,
  type SocialAnalyticsSummary,
} from "@/app/actions/social-analytics";
import { useAnalytics } from "@/contexts/analytics-context";

interface Props {
  platform: Platform;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-lg font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const numberFmt = new Intl.NumberFormat("en-US");

export function SocialPlatformOverview({ platform }: Props) {
  const { socialRefreshToken } = useAnalytics();
  const [summary, setSummary] = useState<SocialAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const range = await getSocialAnalyticsDateRange(platform);
        if (cancelled) return;
        if (!range) {
          setHasData(false);
          setSummary(null);
          return;
        }
        setHasData(true);
        const data = await getSocialAnalyticsSummary(platform, range.from, range.to);
        if (!cancelled) setSummary(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [platform, socialRefreshToken]);

  const label = PLATFORM_CONFIG[platform].label;

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        Loading {label} analytics…
      </div>
    );
  }

  if (hasData === false || !summary) {
    const description =
      platform === "LINKEDIN"
        ? "Upload your LinkedIn xlsx export from Analytics → Content/Audience to see metrics here."
        : platform === "THREADS"
          ? "Connect Threads and run the weekly import to see metrics here."
          : "No data yet.";
    return (
      <EmptyState
        icon={FileText}
        message={`No ${label} analytics yet`}
        description={description}
        size="large"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Posts"
          value={numberFmt.format(summary.totalPosts)}
          hint={`${summary.periodDays} days`}
        />
        <StatCard
          label="Impressions"
          value={numberFmt.format(summary.totalImpressions)}
          hint={`avg ${numberFmt.format(summary.avgPostImpressions)} / post`}
        />
        <StatCard
          label="Engagement rate"
          value={`${summary.avgEngagementRate}%`}
          hint={`${numberFmt.format(summary.totalEngagements)} engagements`}
        />
        <StatCard
          label="Followers"
          value={summary.latestFollowers !== null ? numberFmt.format(summary.latestFollowers) : "—"}
          hint={
            summary.netFollowerGrowth >= 0
              ? `+${numberFmt.format(summary.netFollowerGrowth)} over period`
              : `${numberFmt.format(summary.netFollowerGrowth)} over period`
          }
        />
      </div>

      {summary.followersSeries.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">Followers trend</p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={summary.followersSeries}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.1)" }} />
                <Area
                  type="monotone"
                  dataKey="followersCount"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.2}
                  name="Followers"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {summary.postsByDay.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">Posts per day</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={summary.postsByDay}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.1)" }} />
                <Bar dataKey="posts" fill="#8b5cf6" name="Posts" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {summary.topPosts.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">Top posts</p>
            <div className="space-y-2">
              {summary.topPosts.map((post) => (
                <div
                  key={post.externalPostId}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{post.text || "(no text)"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {post.postedAt} · {post.postType}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <p className="font-medium">{numberFmt.format(post.impressions)} impressions</p>
                    <p className="text-muted-foreground">
                      {numberFmt.format(post.engagements)} engagements
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
