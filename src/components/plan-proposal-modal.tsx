"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, MinusCircle } from "lucide-react";
import { acceptProposal, rejectProposal } from "@/app/actions/plan-proposal";
import type { ConfigChange, DayKey, PlanChange, PlanProposalItem } from "@/lib/types";

interface PlanProposalModalProps {
  proposal: PlanProposalItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function PlanProposalModal({ proposal, open, onOpenChange }: PlanProposalModalProps) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(proposal.changes.map((_, i) => i))
  );
  const [isPending, startTransition] = useTransition();

  function toggleIndex(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function handleAcceptSelected() {
    startTransition(async () => {
      await acceptProposal(proposal.id, Array.from(selected));
      onOpenChange(false);
      window.dispatchEvent(new Event("slots-updated"));
    });
  }

  function handleAcceptAll() {
    startTransition(async () => {
      await acceptProposal(proposal.id);
      onOpenChange(false);
      window.dispatchEvent(new Event("slots-updated"));
    });
  }

  function handleReject() {
    startTransition(async () => {
      await rejectProposal(proposal.id);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Предложение стратега</DialogTitle>
        </DialogHeader>

        {/* Summary */}
        <p className="text-sm text-muted-foreground leading-relaxed">{proposal.summary}</p>

        {/* Changes list */}
        <div className="flex-1 overflow-y-auto space-y-2 py-1">
          {proposal.changes.map((change, i) => (
            <ChangeRow
              key={i}
              change={change}
              checked={selected.has(i)}
              onToggle={() => toggleIndex(i)}
            />
          ))}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between border-t pt-3">
          <Button variant="ghost" size="sm" onClick={handleReject} disabled={isPending}>
            Отклонить
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAcceptSelected}
              disabled={isPending || selected.size === 0}
            >
              Принять выбранные ({selected.size})
            </Button>
            <Button size="sm" onClick={handleAcceptAll} disabled={isPending}>
              Принять всё
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DAY_ORDER: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(days: Partial<Record<DayKey, boolean>>): string {
  return DAY_ORDER.filter((d) => days[d]).join(" ");
}

function time24to12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const p = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${p}`;
}

function ChangeRow({
  change,
  checked,
  onToggle,
}: {
  change: PlanChange | ConfigChange;
  checked: boolean;
  onToggle: () => void;
}) {
  const isAdd = change.action === "add";
  const Icon = isAdd ? PlusCircle : MinusCircle;
  const iconClass = isAdd ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";

  const isConfig = "section" in change;

  return (
    <div
      className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onToggle}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5"
      />
      <Icon className={`size-4 shrink-0 mt-0.5 ${iconClass}`} />
      <div className="min-w-0 flex-1 space-y-1">
        {isConfig ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-xs capitalize">
              {(change as ConfigChange).section}
            </Badge>
            <span className="text-sm font-medium">{time24to12((change as ConfigChange).time)}</span>
            <span className="text-sm text-muted-foreground">
              {formatDays((change as ConfigChange).days)}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{(change as PlanChange).date}</span>
            <span className="text-sm text-muted-foreground">{(change as PlanChange).timeSlot}</span>
            <Badge variant="outline" className="text-xs">
              {(change as PlanChange).slotType}
            </Badge>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{change.reason}</p>
      </div>
    </div>
  );
}
