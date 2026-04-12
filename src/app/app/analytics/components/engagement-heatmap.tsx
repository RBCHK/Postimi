"use client";

import { useEffect, useState } from "react";
import { useAnalytics } from "@/contexts/analytics-context";
import { getEngagementHeatmap } from "@/app/actions/analytics";
import { Card, CardContent } from "@/components/ui/card";
import type { HeatmapCell } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getCellColor(rate: number, maxRate: number): string {
  if (maxRate === 0 || rate === 0) return "";
  const intensity = Math.min(rate / maxRate, 1);
  // opacity from 15% (low) to 90% (high)
  const opacity = Math.round(intensity * 75 + 15);
  return `hsl(221 83% 53% / ${opacity}%)`;
}

interface TooltipState {
  x: number;
  y: number;
  cell: HeatmapCell;
}

export function EngagementHeatmap() {
  const { dateRange } = useAnalytics();
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    if (!dateRange) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading state before async fetch
    setIsLoading(true);
    getEngagementHeatmap(dateRange.from, dateRange.to)
      .then(setCells)
      .finally(() => setIsLoading(false));
  }, [dateRange]);

  const lookup = new Map<string, HeatmapCell>();
  for (const cell of cells) {
    lookup.set(`${cell.dayOfWeek}-${cell.hour}`, cell);
  }

  const maxRate = cells.length > 0 ? Math.max(...cells.map((c) => c.avgEngagementRate)) : 0;
  const allAtMidnight = cells.length > 0 && cells.every((c) => c.hour === 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3">
          <p className="text-sm font-medium">Engagement Heatmap</p>
          <p className="text-xs text-muted-foreground">
            Avg engagement rate by day of week and hour (UTC)
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
            Loading...
          </div>
        ) : cells.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
            No data available for this period
          </div>
        ) : (
          <>
            {allAtMidnight && (
              <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
                All posts are at midnight UTC — heatmap shows day-of-week only. Hour precision
                requires X API import.
              </p>
            )}

            <div className="overflow-x-auto">
              {/* Hour labels */}
              <div className="flex">
                <div className="w-8 shrink-0" />
                <div className="grid flex-1" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                  {HOURS.map((h) => (
                    <div key={h} className="text-center text-[9px] text-muted-foreground">
                      {h % 6 === 0 ? h : ""}
                    </div>
                  ))}
                </div>
              </div>

              {/* Grid rows */}
              <div className="mt-0.5 border border-border/40 rounded-sm overflow-hidden">
                {DAYS.map((day, dayIdx) => (
                  <div
                    key={day}
                    className="flex items-center border-b border-border/30 last:border-b-0"
                  >
                    <span className="w-8 shrink-0 text-right text-[10px] text-muted-foreground pr-1.5 border-r border-border/30 py-0.5">
                      {day}
                    </span>
                    <div className="grid flex-1" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                      {HOURS.map((hour) => {
                        const cell = lookup.get(`${dayIdx}-${hour}`);
                        const bg = cell ? getCellColor(cell.avgEngagementRate, maxRate) : "";
                        return (
                          <div
                            key={hour}
                            className="h-4 border-r border-border/20 last:border-r-0 bg-muted/40"
                            style={bg ? { backgroundColor: bg } : {}}
                            onMouseMove={(e) =>
                              cell && setTooltip({ x: e.clientX, y: e.clientY, cell })
                            }
                            onMouseLeave={() => setTooltip(null)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <span className="text-[10px] text-muted-foreground">Less</span>
                {[0.15, 0.35, 0.55, 0.75, 0.9].map((op) => (
                  <div
                    key={op}
                    className="h-3 w-3 rounded-[2px]"
                    style={{ backgroundColor: `hsl(221 83% 53% / ${op * 100}%)` }}
                  />
                ))}
                <span className="text-[10px] text-muted-foreground">More</span>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-border/50 bg-background/90 px-2.5 py-2 shadow-lg backdrop-blur-sm"
          style={{ left: tooltip.x + 14, top: tooltip.y - 14 }}
        >
          <p className="text-xs font-medium">
            {DAYS[tooltip.cell.dayOfWeek]}, {tooltip.cell.hour}:00–{tooltip.cell.hour + 1}:00
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {(tooltip.cell.avgEngagementRate * 100).toFixed(1)}% avg engagement
          </p>
          <p className="text-xs text-muted-foreground">
            {tooltip.cell.postCount} post{tooltip.cell.postCount !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </Card>
  );
}
