"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { AnalyticsSummary } from "@/lib/types";

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

type MetricKey = "impressions" | "engagements" | "newFollows" | "profileVisits" | "unfollows";
type ChartType = "line" | "bar";

const METRIC_CONFIG: Record<MetricKey, { label: string; color: string }> = {
  impressions: { label: "Impressions", color: "#3b82f6" },
  engagements: { label: "Engagements", color: "#f59e0b" },
  newFollows: { label: "New Follows", color: "#22c55e" },
  profileVisits: { label: "Profile Visits", color: "#a855f7" },
  unfollows: { label: "Unfollows", color: "#ef4444" },
};

const ALL_METRICS = Object.keys(METRIC_CONFIG) as MetricKey[];

interface Props {
  data: AnalyticsSummary["dailyStats"];
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !label) return null;

  // Parse as UTC midnight — dates are stored as UTC calendar days
  const date = new Date(`${label}T00:00:00.000Z`);
  const dayName = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const dateStr = `${dayName}, ${monthDay}`;

  return (
    <div className="rounded-lg border border-border/50 bg-background/70 p-3 shadow-lg backdrop-blur-sm">
      <p className="mb-2 text-xs font-medium text-foreground">{dateStr}</p>
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

export function DualAxisChart({ data }: Props) {
  const [metric1, setMetric1] = useState<MetricKey>("impressions");
  const [metric2, setMetric2] = useState<MetricKey>("engagements");
  const [chartType, setChartType] = useState<ChartType>("bar");

  const hasData = data && data.length > 0;
  const dualAxis = metric1 !== metric2;

  const cfg1 = METRIC_CONFIG[metric1];
  const cfg2 = METRIC_CONFIG[metric2];

  return (
    <Card>
      <CardContent className="p-4">
        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={metric1} onValueChange={(v) => setMetric1(v as MetricKey)}>
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

          <Select value={metric2} onValueChange={(v) => setMetric2(v as MetricKey)}>
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

          <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
            <Button
              variant={chartType === "line" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setChartType("line")}
            >
              Line
            </Button>
            <Button
              variant={chartType === "bar" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setChartType("bar")}
            >
              Bar
            </Button>
          </div>
        </div>

        {/* Chart */}
        {!hasData ? (
          <div className="flex h-80 items-center justify-center text-xs text-muted-foreground">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={data}
              margin={{ top: 4, right: dualAxis ? 16 : 0, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                width={55}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                stroke={cfg1.color}
              />
              {dualAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  width={40}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
                  }
                  stroke={cfg2.color}
                />
              )}
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.1)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />

              {/* Metric 1 */}
              {chartType === "line" ? (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey={metric1}
                  name={cfg1.label}
                  stroke={cfg1.color}
                  strokeWidth={2}
                  dot={false}
                />
              ) : (
                <Bar
                  yAxisId="left"
                  dataKey={metric1}
                  name={cfg1.label}
                  fill={cfg1.color}
                  fillOpacity={0.85}
                  radius={[2, 2, 0, 0]}
                />
              )}

              {/* Metric 2 (only if different) */}
              {dualAxis &&
                (chartType === "line" ? (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey={metric2}
                    name={cfg2.label}
                    stroke={cfg2.color}
                    strokeWidth={2}
                    dot={false}
                    strokeDasharray="4 2"
                  />
                ) : (
                  <Bar
                    yAxisId="right"
                    dataKey={metric2}
                    name={cfg2.label}
                    fill={cfg2.color}
                    fillOpacity={0.55}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
