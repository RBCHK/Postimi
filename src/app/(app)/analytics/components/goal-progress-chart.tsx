"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  expected?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length || !label) return null;

  // Parse as UTC midnight — dates are stored as UTC calendar days
  const date = new Date(`${label}T00:00:00.000Z`);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
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
  const [year, month] = value.split("-").map(Number);
  return `${month}/${String(year).slice(2)}`;
}

function formatYTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/**
 * Mid-point monthly growth rates by follower tier (industry benchmarks):
 * 0–1k: 10–30% → 20%
 * 1k–10k: 5–15% → 10%
 * 10k–100k: 2–8% → 5%
 * 100k+: 1–5% → 3%
 */
function monthlyGrowthRate(followers: number): number {
  if (followers < 1000) return 0.2;
  if (followers < 10000) return 0.1;
  if (followers < 100000) return 0.05;
  return 0.03;
}

/** Compute expected growth month-by-month until `endDate` (inclusive). */
function computeExpectedGrowth(
  startFollowers: number,
  startDate: string,
  endDate: string
): { date: string; expected: number }[] {
  const result: { date: string; expected: number }[] = [];
  const end = new Date(endDate);

  result.push({ date: startDate, expected: startFollowers });

  let current = new Date(startDate);
  let followers = startFollowers;

  while (true) {
    const next = new Date(current);
    next.setMonth(next.getMonth() + 1);
    if (next > end) break;

    followers = Math.round(followers * (1 + monthlyGrowthRate(followers)));
    result.push({ date: next.toISOString().split("T")[0], expected: followers });
    current = next;
  }

  // Partial month remainder to endDate
  const daysLeft = (end.getTime() - current.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft > 1) {
    const partial = Math.round(followers * (1 + monthlyGrowthRate(followers) * (daysLeft / 30)));
    result.push({ date: endDate, expected: partial });
  }

  return result;
}

/**
 * Compute expected growth month-by-month until `targetFollowers` is reached.
 * Returns the points AND the date when the goal is reached.
 */
function computeExpectedUntilGoal(
  startFollowers: number,
  startDate: string,
  targetFollowers: number
): { points: { date: string; expected: number }[]; goalDate: string | null } {
  const points: { date: string; expected: number }[] = [];
  points.push({ date: startDate, expected: startFollowers });

  let current = new Date(startDate);
  let followers = startFollowers;
  const MAX_MONTHS = 360; // safety cap: 30 years

  for (let i = 0; i < MAX_MONTHS; i++) {
    if (followers >= targetFollowers) {
      return { points, goalDate: current.toISOString().split("T")[0] };
    }
    const next = new Date(current);
    next.setMonth(next.getMonth() + 1);
    followers = Math.round(followers * (1 + monthlyGrowthRate(followers)));
    const dateStr = next.toISOString().split("T")[0];
    points.push({ date: dateStr, expected: followers });
    current = next;
  }

  return { points, goalDate: null };
}

export function GoalProgressChart({ data }: Props) {
  const { snapshots, targetFollowers, targetDate, firstFollowers, firstDate } = data;
  const [showFullPath, setShowFullPath] = useState(false);

  // Required pace: linear from (firstDate, firstFollowers) to (targetDate, targetFollowers)
  const firstMs = new Date(firstDate).getTime();
  const targetMs = new Date(targetDate).getTime();
  const totalMs = targetMs - firstMs;
  const growthNeeded = targetFollowers - firstFollowers;

  const requiredAtDate = (dateStr: string) => {
    const ms = new Date(dateStr).getTime();
    if (ms <= firstMs) return firstFollowers;
    if (ms >= targetMs) return targetFollowers;
    return Math.round(firstFollowers + growthNeeded * ((ms - firstMs) / totalMs));
  };

  // Expected growth — either up to targetDate or until goal is reached
  const { points: fullExpectedPoints, goalDate } = computeExpectedUntilGoal(
    firstFollowers,
    firstDate,
    targetFollowers
  );

  const expectedPoints = showFullPath
    ? fullExpectedPoints
    : computeExpectedGrowth(firstFollowers, firstDate, targetDate);

  const expectedMap = new Map(expectedPoints.map((p) => [p.date, p.expected]));

  const chartEndDate = showFullPath ? (goalDate ?? targetDate) : targetDate;

  // Merge all dates
  const allDates = Array.from(
    new Set([
      ...snapshots.map((s) => s.date),
      ...expectedPoints.map((p) => p.date),
      targetDate,
      chartEndDate,
    ])
  ).sort();

  const snapshotMap = new Map(snapshots.map((s) => [s.date, s.followers]));

  const chartData: ChartPoint[] = allDates.map((date) => {
    const point: ChartPoint = { date };
    if (snapshotMap.has(date)) point.actual = snapshotMap.get(date);
    if (date <= targetDate) point.required = requiredAtDate(date);
    if (expectedMap.has(date)) point.expected = expectedMap.get(date);
    return point;
  });

  const yMin = Math.max(0, Math.min(firstFollowers, ...snapshots.map((s) => s.followers)) - 5);
  const yMax = Math.ceil(targetFollowers * 1.05);

  // Format goal date for display
  const goalDateLabel = goalDate
    ? new Date(goalDate).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">Goal Progress</p>
          <Button
            variant={showFullPath ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setShowFullPath((v) => !v)}
          >
            {showFullPath ? "Show goal window" : "Show full path"}
          </Button>
        </div>

        {showFullPath && goalDateLabel && (
          <p className="mb-2 text-[11px] text-emerald-600 dark:text-emerald-400">
            Expected to reach {targetFollowers.toLocaleString()} by <strong>{goalDateLabel}</strong>{" "}
            at benchmark rates
          </p>
        )}

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
            <Legend iconType="line" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <ReferenceLine
              y={targetFollowers}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: targetFollowers.toLocaleString(),
                position: "right",
                fontSize: 10,
                fill: "#f59e0b",
              }}
            />
            {/* Goal deadline marker */}
            <ReferenceLine
              x={targetDate}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
            />
            {/* Required pace: linear to targetDate */}
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
            {/* Expected growth: benchmark compound rates by follower tier */}
            <Line
              type="monotone"
              dataKey="expected"
              name="Expected (benchmark)"
              stroke="#10b981"
              strokeDasharray="3 2"
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
            {/* Actual followers from snapshots */}
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
        <p className="mt-2 text-[10px] text-muted-foreground">
          Benchmarks: 20%/mo (0–1k) · 10%/mo (1–10k) · 5%/mo (10–100k) · 3%/mo (100k+)
        </p>
      </CardContent>
    </Card>
  );
}
