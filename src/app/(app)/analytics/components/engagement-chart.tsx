"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { AnalyticsSummary } from "@/lib/types";

interface Props {
  data: AnalyticsSummary["dailyStats"];
}

export function EngagementChart({ data }: Props) {
  const hasData = data && data.length > 0;
  const chartData = hasData
    ? data.map((d) => ({
        date: d.date,
        rate: d.impressions > 0
          ? Math.round((d.engagements / d.impressions) * 10000) / 100
          : 0,
      }))
    : [];
  const hasRates = chartData.some((d) => d.rate > 0);

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-medium">Engagement Rate (%)</p>
        {!hasData ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            No data available
          </div>
        ) : !hasRates ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            No engagement data (check impressions)
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} width={40} unit="%" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                name="Engagement"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
