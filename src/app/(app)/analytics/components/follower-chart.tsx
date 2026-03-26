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
import { ChartTooltip } from "@/components/chart-tooltip";

interface Props {
  data: AnalyticsSummary["dailyStats"];
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
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.1)" }} />
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
