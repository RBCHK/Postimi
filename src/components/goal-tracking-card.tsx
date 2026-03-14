"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { updateGoalConfig } from "@/app/actions/schedule";
import type { GoalTrackingData } from "@/lib/types";

interface GoalTrackingCardProps {
  goalData: GoalTrackingData | null;
  hasGoalConfig: boolean;
}

export function GoalTrackingCard({ goalData, hasGoalConfig }: GoalTrackingCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetFollowers, setTargetFollowers] = useState("10000");
  const [targetDate, setTargetDate] = useState("2026-12-31");
  const [saving, setSaving] = useState(false);

  async function handleSaveGoal() {
    setSaving(true);
    try {
      await updateGoalConfig({
        targetFollowers: parseInt(targetFollowers),
        targetDate: new Date(`${targetDate}T00:00:00.000Z`),
      });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  // No goal configured
  if (!hasGoalConfig) {
    return (
      <>
        <Card className="mx-auto w-full max-w-chat bg-transparent border-0 shadow-none">
          <CardContent className="flex items-center gap-3 p-4">
            <Target className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-1 items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">No follower goal set</p>
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                Set goal
              </Button>
            </div>
          </CardContent>
        </Card>
        <GoalDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          targetFollowers={targetFollowers}
          targetDate={targetDate}
          onTargetFollowersChange={setTargetFollowers}
          onTargetDateChange={setTargetDate}
          onSave={handleSaveGoal}
          saving={saving}
        />
      </>
    );
  }

  // Goal configured but no snapshot data yet
  if (!goalData) {
    return (
      <Card className="mx-auto w-full max-w-chat bg-transparent border-0 shadow-none">
        <CardContent className="flex items-center gap-3 p-4">
          <Target className="size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Collecting growth data... (at least 1 day needed)</p>
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
  });
  const projectedDateStr = goalData.projectedDate
    ? new Date(goalData.projectedDate).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const statusColor = goalData.onTrack
    ? "text-green-600 dark:text-green-400"
    : Math.abs(goalData.deviationDays) < 30
    ? "text-yellow-600 dark:text-yellow-400"
    : "text-red-600 dark:text-red-400";

  const DeviationIcon = goalData.deviationDays > 0
    ? TrendingUp
    : goalData.deviationDays < 0
    ? TrendingDown
    : Minus;

  return (
    <>
      <Card className="mx-auto w-full max-w-chat bg-transparent border-0 shadow-none">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">
                {goalData.currentFollowers.toLocaleString()} / {goalData.targetFollowers.toLocaleString()} followers
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
            {projectedDateStr && (
              <span>Projected: {projectedDateStr}</span>
            )}
            {!projectedDateStr && (
              <span>No growth — projection unavailable</span>
            )}
          </div>
        </CardContent>
      </Card>

      <GoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        targetFollowers={targetFollowers}
        targetDate={targetDate}
        onTargetFollowersChange={setTargetFollowers}
        onTargetDateChange={setTargetDate}
        onSave={handleSaveGoal}
        saving={saving}
      />
    </>
  );
}

function GoalDialog({
  open,
  onOpenChange,
  targetFollowers,
  targetDate,
  onTargetFollowersChange,
  onTargetDateChange,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetFollowers: string;
  targetDate: string;
  onTargetFollowersChange: (v: string) => void;
  onTargetDateChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follower Goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="target-followers">Target followers</Label>
            <Input
              id="target-followers"
              type="number"
              value={targetFollowers}
              onChange={(e) => onTargetFollowersChange(e.target.value)}
              placeholder="10000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target-date">Target date</Label>
            <Input
              id="target-date"
              type="date"
              value={targetDate}
              onChange={(e) => onTargetDateChange(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
