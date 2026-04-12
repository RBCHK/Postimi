"use client";

import { Button } from "@/components/ui/button";
import { useAnalytics, type PeriodPreset } from "@/contexts/analytics-context";

const PRESETS: PeriodPreset[] = ["7D", "2W", "1M", "3M", "1Y", "ALL"];

export function PeriodPicker() {
  const { activePreset, setPreset, fullDateRange } = useAnalytics();

  if (!fullDateRange) return null;

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      {PRESETS.map((preset) => (
        <Button
          key={preset}
          variant={activePreset === preset ? "secondary" : "ghost"}
          size="sm"
          className="h-8 px-2.5 text-xs"
          onClick={() => setPreset(preset)}
        >
          {preset}
        </Button>
      ))}
    </div>
  );
}
