"use client";

import { useCallback } from "react";
import { ChevronLeft, ChevronRight, Link2, Link2Off, PenSquare, Calendar } from "lucide-react";
import { useConversation } from "@/contexts/conversation-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComposerContent, ContentType, Platform } from "@/lib/types";
import { PLATFORMS, PLATFORM_CONFIG } from "@/lib/types";
import { addToQueue, checkExistingSchedule } from "@/app/actions/schedule";
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

  const handleSchedule = useCallback(async () => {
    const text = getCurrentText();
    if (!text.trim()) return;

    const existing = await checkExistingSchedule(conversationId);
    if (existing) {
      // TODO: show dialog "Post already scheduled. Update or create new?"
      // For now, just create a new slot
    }

    const slotType = contentTypeToPrismaSlot[contentType];
    await addToQueue(text, conversationId, slotType);
    window.dispatchEvent(new Event("slots-updated"));
    window.dispatchEvent(new Event("drafts-updated"));
  }, [getCurrentText, conversationId, contentType]);

  // --- Collapsed view ---
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 py-3">
        {PLATFORMS.map((p) => (
          <TooltipProvider key={p} delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-xs font-bold"
                  onClick={() => onSelectPlatform?.(p)}
                >
                  {PLATFORM_CONFIG[p].icon}
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
        {PLATFORMS.map((p) => (
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
            <span className="mr-1">{PLATFORM_CONFIG[p].icon}</span>
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

      {/* Textarea */}
      <div className="flex-1 px-4 pb-2">
        <Textarea
          className="h-full min-h-[120px] resize-none border-white/10 bg-white/3 text-sm"
          placeholder={CONTENT_TYPE_PLACEHOLDERS[contentType] ?? "Write your content…"}
          value={getCurrentText()}
          onChange={(e) => handleTextChange(e.target.value)}
        />
      </div>

      {/* Footer: save status + schedule */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
        <span className="text-xs text-muted-foreground">
          {composerSaveStatus === "saving" && "Saving…"}
          {composerSaveStatus === "saved" && "Saved"}
        </span>
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
      </div>
    </div>
  );
}
