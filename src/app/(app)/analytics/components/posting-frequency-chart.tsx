"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import type { AnalyticsSummary } from "@/lib/types";

interface Props {
  data: AnalyticsSummary["postsByDay"];
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
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} width={30} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="posts" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} name="Posts" />
              <Bar dataKey="replies" stackId="a" fill="#f97316" radius={[2, 2, 0, 0]} name="Replies" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
