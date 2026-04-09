"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
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
import { Checkbox } from "@/components/ui/checkbox";
import type { ComposerContent, ContentType, Platform } from "@/lib/types";
import { PLATFORM_CONFIG } from "@/lib/types";
import { PlatformIcon } from "@/components/platform-icons";
import { XPostPreview } from "@/components/x-post-preview";
import { LinkedInPostPreview } from "@/components/linkedin-post-preview";
import { ThreadsPostPreview } from "@/components/threads-post-preview";
import { addToQueue, checkExistingSchedule, publishPost } from "@/app/actions/schedule";
import { slotToLocalDate } from "@/lib/date-utils";
import { toast } from "sonner";
import { getXProfileForComposer, hasMediaWriteScope } from "@/app/actions/x-token";
import { getThreadsProfileForComposer } from "@/app/actions/threads-token";
import { getLinkedInProfileForComposer } from "@/app/actions/linkedin-token";
import { getMediaForConversation } from "@/app/actions/media";
import { MediaUpload } from "@/components/media-upload";
import type { MediaItem } from "@/lib/types";
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

// Module-level cache: xProfile is user-level data that doesn't change
// between conversations. Fetched once per session, survives remounts.
// Also persisted to localStorage to avoid placeholder flash on page reload.
type XProfile = {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  verified: boolean;
};

const X_PROFILE_STORAGE_KEY = "x-profile-cache";

function loadCachedXProfile(): XProfile | null {
  try {
    const raw = localStorage.getItem(X_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.displayName === "string" && typeof parsed.handle === "string") {
      return parsed as XProfile;
    }
  } catch {
    // corrupt data — ignore
  }
  return null;
}

let xProfileCache: XProfile | null | undefined; // undefined = not fetched

type ThreadsProfile = {
  displayName: string;
  avatarUrl: string | null;
};

const THREADS_PROFILE_STORAGE_KEY = "threads-profile-cache";

function loadCachedThreadsProfile(): ThreadsProfile | null {
  try {
    const raw = localStorage.getItem(THREADS_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.displayName === "string") {
      return parsed as ThreadsProfile;
    }
  } catch {
    // corrupt data — ignore
  }
  return null;
}

let threadsProfileCache: ThreadsProfile | null | undefined;

type LinkedInProfile = {
  displayName: string;
  headline: string | null;
  avatarUrl: string | null;
};

const LINKEDIN_PROFILE_STORAGE_KEY = "linkedin-profile-cache";

function loadCachedLinkedInProfile(): LinkedInProfile | null {
  try {
    const raw = localStorage.getItem(LINKEDIN_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.displayName === "string") {
      return parsed as LinkedInProfile;
    }
  } catch {
    // corrupt data — ignore
  }
  return null;
}

let linkedInProfileCache: LinkedInProfile | null | undefined;

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

  // Load X profile for composer preview — cached at module level
  // so it survives component remounts on draft switching.
  // Also persisted to localStorage to avoid "Your Name" flash on page reload.
  // Note: initial state must be module cache only (not localStorage) to avoid hydration mismatch.
  const [xProfile, setXProfile] = useState<XProfile | null>(xProfileCache ?? null);
  const [threadsProfile, setThreadsProfile] = useState<ThreadsProfile | null>(
    threadsProfileCache ?? null
  );
  const [linkedInProfile, setLinkedInProfile] = useState<LinkedInProfile | null>(
    linkedInProfileCache ?? null
  );

  useEffect(() => {
    let cancelled = false;

    // Load X profile
    if (xProfileCache === undefined) {
      const stored = loadCachedXProfile();
      if (stored) {
        xProfileCache = stored;
        setXProfile(stored);
      }
      getXProfileForComposer()
        .then((profile) => {
          xProfileCache = profile;
          if (!cancelled) setXProfile(profile);
          try {
            if (profile) {
              localStorage.setItem(X_PROFILE_STORAGE_KEY, JSON.stringify(profile));
            } else {
              localStorage.removeItem(X_PROFILE_STORAGE_KEY);
            }
          } catch {
            // storage full — ignore
          }
        })
        .catch(() => {});
    }

    // Load Threads profile
    if (threadsProfileCache === undefined) {
      const stored = loadCachedThreadsProfile();
      if (stored) {
        threadsProfileCache = stored;
        setThreadsProfile(stored);
      }
      getThreadsProfileForComposer()
        .then((profile) => {
          threadsProfileCache = profile;
          if (!cancelled) setThreadsProfile(profile);
          try {
            if (profile) {
              localStorage.setItem(THREADS_PROFILE_STORAGE_KEY, JSON.stringify(profile));
            } else {
              localStorage.removeItem(THREADS_PROFILE_STORAGE_KEY);
            }
          } catch {}
        })
        .catch(() => {});
    }

    // Load LinkedIn profile
    if (linkedInProfileCache === undefined) {
      const stored = loadCachedLinkedInProfile();
      if (stored) {
        linkedInProfileCache = stored;
        setLinkedInProfile(stored);
      }
      getLinkedInProfileForComposer()
        .then((profile) => {
          linkedInProfileCache = profile;
          if (!cancelled) setLinkedInProfile(profile);
          try {
            if (profile) {
              localStorage.setItem(LINKEDIN_PROFILE_STORAGE_KEY, JSON.stringify(profile));
            } else {
              localStorage.removeItem(LINKEDIN_PROFILE_STORAGE_KEY);
            }
          } catch {}
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Get the current text for the active platform
  const getCurrentText = useCallback((): string => {
    if (activePlatform === "X") return composerContent.x;
    const key = activePlatform.toLowerCase() as "threads" | "linkedin";
    if (composerContent.linkedToX[key]) return composerContent.x;
    return composerContent[key] ?? composerContent.x;
  }, [composerContent, activePlatform]);

  const handleTextChange = useCallback(
    (text: string) => {
      let updated: ComposerContent;
      if (activePlatform === "X") {
        updated = { ...composerContent, x: text };
      } else {
        const key = activePlatform.toLowerCase() as "threads" | "linkedin";
        if (composerContent.linkedToX[key]) {
          // Editing a linked platform edits X text
          updated = { ...composerContent, x: text };
        } else {
          updated = { ...composerContent, [key]: text };
        }
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

  const handleTogglePlatformLink = useCallback(
    (platform: "THREADS" | "LINKEDIN") => {
      const key = platform.toLowerCase() as "threads" | "linkedin";
      const isLinked = composerContent.linkedToX[key];
      let updated: ComposerContent;
      if (isLinked) {
        // Unlink: copy X text as starting point for independent editing
        updated = {
          ...composerContent,
          linkedToX: { ...composerContent.linkedToX, [key]: false },
          [key]: composerContent.x,
        };
      } else {
        // Link: discard platform text, sync with X
        updated = {
          ...composerContent,
          linkedToX: { ...composerContent.linkedToX, [key]: true },
        };
      }
      updateComposer(updated, activePlatform);
    },
    [composerContent, activePlatform, updateComposer]
  );

  // Connected platforms — derived from which profiles are loaded
  const connectedPlatforms = useMemo<Platform[]>(
    () => [
      ...(xProfile ? ["X" as Platform] : []),
      ...(threadsProfile ? ["THREADS" as Platform] : []),
      ...(linkedInProfile ? ["LINKEDIN" as Platform] : []),
    ],
    [xProfile, threadsProfile, linkedInProfile]
  );

  // Platforms enabled for publishing (default: all connected)
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<Platform>>(
    () => new Set(connectedPlatforms)
  );

  // Keep enabledPlatforms in sync when connectedPlatforms change
  useEffect(() => {
    setEnabledPlatforms((prev) => {
      const next = new Set<Platform>();
      for (const p of connectedPlatforms) {
        if (prev.has(p)) next.add(p);
      }
      // If nothing would be enabled, enable all
      return next.size > 0 ? next : new Set(connectedPlatforms);
    });
  }, [connectedPlatforms]);

  const handleTogglePlatformEnabled = useCallback((platform: Platform) => {
    setEnabledPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        // Don't allow disabling all platforms
        if (next.size > 1) next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  }, []);

  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState("");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaWriteScope, setMediaWriteScope] = useState(true);

  // Load media and scope status
  useEffect(() => {
    let cancelled = false;
    getMediaForConversation(conversationId)
      .then((items) => {
        if (!cancelled) setMediaItems(items);
      })
      .catch(() => {});
    hasMediaWriteScope()
      .then((has) => {
        if (!cancelled) setMediaWriteScope(has);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const handleMediaChange = useCallback((items: MediaItem[]) => {
    setMediaItems(items);
  }, []);

  const handleDeleteMedia = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setMediaItems((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error("[ComposerSidebar] Delete media error:", err);
    }
  }, []);

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
    } else {
      toast.error(`No available ${contentType} slots`, {
        description: "Add slots for this content type in Schedule settings.",
      });
    }
  }, [getCurrentText, conversationId, contentType]);

  const handlePublish = useCallback(async () => {
    const text = getCurrentText();
    if (!text.trim() || enabledPlatforms.size === 0) return;

    setPublishing(true);
    try {
      const slotType = contentTypeToPrismaSlot[contentType];
      // Pass per-platform text so each platform gets its own content
      const allLinked = composerContent.linkedToX.threads && composerContent.linkedToX.linkedin;
      const platformText = allLinked
        ? composerContent.x
        : {
            shared: composerContent.x,
            x: composerContent.x,
            linkedin: composerContent.linkedToX.linkedin
              ? composerContent.x
              : composerContent.linkedin,
            threads: composerContent.linkedToX.threads
              ? composerContent.x
              : composerContent.threads,
          };
      const targetPlatforms = Array.from(enabledPlatforms);
      const result = await publishPost(conversationId, platformText, slotType, targetPlatforms);

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
  }, [getCurrentText, enabledPlatforms, contentType, conversationId, composerContent]);

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
          <div key={p} className="flex items-center gap-1">
            <Checkbox
              checked={enabledPlatforms.has(p)}
              onCheckedChange={() => handleTogglePlatformEnabled(p)}
              className="h-3.5 w-3.5"
            />
            <Button
              variant={activePlatform === p ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-8 min-w-[48px] text-xs font-medium",
                activePlatform === p && "bg-white/10",
                !enabledPlatforms.has(p) && "opacity-50"
              )}
              onClick={() => handlePlatformChange(p)}
            >
              <PlatformIcon platform={p} className="mr-1 h-3.5 w-3.5" />
              {PLATFORM_CONFIG[p].label}
            </Button>
          </div>
        ))}
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
            images={mediaItems}
            onDeleteImage={handleDeleteMedia}
          />
        )}
        {activePlatform === "LINKEDIN" && (
          <LinkedInPostPreview
            text={getCurrentText()}
            onChange={handleTextChange}
            placeholder={CONTENT_TYPE_PLACEHOLDERS[contentType] ?? "Write your content…"}
            displayName={linkedInProfile?.displayName}
            headline={linkedInProfile?.headline ?? undefined}
            avatarUrl={linkedInProfile?.avatarUrl ?? undefined}
            images={mediaItems}
            onDeleteImage={handleDeleteMedia}
            syncedWithX={composerContent.linkedToX.linkedin}
            onToggleSync={() => handleTogglePlatformLink("LINKEDIN")}
          />
        )}
        {activePlatform === "THREADS" && (
          <ThreadsPostPreview
            text={getCurrentText()}
            onChange={handleTextChange}
            placeholder={CONTENT_TYPE_PLACEHOLDERS[contentType] ?? "Write your content…"}
            displayName={threadsProfile?.displayName}
            avatarUrl={threadsProfile?.avatarUrl ?? undefined}
            images={mediaItems}
            onDeleteImage={handleDeleteMedia}
            syncedWithX={composerContent.linkedToX.threads}
            onToggleSync={() => handleTogglePlatformLink("THREADS")}
          />
        )}
      </div>

      {/* Media upload */}
      <div className="px-4 pb-2">
        <MediaUpload
          conversationId={conversationId}
          platform={activePlatform}
          media={mediaItems}
          onMediaChange={handleMediaChange}
          hasMediaWriteScope={mediaWriteScope}
        />
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
                disabled={
                  !getCurrentText().trim() ||
                  publishing ||
                  connectedPlatforms.length === 0 ||
                  (mediaItems.length > 0 && !mediaWriteScope)
                }
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
