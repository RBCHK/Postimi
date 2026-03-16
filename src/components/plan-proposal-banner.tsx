"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarCog } from "lucide-react";
import { PlanProposalModal } from "./plan-proposal-modal";
import type { PlanProposalItem } from "@/lib/types";

interface PlanProposalBannerProps {
  proposal: PlanProposalItem;
}

export function PlanProposalBanner({ proposal }: PlanProposalBannerProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <Card className="mx-auto w-full max-w-chat border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-3 p-4">
          <CalendarCog className="size-4 shrink-0 text-primary" />
          <div className="flex flex-1 items-center justify-between gap-3">
            <p className="text-sm">
              Стратег предлагает изменить план{" "}
              <span className="text-muted-foreground">
                ({proposal.changes.length}{" "}
                {proposal.changes.length === 1 ? "изменение" : "изменений"})
              </span>
            </p>
            <Button size="sm" onClick={() => setModalOpen(true)}>
              Посмотреть
            </Button>
          </div>
        </CardContent>
      </Card>

      <PlanProposalModal proposal={proposal} open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
