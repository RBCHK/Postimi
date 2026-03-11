"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { ContentCsvRow } from "@/lib/types";

interface Props {
  topPosts: ContentCsvRow[];
  topReplies: ContentCsvRow[];
}

function ContentRow({ row, rank }: { row: ContentCsvRow; rank: number }) {
  return (
    <div className="flex items-start gap-2 border-b border-border py-2 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{rank}.</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{row.text}</p>
        <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
          <span>{row.impressions.toLocaleString()} impr</span>
          <span>{row.likes} likes</span>
          <span>{row.engagements} eng</span>
        </div>
      </div>
    </div>
  );
}

export function TopContentTable({ topPosts, topReplies }: Props) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-medium">Top Posts</p>
          {topPosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts in this period</p>
          ) : (
            topPosts.map((p, i) => <ContentRow key={p.postId} row={p} rank={i + 1} />)
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-medium">Top Replies</p>
          {topReplies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No replies in this period</p>
          ) : (
            topReplies.map((p, i) => <ContentRow key={p.postId} row={p} rank={i + 1} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
