"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { AnalyticsSummary } from "@/lib/types";

interface Props {
  data: AnalyticsSummary["postsByDay"];
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

export function PostingFrequencyChart({ data }: Props) {
  const hasData = data && data.length > 0;
  const hasContent = hasData && data.some((d) => d.posts > 0 || d.replies > 0);

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-medium">Posting Frequency</p>
        {!hasData ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            No data available
          </div>
        ) : !hasContent ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            No posts or replies data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} width={30} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.1)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="posts" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} name="Posts" />
              <Bar
                dataKey="replies"
                stackId="a"
                fill="#f97316"
                radius={[2, 2, 0, 0]}
                name="Replies"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
