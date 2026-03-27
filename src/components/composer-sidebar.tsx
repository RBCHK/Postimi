"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Link2,
  Link2Off,
  PenSquare,
  Calendar,
  Send,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useConversation } from "@/contexts/conversation-context";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComposerContent, ContentType, Platform } from "@/lib/types";
import { PLATFORM_CONFIG } from "@/lib/types";
import { PlatformIcon } from "@/components/platform-icons";
import { XPostPreview } from "@/components/x-post-preview";
import { LinkedInPostPreview } from "@/components/linkedin-post-preview";
import { ThreadsPostPreview } from "@/components/threads-post-preview";
import { addToQueue, checkExistingSchedule, publishPost } from "@/app/actions/schedule";
import { slotToLocalDate } from "@/lib/date-utils";
import { toast } from "sonner";
import { getXProfileForComposer } from "@/app/actions/x-token";
import type { SlotType as PrismaSlotType } from "@/generated/prisma";

const contentTypeToPrismaSlot: Record<ContentType, PrismaSlotType> = {
  Reply: "REPLY",
  Post: "POST",
  Thread: "THREAD",
  Article: "ARTICLE",
  Quote: "QUOTE",
};

const CONTENT_TYPE_PLACEHOLDERS: Record<string, string> = {
  Reply: "Write your reply…",
  Post: "Write your post…",
  Thread: "Draft your thread…",
  Article: "Write your article…",
  Quote: "Write your quote…",
};

interface ComposerSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onSelectPlatform?: (platform: Platform) => void;
  onClose?: () => void;
}

export function ComposerSidebar({
  collapsed,
  onToggle,
  onSelectPlatform,
  onClose,
}: ComposerSidebarProps) {
  const {
    conversationId,
    contentType,
    composerContent,
    composerPlatform,
    composerSaveStatus,
    updateComposer,
  } = useConversation();

  const activePlatform = composerPlatform;

  // Load X profile for composer preview
  const [xProfile, setXProfile] = useState<{
    displayName: string;
    handle: string;
    avatarUrl: string | null;
    verified: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getXProfileForComposer()
      .then((profile) => {
        if (!cancelled) setXProfile(profile);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Get the current text for the active platform
  const getCurrentText = useCallback((): string => {
    if (composerContent.linked) {
      return composerContent.shared;
    }
    const key = activePlatform.toLowerCase() as "x" | "linkedin" | "threads";
    return composerContent[key] ?? composerContent.shared;
  }, [composerContent, activePlatform]);

  const handleTextChange = useCallback(
    (text: string) => {
      let updated: ComposerContent;
      if (composerContent.linked) {
        updated = { ...composerContent, shared: text };
      } else {
        const key = activePlatform.toLowerCase() as "x" | "linkedin" | "threads";
        updated = { ...composerContent, [key]: text };
      }
      updateComposer(updated, activePlatform);
    },
    [composerContent, activePlatform, updateComposer]
  );

  const handlePlatformChange = useCallback(
    (platform: Platform) => {
      updateComposer(composerContent, platform);
    },
    [composerContent, updateComposer]
  );

  const handleToggleLink = useCallback(() => {
    let updated: ComposerContent;
    if (composerContent.linked) {
      // Unlink: copy shared text to all platform fields
      updated = {
        linked: false,
        shared: composerContent.shared,
        x: composerContent.shared,
        linkedin: composerContent.shared,
        threads: composerContent.shared,
      };
    } else {
      // Link: use current platform's text as the shared text
      const key = activePlatform.toLowerCase() as "x" | "linkedin" | "threads";
      const currentText = composerContent[key] ?? composerContent.shared;
      updated = { linked: true, shared: currentText };
    }
    updateComposer(updated, activePlatform);
  }, [composerContent, activePlatform, updateComposer]);

  // Connected platforms — currently only X
  const connectedPlatforms: Platform[] = xProfile ? ["X"] : [];

  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState("");

  // Check if already scheduled on mount + when slots change
  const recheckSchedule = useCallback(() => {
    let cancelled = false;
    checkExistingSchedule(conversationId)
      .then((slot) => {
        if (cancelled) return;
        if (!slot) {
          setScheduledFor(null);
          setPublished(false);
        } else if (slot.status === "POSTED") {
          setScheduledFor(null);
          setPublished(true);
        } else {
          setPublished(false);
          setScheduledFor(slotToLocalDate(slot.date, slot.timeSlot));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    return recheckSchedule();
  }, [recheckSchedule]);

  useEffect(() => {
    const handler = () => recheckSchedule();
    window.addEventListener("slots-updated", handler);
    return () => window.removeEventListener("slots-updated", handler);
  }, [recheckSchedule]);

  // Countdown timer
  useEffect(() => {
    if (!scheduledFor) return;
    const update = () => {
      const diff = scheduledFor.getTime() - Date.now();
      if (diff <= 0) {
        setCountdown("now");
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        setCountdown(`in ${days}d ${hours % 24}h`);
      } else if (hours > 0) {
        setCountdown(`in ${hours}h ${mins}m`);
      } else {
        setCountdown(`in ${mins}m`);
      }
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [scheduledFor]);

  const handleSchedule = useCallback(async () => {
    const text = getCurrentText();
    if (!text.trim()) return;

    const slotType = contentTypeToPrismaSlot[contentType];
    const result = await addToQueue(text, conversationId, slotType);
    window.dispatchEvent(new Event("slots-updated"));
    window.dispatchEvent(new Event("drafts-updated"));

    if (result) {
      setScheduledFor(slotToLocalDate(result.date, result.timeSlot));
    }
  }, [getCurrentText, conversationId, contentType]);

  const handlePublish = useCallback(async () => {
    const text = getCurrentText();
    if (!text.trim() || connectedPlatforms.length === 0) return;

    setPublishing(true);
    try {
      const slotType = contentTypeToPrismaSlot[contentType];
      const result = await publishPost(conversationId, text, slotType);

      if (result.postedPlatforms.length > 0) {
        toast.success("Published to", {
          description: result.postedPlatforms.join(", "),
          icon: (
            <div className="flex gap-1">
              {result.postedPlatforms.map((p) => (
                <PlatformIcon key={p} platform={p as Platform} className="h-4 w-4" />
              ))}
            </div>
          ),
          action: result.tweetUrl
            ? { label: "View", onClick: () => window.open(result.tweetUrl, "_blank") }
            : undefined,
        });
        window.dispatchEvent(new Event("slots-updated"));
        window.dispatchEvent(new Event("drafts-updated"));
        setPublished(true);
      }

      for (const [platform, error] of Object.entries(result.errors)) {
        toast.error(`${platform}: ${error}`);
      }
    } catch {
      toast.error("Failed to publish");
    } finally {
      setPublishing(false);
    }
  }, [getCurrentText, connectedPlatforms.length, contentType, conversationId]);

  // --- Collapsed view ---
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 py-3">
        {connectedPlatforms.map((p) => (
          <TooltipProvider key={p} delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-xs font-bold"
                  onClick={() => onSelectPlatform?.(p)}
                >
                  <PlatformIcon platform={p} className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Compose for {PLATFORM_CONFIG[p].label}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
        <div className="flex-1" />
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onToggle}>
                <PenSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Open Composer</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // --- Expanded view ---
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">Compose</h3>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose ?? onToggle}>
          {onClose ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Platform tabs */}
      <div className="flex items-center gap-1 px-4 pb-3">
        {connectedPlatforms.map((p) => (
          <Button
            key={p}
            variant={activePlatform === p ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-8 min-w-[48px] text-xs font-medium",
              activePlatform === p && "bg-white/10"
            )}
            onClick={() => handlePlatformChange(p)}
          >
            <PlatformIcon platform={p} className="mr-1 h-3.5 w-3.5" />
            {PLATFORM_CONFIG[p].label}
          </Button>
        ))}
        <div className="flex-1" />
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleToggleLink}>
                {composerContent.linked ? (
                  <Link2 className="h-4 w-4" />
                ) : (
                  <Link2Off className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>
                {composerContent.linked
                  ? "Unlink platforms (edit separately)"
                  : "Link platforms (share text)"}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Editor area */}
      <div className="flex min-h-0 flex-1 px-4 pb-2">
        {activePlatform === "X" && (
          <XPostPreview
            text={getCurrentText()}
            onChange={handleTextChange}
            placeholder={CONTENT_TYPE_PLACEHOLDERS[contentType] ?? "Write your content…"}
            displayName={xProfile?.displayName}
            handle={xProfile?.handle}
            avatarUrl={xProfile?.avatarUrl ?? undefined}
            verified={xProfile?.verified}
          />
        )}
        {activePlatform === "LINKEDIN" && (
          <LinkedInPostPreview
            text={getCurrentText()}
            onChange={handleTextChange}
            placeholder={CONTENT_TYPE_PLACEHOLDERS[contentType] ?? "Write your content…"}
          />
        )}
        {activePlatform === "THREADS" && (
          <ThreadsPostPreview
            text={getCurrentText()}
            onChange={handleTextChange}
            placeholder={CONTENT_TYPE_PLACEHOLDERS[contentType] ?? "Write your content…"}
          />
        )}
      </div>

      {/* Footer: save status + publish + schedule */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs text-muted-foreground">
          {composerSaveStatus === "saving" && "Saving…"}
          {composerSaveStatus === "saved" && "Saved"}
        </span>
        <div className="flex items-center gap-2">
          {published ? (
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-600 text-white"
              disabled
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Published
            </Button>
          ) : scheduledFor ? (
            <Button variant="secondary" size="sm" className="gap-1.5" disabled>
              <Calendar className="h-3.5 w-3.5" />
              {countdown}
            </Button>
          ) : (
            <>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5"
                onClick={handlePublish}
                disabled={!getCurrentText().trim() || publishing || connectedPlatforms.length === 0}
              >
                {publishing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Publish
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={handleSchedule}
                disabled={!getCurrentText().trim()}
              >
                <Calendar className="h-3.5 w-3.5" />
                Schedule
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
