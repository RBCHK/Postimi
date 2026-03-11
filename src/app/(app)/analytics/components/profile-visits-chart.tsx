"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { AnalyticsSummary } from "@/lib/types";

interface Props {
  data: AnalyticsSummary["dailyStats"];
}

export function ProfileVisitsChart({ data }: Props) {
  const hasData = data && data.length > 0;
  const hasVisits = hasData && data.some((d) => d.profileVisits > 0);

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-medium">Profile Visits</p>
        {!hasData ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            No data available
          </div>
        ) : !hasVisits ? (
          <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
            All values are zero
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} width={30} />
              <Tooltip />
              <Bar dataKey="profileVisits" fill="#8b5cf6" radius={[2, 2, 0, 0]} name="Visits" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
