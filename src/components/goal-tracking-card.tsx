"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import Link from "next/link";
import type { GoalTrackingData } from "@/lib/types";

interface GoalTrackingCardProps {
  goalData: GoalTrackingData | null;
  hasGoalConfig: boolean;
}

export function GoalTrackingCard({ goalData, hasGoalConfig }: GoalTrackingCardProps) {
  // No goal configured
  if (!hasGoalConfig) {
    return (
      <Card className="mx-auto w-full max-w-chat bg-transparent border-0 shadow-none">
        <CardContent className="flex items-center gap-3 p-0">
          <Target className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-1 items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No follower goal set</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings">Set goal</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Goal configured but no snapshot data yet
  if (!goalData) {
    return (
      <Card className="mx-auto w-full max-w-chat bg-transparent border-0 shadow-none">
        <CardContent className="flex items-center gap-3 p-0">
          <Target className="size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Collecting growth data… (at least 1 day needed)
          </p>
        </CardContent>
      </Card>
    );
  }

  const pct = Math.min(
    Math.round((goalData.currentFollowers / goalData.targetFollowers) * 100),
    100
  );
  const targetDateStr = new Date(goalData.targetDate).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const projectedDateStr = goalData.projectedDate
    ? new Date(goalData.projectedDate).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  const statusColor = goalData.onTrack
    ? "text-green-600 dark:text-green-400"
    : Math.abs(goalData.deviationDays) < 30
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-red-600 dark:text-red-400";

  const DeviationIcon =
    goalData.deviationDays > 0 ? TrendingUp : goalData.deviationDays < 0 ? TrendingDown : Minus;

  return (
    <Card className="mx-auto w-full max-w-chat bg-transparent border-0 shadow-none">
      <CardContent className="p-0 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">
              {goalData.currentFollowers.toLocaleString()} /{" "}
              {goalData.targetFollowers.toLocaleString()} followers
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{pct}%</span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>+{goalData.dailyAvgGrowth}/day (30d)</span>
          <div className={`flex items-center gap-1 ${statusColor}`}>
            <DeviationIcon className="size-3" />
            <span>
              {goalData.onTrack
                ? goalData.deviationDays > 0
                  ? `${goalData.deviationDays}d ahead`
                  : "on track"
                : `${Math.abs(goalData.deviationDays)}d behind`}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
          <span>Goal: {targetDateStr}</span>
          {projectedDateStr ? (
            <span>Projected: {projectedDateStr}</span>
          ) : (
            <span>No growth — projection unavailable</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
