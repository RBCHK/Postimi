"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { sendBatchInvitations, type BatchInvitationResult } from "@/app/actions/invitations";

export interface WaitlistRow {
  id: string;
  email: string;
  source: string | null;
  locale: string | null;
  priority: number;
  createdAt: string;
  invitedAt: string | null;
  invitationId: string | null;
  convertedUserId: string | null;
}

type Filter = "all" | "uninvited" | "invited" | "converted";

export function WaitlistAdminView({ entries }: { entries: WaitlistRow[] }) {
  const [filter, setFilter] = useState<Filter>("uninvited");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<BatchInvitationResult | null>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filter === "uninvited") return !e.invitedAt;
      if (filter === "invited") return !!e.invitedAt && !e.convertedUserId;
      if (filter === "converted") return !!e.convertedUserId;
      return true;
    });
  }, [entries, filter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((e) => e.id)));
  };

  const onSend = () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        const result = await sendBatchInvitations(ids);
        setLastResult(result);
        toast.success(
          `${result.sent} sent${result.skipped ? `, ${result.skipped} skipped` : ""}${result.failed ? `, ${result.failed} failed` : ""}`
        );
        setSelected(new Set());
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send invitations");
      }
    });
  };

  return (
    <PageContainer className="flex flex-col h-full space-y-4">
      <PageHeader title="Waitlist" subtitle={`${entries.length} total`}>
        <Button onClick={onSend} disabled={pending || selected.size === 0}>
          {pending
            ? "Sending..."
            : `Send ${selected.size || ""} invitation${selected.size === 1 ? "" : "s"}`}
        </Button>
      </PageHeader>

      <Tabs
        value={filter}
        onValueChange={(v) => {
          setFilter(v as Filter);
          setSelected(new Set());
        }}
      >
        <TabsList>
          <TabsTrigger value="uninvited">Uninvited</TabsTrigger>
          <TabsTrigger value="invited">Invited</TabsTrigger>
          <TabsTrigger value="converted">Converted</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-lg border flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="w-10 p-2">
                <Checkbox
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">Source</th>
              <th className="p-2 text-left">Locale</th>
              <th className="p-2 text-left">Priority</th>
              <th className="p-2 text-left">Joined</th>
              <th className="p-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const lastResultRow = lastResult?.results.find((r) => r.id === e.id);
              const status = e.convertedUserId
                ? "converted"
                : e.invitedAt
                  ? "invited"
                  : "uninvited";
              return (
                <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-2">
                    <Checkbox
                      checked={selected.has(e.id)}
                      onCheckedChange={() => toggle(e.id)}
                      disabled={!!e.invitedAt}
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{e.email}</td>
                  <td className="p-2 text-xs text-muted-foreground">{e.source ?? "—"}</td>
                  <td className="p-2 text-xs text-muted-foreground">{e.locale ?? "—"}</td>
                  <td className="p-2 text-xs">{e.priority}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-2">
                    <Badge
                      variant={
                        status === "converted"
                          ? "default"
                          : status === "invited"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {status}
                    </Badge>
                    {lastResultRow?.status === "failed" && (
                      <div className="mt-1 text-xs text-red-500">{lastResultRow.error}</div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState message="No entries" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageContainer>
  );
}
