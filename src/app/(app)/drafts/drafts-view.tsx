"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FilePlus, FileEdit, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { SectionLabel } from "@/components/section-label";
import { EmptyState } from "@/components/empty-state";
import { DraftItem } from "@/components/left-sidebar";
import {
  getConversations,
  deleteConversation,
  updateConversation,
  createConversation,
} from "@/app/actions/conversations";
import type { Draft } from "@/lib/types";

export function DraftsView() {
  const router = useRouter();
  const pathname = usePathname();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);

  const activeDraftId = pathname.startsWith("/c/") ? pathname.split("/")[2] : null;

  function fetchAndSetDrafts() {
    const seq = ++fetchSeqRef.current;
    getConversations()
      .then((data) => {
        if (fetchSeqRef.current === seq) setDrafts(data);
      })
      .catch(() => {
        if (fetchSeqRef.current === seq) setDrafts([]);
      });
  }

  useEffect(() => {
    fetchAndSetDrafts();
  }, [pathname]);

  useEffect(() => {
    const handler = fetchAndSetDrafts;
    window.addEventListener("drafts-updated", handler);
    return () => window.removeEventListener("drafts-updated", handler);
  }, []);

  async function handleNewDraft() {
    const id = await createConversation({ title: "Untitled" });
    setEditingDraftId(id);
    router.push(`/c/${id}`);
  }

  async function handleTitleSave(id: string, title: string) {
    try {
      await updateConversation(id, { title });
      fetchSeqRef.current++;
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, title } : d)));
    } catch {
      toast.error("Failed to save title");
    } finally {
      setEditingDraftId(null);
    }
  }

  async function handlePin(id: string, pinned: boolean) {
    try {
      await updateConversation(id, { pinned });
      fetchSeqRef.current++;
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, pinned } : d)));
    } catch {
      toast.error(pinned ? "Failed to pin draft" : "Failed to unpin draft");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteConversation(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      toast.success("Draft deleted");
    } catch {
      toast.error("Failed to delete draft");
    }
  }

  const pinnedDrafts = drafts.filter((d) => d.pinned);
  const unpinnedDrafts = drafts.filter((d) => !d.pinned);

  return (
    <PageContainer className="space-y-4">
      <PageHeader title="Drafts">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={handleNewDraft}>
          <FilePlus className="h-4 w-4" />
          New Draft
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-2">
        {pinnedDrafts.length > 0 && (
          <>
            <SectionLabel icon={Pin} className="px-2 pt-2">
              Pinned
            </SectionLabel>
            {pinnedDrafts.map((draft) => (
              <DraftItem
                key={draft.id}
                draft={draft}
                isActive={activeDraftId === draft.id}
                isEditing={editingDraftId === draft.id}
                onTitleSave={handleTitleSave}
                onStartEditing={(id) => {
                  fetchSeqRef.current++;
                  setEditingDraftId(id);
                }}
                onPin={handlePin}
                onDelete={handleDelete}
              />
            ))}
          </>
        )}

        {unpinnedDrafts.length > 0 && (
          <SectionLabel icon={FileEdit} className="px-2 pt-2">
            Drafts
          </SectionLabel>
        )}

        {unpinnedDrafts.map((draft) => (
          <DraftItem
            key={draft.id}
            draft={draft}
            isActive={activeDraftId === draft.id}
            isEditing={editingDraftId === draft.id}
            onTitleSave={handleTitleSave}
            onStartEditing={(id) => {
              fetchSeqRef.current++;
              setEditingDraftId(id);
            }}
            onPin={handlePin}
            onDelete={handleDelete}
          />
        ))}

        {drafts.length === 0 && <EmptyState message="No drafts yet" />}
      </div>
    </PageContainer>
  );
}
