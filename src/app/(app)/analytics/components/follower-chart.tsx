"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { AnalyticsSummary } from "@/lib/types";

interface Props {
  data: AnalyticsSummary["dailyStats"];
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
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

export function FollowerChart({ data }: Props) {
  const hasData = data && data.length > 0;
  const hasFollows = hasData && data.some((d) => d.newFollows > 0 || d.unfollows > 0);

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-medium">Follower Dynamics</p>
        {!hasData ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            No data available
          </div>
        ) : !hasFollows ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            No follow/unfollow data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} width={30} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.1)" }} />
              <Area
                type="monotone"
                dataKey="newFollows"
                stackId="1"
                stroke="#22c55e"
                fill="#22c55e"
                fillOpacity={0.3}
                name="New follows"
              />
              <Area
                type="monotone"
                dataKey="unfollows"
                stackId="2"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.3}
                name="Unfollows"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
