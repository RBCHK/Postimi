"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import type { GoalChartData } from "@/lib/types";

interface Props {
  data: GoalChartData;
}

interface ChartPoint {
  date: string;
  actual?: number;
  required?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length || !label) return null;

  const [year, month, day] = label.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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

function formatXTick(value: string): string {
  const [, month, day] = value.split("-").map(Number);
  return `${month}/${day}`;
}

function formatYTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function GoalProgressChart({ data }: Props) {
  const { snapshots, targetFollowers, targetDate, firstFollowers, firstDate } = data;

  // Build combined data: actual snapshots + required pace points
  // Required pace: linear from (firstDate, firstFollowers) to (targetDate, targetFollowers)
  const firstMs = new Date(firstDate).getTime();
  const targetMs = new Date(targetDate).getTime();
  const totalMs = targetMs - firstMs;
  const growthNeeded = targetFollowers - firstFollowers;

  const requiredAtDate = (dateStr: string) => {
    const ms = new Date(dateStr).getTime();
    if (ms <= firstMs) return firstFollowers;
    if (ms >= targetMs) return targetFollowers;
    const progress = (ms - firstMs) / totalMs;
    return Math.round(firstFollowers + growthNeeded * progress);
  };

  // Merge actual snapshot dates + target date
  const allDates = Array.from(
    new Set([...snapshots.map((s) => s.date), targetDate])
  ).sort();

  const snapshotMap = new Map(snapshots.map((s) => [s.date, s.followers]));

  const chartData: ChartPoint[] = allDates.map((date) => {
    const point: ChartPoint = { date };
    if (snapshotMap.has(date)) point.actual = snapshotMap.get(date);
    // Show required pace across all dates up to target
    if (date <= targetDate) point.required = requiredAtDate(date);
    return point;
  });

  const yMin = Math.max(0, Math.min(firstFollowers, ...snapshots.map((s) => s.followers)) - 5);
  const yMax = Math.ceil(targetFollowers * 1.05);

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-medium">Goal Progress</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={formatXTick}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              width={38}
              tickFormatter={formatYTick}
              domain={[yMin, yMax]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="line"
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            <ReferenceLine
              y={targetFollowers}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: targetFollowers.toLocaleString(), position: "right", fontSize: 10, fill: "#f59e0b" }}
            />
            <Line
              type="monotone"
              dataKey="required"
              name="Required pace"
              stroke="#6b7280"
              strokeDasharray="5 3"
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="#3b82f6"
              dot={{ r: 3, fill: "#3b82f6" }}
              strokeWidth={2}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
