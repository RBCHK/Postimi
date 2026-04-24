"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Settings,
  Shield,
  Trash2,
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  FileEdit,
  FilePlus,
  MessageSquare,
  FileText,
  AlignLeft,
  BookOpen,
  Repeat2,
  Calendar,
  CalendarX,
  ExternalLink,
  TrendingUp,
  BarChart3,
  PanelLeft,
  Check,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getConversations,
  deleteConversation,
  updateConversation,
  createConversation,
} from "@/app/actions/conversations";
import {
  getScheduledSlots,
  toggleSlotPosted,
  deleteSlot,
  unscheduleSlot,
} from "@/app/actions/schedule";
import { DRAFT_DEFAULT_TITLE } from "@/lib/types";
import type { Draft, ScheduledSlot, SlotStatus, SlotType } from "@/lib/types";
import { XIcon, LinkedInIcon, ThreadsIcon } from "@/components/platform-icons";

export const slotTypeIcon: Record<SlotType, React.ReactNode> = {
  Reply: <MessageSquare className="h-3.5 w-3.5 shrink-0" />,
  Post: <FileText className="h-3.5 w-3.5 shrink-0" />,
  Thread: <AlignLeft className="h-3.5 w-3.5 shrink-0" />,
  Article: <BookOpen className="h-3.5 w-3.5 shrink-0" />,
  Quote: <Repeat2 className="h-3.5 w-3.5 shrink-0" />,
};

export function slotStatusConfig(status: SlotStatus) {
  switch (status) {
    case "empty":
      return {
        className: "border border-border",
        badgeClassName: "text-muted-foreground",
        label: "Empty",
      };
    case "scheduled":
      return {
        className: "border border-border",
        badgeClassName: "text-blue-400",
        label: "Scheduled",
      };
    case "posted":
      return {
        className: "border border-border",
        badgeClassName: "text-emerald-400",
        label: "Posted",
      };
  }
}

export function formatSlotDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function groupSlotsByDate(slots: ScheduledSlot[]) {
  const groups: Record<string, ScheduledSlot[]> = {};
  for (const slot of slots) {
    const key = formatSlotDate(slot.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(slot);
  }
  return Object.entries(groups);
}

export function DraftItem({
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
  const [pendingDelete, setPendingDelete] = useState(false);

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
    const trimmed = editTitle.trim() || DRAFT_DEFAULT_TITLE;
    onTitleSave?.(draft.id, trimmed);
  }

  return (
    <div
      className={cn(
        "group flex min-w-0 w-full max-w-full items-center rounded-lg pl-3 pr-1 py-1 text-left transition-colors duration-150",
        isActive ? "bg-accent" : "[@media(hover:hover)]:hover:bg-muted/50"
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
        className={cn(
          "flex min-w-0 max-w-[87%] flex-1 flex-col gap-1 text-left",
          !isEditing && "cursor-pointer"
        )}
      >
        {isEditing ? (
          <input
            ref={titleInputRef}
            className="w-full border-none bg-transparent text-base font-medium leading-snug outline-none placeholder:text-muted-foreground/50 md:text-sm"
            value={editTitle}
            placeholder={DRAFT_DEFAULT_TITLE}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                titleInputRef.current?.blur();
              } else if (e.key === "Escape") {
                titleInputRef.current?.blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="line-clamp-2 wrap-break-word text-sm font-medium leading-snug w-full"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartEditing?.(draft.id);
            }}
          >
            {draft.title}
          </span>
        )}
      </div>
      <DropdownMenu
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setPendingDelete(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "shrink-0 h-6 w-6 transition-opacity",
              isActive || menuOpen
                ? "opacity-100"
                : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
            )}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          className="w-40"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onPin?.(draft.id, !draft.pinned);
            }}
          >
            {draft.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {draft.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          {draft.originalPostUrl && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                window.open(draft.originalPostUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink className="h-4 w-4" />
              Open original
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onStartEditing?.(draft.id);
            }}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className={
              pendingDelete
                ? "text-destructive focus:text-destructive font-medium"
                : "focus:text-foreground"
            }
            onClick={(e) => {
              e.stopPropagation();
              if (pendingDelete) {
                handleDelete();
              } else {
                setPendingDelete(true);
                e.preventDefault();
              }
            }}
          >
            {pendingDelete ? (
              <Check className="h-4 w-4 text-destructive" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {pendingDelete ? "Confirm" : "Delete"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SlotItem({
  slot,
  onTogglePosted,
  onDelete,
  onUnschedule,
}: {
  slot: ScheduledSlot;
  onTogglePosted?: (id: string) => void;
  onDelete?: (id: string) => void;
  onUnschedule?: (id: string) => void;
}) {
  const router = useRouter();
  const config = slotStatusConfig(slot.status);
  const isEmpty = slot.status === "empty";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg px-3 transition-colors duration-150",
        isEmpty ? "py-1.5" : "py-3",
        config.className
      )}
    >
      <Badge
        variant="ghost"
        className={cn(
          "p-0.5 text-xs font-normal shrink-0 cursor-pointer [@media(hover:hover)]:hover:bg-muted/50 rounded",
          config.badgeClassName
        )}
        title={
          isEmpty
            ? undefined
            : slot.status === "posted"
              ? "Posted — click to undo"
              : "Click to mark as posted"
        }
        data-slot-type-badge
        onClick={isEmpty ? undefined : () => onTogglePosted?.(slot.id)}
      >
        {slotTypeIcon[slot.slotType]}
      </Badge>
      <div className="flex flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{slot.timeSlot}</span>
          {slot.status === "posted" && slot.postedAt && (
            <span className="text-xs text-muted-foreground">
              →{" "}
              {slot.postedAt.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </span>
          )}
          {!isEmpty && slot.platforms && slot.platforms.length > 0 && (
            <div className="ml-1 flex items-center gap-1.5">
              {slot.platforms.includes("X") && <XIcon className="h-3 w-3 text-muted-foreground" />}
              {slot.platforms.includes("LINKEDIN") && (
                <LinkedInIcon className="h-3 w-3 text-muted-foreground" />
              )}
              {slot.platforms.includes("THREADS") && (
                <ThreadsIcon className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
          )}
          <div
            className={cn(
              "ml-auto flex items-center gap-0.5 shrink-0 transition-opacity",
              menuOpen
                ? "opacity-100"
                : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
            )}
          >
            <DropdownMenu onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                className="w-40"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                {slot.draftId && (
                  <DropdownMenuItem onClick={() => onUnschedule?.(slot.id)}>
                    <CalendarX className="h-3.5 w-3.5" />
                    Unschedule
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete?.(slot.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {!isEmpty && (slot.content || slot.draftTitle) && (
          <span
            className={cn(
              "line-clamp-2 text-xs text-muted-foreground",
              slot.draftId &&
                "cursor-pointer [@media(hover:hover)]:hover:text-foreground transition-colors"
            )}
            onClick={slot.draftId ? () => router.push(`/c/${slot.draftId}`) : undefined}
          >
            {slot.content || slot.draftTitle}
          </span>
        )}
      </div>
    </div>
  );
}

export function LeftSidebar({
  collapsed,
  onExpand,
  onToggle,
  defaultTab,
  showAdmin,
}: {
  collapsed?: boolean;
  onExpand?: () => void;
  onToggle?: () => void;
  defaultTab?: "drafts" | "scheduled";
  showAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [slots, setSlots] = useState<ScheduledSlot[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"drafts" | "scheduled">(defaultTab ?? "scheduled");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const fetchSeqRef = useRef(0);
  const loadedDaysRef = useRef(14);
  const isLoadingMoreRef = useRef(false);
  const scheduleScrollAreaRef = useRef<HTMLDivElement>(null);
  const scheduleSentinelRef = useRef<HTMLDivElement>(null);

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
    getScheduledSlots({ days: loadedDaysRef.current })
      .then(setSlots)
      .catch(() => setSlots([]));
  }, []);

  useEffect(() => {
    const handler = () =>
      getScheduledSlots({ days: loadedDaysRef.current })
        .then(setSlots)
        .catch(() => {});
    window.addEventListener("slots-updated", handler);
    return () => window.removeEventListener("slots-updated", handler);
  }, []);

  useEffect(() => {
    const handler = fetchAndSetDrafts;
    window.addEventListener("drafts-updated", handler);
    return () => window.removeEventListener("drafts-updated", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, title } : d)));
    };
    window.addEventListener("draft-title-updated", handler);
    return () => window.removeEventListener("draft-title-updated", handler);
  }, []);

  useEffect(() => {
    const handler = () => setActiveTab("scheduled");
    window.addEventListener("switch-to-scheduled", handler);
    return () => window.removeEventListener("switch-to-scheduled", handler);
  }, []);

  function refreshSlots() {
    getScheduledSlots({ days: loadedDaysRef.current })
      .then(setSlots)
      .catch(() => {});
  }

  async function loadMore() {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const newDays = loadedDaysRef.current + 14;
    try {
      const data = await getScheduledSlots({ days: newDays });
      setSlots(data);
      loadedDaysRef.current = newDays;
    } catch {
      // ignore
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    const container = scheduleScrollAreaRef.current;
    const sentinel = scheduleSentinelRef.current;
    if (!container || !sentinel) return;
    const viewport = container.querySelector("[data-radix-scroll-area-viewport]");
    if (!viewport) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: viewport, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  async function handleToggleSlotPosted(id: string) {
    try {
      const result = await toggleSlotPosted(id);
      if (result.status === "EMPTY") {
        // Row was deleted — re-fetch so virtual slot reappears with correct ID
        refreshSlots();
      } else {
        setSlots((prev) =>
          prev.map((s) => {
            if (s.id !== id) return s;
            const newStatus = result.status.toLowerCase() as SlotStatus;
            return { ...s, status: newStatus, postedAt: result.postedAt };
          })
        );
      }
    } catch {
      toast.error("Failed to update slot status");
    }
  }

  async function handleSlotDelete(id: string) {
    try {
      await deleteSlot(id);
      setSlots((prev) => prev.filter((s) => s.id !== id));
      toast.success("Slot deleted");
    } catch {
      toast.error("Failed to delete slot");
    }
  }

  async function handleUnschedule(id: string) {
    try {
      await unscheduleSlot(id);
      refreshSlots(); // row deleted — re-fetch so virtual EMPTY reappears
      window.dispatchEvent(new Event("slots-updated"));
      window.dispatchEvent(new Event("drafts-updated"));
      toast.success("Draft returned to drafts");
    } catch {
      toast.error("Failed to unschedule");
    }
  }

  async function handleNewDraft() {
    const id = await createConversation({ title: DRAFT_DEFAULT_TITLE });
    setEditingDraftId(id);
    router.push(`/c/${id}`);
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

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          onClick={onToggle ?? onExpand}
          title="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleNewDraft}
          title="New Draft"
        >
          <FilePlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => {
            setActiveTab("drafts");
            onExpand?.();
          }}
          title="Drafts"
        >
          <FileEdit className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => {
            setActiveTab("scheduled");
            onExpand?.();
          }}
          title="Scheduled"
        >
          <Calendar className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => router.push("/strategist")}
          title="Strategist"
        >
          <TrendingUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => router.push("/analytics")}
          title="Analytics"
        >
          <BarChart3 className="h-4 w-4" />
        </Button>
        <div className="mt-auto flex flex-col items-center gap-1">
          {showAdmin && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => router.push("/admin")}
                title="Admin"
              >
                <Shield className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => router.push("/settings")}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={activeTab}
        className="flex flex-1 flex-col overflow-hidden p-0"
        onValueChange={(v) => {
          setActiveTab(v as "drafts" | "scheduled");
          if (v === "scheduled") refreshSlots();
        }}
      >
        <div className="flex items-center gap-2 mx-3 mt-[15px]">
          <TabsList className="grid flex-1 grid-cols-2">
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="drafts" className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-[28px] shrink-0 items-center justify-start px-4 mt-[15px]">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-sm font-medium gap-1.5"
              onClick={handleNewDraft}
            >
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
          <div ref={scheduleScrollAreaRef} className="h-full">
            <ScrollArea className="h-full pl-2 pt-3 pr-2">
              <div className="flex flex-col gap-4">
                {groupedSlots.map(([dateLabel, slotList]) => (
                  <div key={dateLabel} className="flex flex-col gap-2">
                    <span className="px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {dateLabel}
                    </span>
                    {slotList.map((slot) => (
                      <SlotItem
                        key={slot.id}
                        slot={slot}
                        onTogglePosted={handleToggleSlotPosted}
                        onDelete={handleSlotDelete}
                        onUnschedule={handleUnschedule}
                      />
                    ))}
                  </div>
                ))}
                <div ref={scheduleSentinelRef} className="h-1" />
                {isLoadingMore && (
                  <p className="pb-3 text-center text-xs text-muted-foreground">Loading…</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>

      <div className="p-4 mt-[15px] mb-[15px] flex flex-col gap-1">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => router.push("/strategist")}
        >
          <TrendingUp className="h-4 w-4" />
          <span className="text-sm">Strategist</span>
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => router.push("/analytics")}
        >
          <BarChart3 className="h-4 w-4" />
          <span className="text-sm">Analytics</span>
        </Button>
        {showAdmin && (
          <>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={() => router.push("/admin")}
            >
              <Shield className="h-4 w-4" />
              <span className="text-sm">Admin</span>
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => router.push("/settings")}
        >
          <Settings className="h-4 w-4" />
          <span className="text-sm">Settings</span>
        </Button>
      </div>
    </div>
  );
}
