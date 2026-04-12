"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { getRecentPostsWithSnapshots, getPostVelocity } from "@/app/actions/analytics";
import type { PostWithSnapshotSummary, PostVelocityData } from "@/lib/types";

type MetricKey = "impressions" | "likes" | "engagements" | "bookmarks" | "replies" | "reposts";

const METRIC_CONFIG: Record<MetricKey, { label: string; color: string }> = {
  impressions: { label: "Impressions", color: "#3b82f6" },
  engagements: { label: "Engagements", color: "#f59e0b" },
  likes: { label: "Likes", color: "#ef4444" },
  bookmarks: { label: "Bookmarks", color: "#22c55e" },
  replies: { label: "Replies", color: "#a855f7" },
  reposts: { label: "Reposts", color: "#06b6d4" },
};

const ALL_METRICS = Object.keys(METRIC_CONFIG) as MetricKey[];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || label === undefined) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-background/70 p-3 shadow-lg backdrop-blur-sm">
      <p className="mb-2 text-xs font-medium text-foreground">Day {label}</p>
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="text-xs text-muted-foreground">{entry.name}</span>
            <span className="ml-auto text-xs font-semibold text-foreground">
              {Number(entry.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PostVelocityChart() {
  const [posts, setPosts] = useState<PostWithSnapshotSummary[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string>("");
  const [velocityData, setVelocityData] = useState<PostVelocityData | null>(null);
  const [metric, setMetric] = useState<MetricKey>("impressions");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRecentPostsWithSnapshots(20).then((data) => {
      setPosts(data);
      setLoading(false);
    });
  }, []);

  function handlePostChange(postId: string) {
    setSelectedPostId(postId);
    setLoading(true);
    getPostVelocity(postId).then((data) => {
      setVelocityData(data);
      setLoading(false);
    });
  }

  const cfg = METRIC_CONFIG[metric];

  if (!loading && posts.length === 0) {
    return (
      <Card>
        <CardContent className="flex h-80 items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">
            Velocity data appears after posts are tracked for a few days
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={selectedPostId} onValueChange={handlePostChange}>
            <SelectTrigger className="h-8 w-64 text-xs">
              <SelectValue placeholder="Select a post…" />
            </SelectTrigger>
            <SelectContent>
              {posts.map((p) => (
                <SelectItem key={p.postId} value={p.postId} className="text-xs">
                  <span className="line-clamp-1">
                    {p.date} — {p.text}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_METRICS.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: METRIC_CONFIG[m].color }}
                    />
                    {METRIC_CONFIG[m].label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Chart */}
        {!selectedPostId ? (
          <div className="flex h-80 items-center justify-center text-xs text-muted-foreground">
            Select a post to see its engagement velocity
          </div>
        ) : loading ? (
          <div className="flex h-80 items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : !velocityData || velocityData.snapshots.length === 0 ? (
          <div className="flex h-80 items-center justify-center text-xs text-muted-foreground">
            No snapshot data for this post
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={velocityData.snapshots}
              margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="daysSincePost"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `D${v}`}
                label={{
                  value: "Days since post",
                  position: "insideBottom",
                  offset: -2,
                  fontSize: 11,
                }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                width={55}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey={metric}
                name={cfg.label}
                stroke={cfg.color}
                strokeWidth={2}
                dot={{ r: 3, fill: cfg.color }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
