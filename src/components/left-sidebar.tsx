"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Settings, Clock, CheckCircle2, Circle, Trash2, MoreHorizontal, Pin, PinOff, Pencil, FileEdit, FilePlus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SettingsSheet } from "@/components/settings-sheet";
import { getConversations, deleteConversation, updateConversation } from "@/app/actions/conversations";
import { getScheduledSlots, ensureSlotsForWeek } from "@/app/actions/schedule";
import type { ContentType, Draft, ScheduledSlot, SlotStatus } from "@/lib/types";

function slotStatusConfig(status: SlotStatus) {
  switch (status) {
    case "empty":
      return {
        icon: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
        className: "border border-border bg-muted/40",
        label: "Empty",
      };
    case "filled":
      return {
        icon: <Clock className="h-3.5 w-3.5 text-blue-400" />,
        className: "border border-border bg-blue-500/10",
        label: "Ready",
      };
    case "posted":
      return {
        icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
        className: "border border-border bg-emerald-500/10",
        label: "Posted",
      };
  }
}

function formatSlotDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function groupSlotsByDate(slots: ScheduledSlot[]) {
  const groups: Record<string, ScheduledSlot[]> = {};
  for (const slot of slots) {
    const key = formatSlotDate(slot.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(slot);
  }
  return Object.entries(groups);
}

function DraftItem({
  draft,
  isActive,
  isEditing,
  onDelete,
  onTitleSave,
  onStartEditing,
  onPin,
}: {
  draft: Draft;
  isActive: boolean;
  isEditing?: boolean;
  onDelete: (id: string) => void;
  onTitleSave?: (id: string, title: string) => void;
  onStartEditing?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
}) {
  const router = useRouter();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [editTitle, setEditTitle] = useState(draft.title);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setEditTitle(draft.title);
      const frame = requestAnimationFrame(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  function handleDelete() {
    onDelete(draft.id);
    if (isActive) router.push("/");
  }

  function handleTitleSave() {
    const trimmed = editTitle.trim() || "Untitled";
    onTitleSave?.(draft.id, trimmed);
  }

  return (
    <div
      className={cn(
        "group flex min-w-0 w-full max-w-full items-center rounded-lg pl-3 pr-1 py-1 text-left transition-colors duration-150",
        isActive ? "bg-accent" : "hover:bg-muted/50",
      )}
    >
      <div
        role={isEditing ? undefined : "button"}
        tabIndex={isEditing ? undefined : 0}
        onClick={() => !isEditing && router.push(`/c/${draft.id}`)}
        onKeyDown={(e) => {
          if (!isEditing && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            router.push(`/c/${draft.id}`);
          }
        }}
        className={cn("flex min-w-0 max-w-[87%] flex-1 flex-col gap-1 text-left", !isEditing && "cursor-pointer")}
      >
        {isEditing ? (
          <input
            ref={titleInputRef}
            className="text-sm font-medium leading-snug bg-transparent border-none outline-none w-full placeholder:text-muted-foreground/50"
            value={editTitle}
            placeholder="Untitled"
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); titleInputRef.current?.blur(); }
              else if (e.key === "Escape") { titleInputRef.current?.blur(); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="line-clamp-2 wrap-break-word text-sm font-medium leading-snug w-full"
            onDoubleClick={(e) => { e.stopPropagation(); onStartEditing?.(draft.id); }}
          >
            {draft.title}
          </span>
        )}
      </div>
      <DropdownMenu onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "shrink-0 h-6 w-6 transition-opacity",
              isActive || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPin?.(draft.id, !draft.pinned); }}>
            {draft.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {draft.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onStartEditing?.(draft.id); }}>
            <Pencil className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SlotItem({ slot }: { slot: ScheduledSlot }) {
  const config = slotStatusConfig(slot.status);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150",
        config.className,
      )}
    >
      {config.icon}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{slot.timeSlot}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {slot.slotType}
          </Badge>
        </div>
        {slot.draftTitle ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {slot.draftTitle}
          </span>
        ) : (
          <span className="text-xs italic text-muted-foreground/60">
            Empty slot
          </span>
        )}
      </div>
    </div>
  );
}

export function LeftSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [slots, setSlots] = useState<ScheduledSlot[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);

  const activeDraftId = pathname.startsWith("/c/")
    ? pathname.split("/")[2]
    : null;

  function fetchAndSetDrafts() {
    const seq = ++fetchSeqRef.current;
    getConversations()
      .then((data) => { if (fetchSeqRef.current === seq) setDrafts(data); })
      .catch(() => { if (fetchSeqRef.current === seq) setDrafts([]); });
  }

  useEffect(() => {
    fetchAndSetDrafts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    ensureSlotsForWeek().then(() => getScheduledSlots().then(setSlots).catch(() => setSlots([])));
  }, []);

  useEffect(() => {
    const handler = () => getScheduledSlots().then(setSlots).catch(() => {});
    window.addEventListener("slots-updated", handler);
    return () => window.removeEventListener("slots-updated", handler);
  }, []);

  useEffect(() => {
    const handler = fetchAndSetDrafts;
    window.addEventListener("drafts-updated", handler);
    return () => window.removeEventListener("drafts-updated", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshSlots() {
    getScheduledSlots().then(setSlots).catch(() => {});
  }

  function handleNewDraft() {
    window.dispatchEvent(new Event("focus-chat-input"));
    router.push("/");
  }

  function handleStartEditing(id: string) {
    fetchSeqRef.current++;
    setEditingDraftId(id);
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

  const pinnedDrafts = drafts.filter((d) => d.pinned);
  const unpinnedDrafts = drafts.filter((d) => !d.pinned);
  const groupedSlots = groupSlotsByDate(slots);

  return (
    <div className="flex h-full flex-col">
      <Tabs
        defaultValue="drafts"
        className="flex flex-1 flex-col overflow-hidden"
        onValueChange={(v) => v === "scheduled" && refreshSlots()}
      >
        <TabsList className="mx-3 mt-[15px] grid w-auto grid-cols-2">
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts" className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-[28px] shrink-0 items-center justify-start px-4 mt-[15px]">
            <Button variant="ghost" size="sm" className="h-7 text-sm font-medium gap-1.5" onClick={handleNewDraft}>
              <FilePlus className="h-3.5 w-3.5 shrink-0" />
              New Draft
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0 min-w-0">
            <div className="min-w-0 w-full max-w-full overflow-x-hidden">
              <div className="flex min-w-0 w-full max-w-full flex-col gap-2 px-2 py-2">
              {pinnedDrafts.length > 0 && (
                <>
                  <span className="flex items-center gap-1.5 px-2 pt-1 mt-6 text-sm font-medium text-muted-foreground tracking-wider">
                    <Pin className="h-3.5 w-3.5 shrink-0" />
                    Pinned
                  </span>
                  {pinnedDrafts.map((draft) => (
                    <DraftItem
                      key={draft.id}
                      draft={draft}
                      isActive={activeDraftId === draft.id}
                      isEditing={editingDraftId === draft.id}
                      onTitleSave={handleTitleSave}
                      onStartEditing={handleStartEditing}
                      onPin={handlePin}
                      onDelete={async (id) => {
                        try {
                          await deleteConversation(id);
                          setDrafts((prev) => prev.filter((d) => d.id !== id));
                          toast.success("Draft deleted");
                        } catch {
                          toast.error("Failed to delete draft");
                        }
                      }}
                    />
                  ))}
                </>
              )}
              {unpinnedDrafts.length > 0 && (
                <span className="flex items-center gap-1.5 px-2 mt-6 text-sm font-medium text-muted-foreground tracking-wider">
                  <FileEdit className="h-3.5 w-3.5 shrink-0" />
                  Drafts
                </span>
              )}
              {unpinnedDrafts.map((draft) => (
                <DraftItem
                  key={draft.id}
                  draft={draft}
                  isActive={activeDraftId === draft.id}
                  isEditing={editingDraftId === draft.id}
                  onTitleSave={handleTitleSave}
                  onStartEditing={handleStartEditing}
                  onPin={handlePin}
                  onDelete={async (id) => {
                    try {
                      await deleteConversation(id);
                      setDrafts((prev) => prev.filter((d) => d.id !== id));
                      toast.success("Draft deleted");
                    } catch {
                      toast.error("Failed to delete draft");
                    }
                  }}
                />
              ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="scheduled" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full px-2 py-2">
            <div className="flex flex-col gap-4">
              {groupedSlots.map(([dateLabel, slotList]) => (
                <div key={dateLabel} className="flex flex-col gap-2">
                  <span className="px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {dateLabel}
                  </span>
                  {slotList.map((slot) => (
                    <SlotItem key={slot.id} slot={slot} />
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <div className="p-4">
        <SettingsSheet>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <Settings className="h-4 w-4" />
            <span className="text-sm">Settings</span>
          </Button>
        </SettingsSheet>
      </div>
    </div>
  );
}
