"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { StickyNote, FilePlus, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";
import { useConversation } from "@/contexts/conversation-context";
import { addToQueue } from "@/app/actions/schedule";
import { createConversation } from "@/app/actions/conversations";
import { NOTES_PANEL_OPEN } from "@/components/notes-sidebar-container";

const POPUP_HEIGHT = 48;
const SAFE_MARGIN = 12;

interface Position {
  x: number;
  y: number;
  flipBelow: boolean;
}

export function TextSelectionPopup() {
  const [position, setPosition] = useState<Position | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { addNote, conversationId, contentType } = useConversation();

  const hidePopup = useCallback(() => {
    setPosition(null);
    setSelectedText("");
  }, []);

  useEffect(() => {
    function handleMouseUp(_e: MouseEvent) {
      // Small delay to let the browser finalize the selection
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (!text || text.length < 3) {
          return;
        }

        // Only trigger within the chat messages area
        const chatArea = document.querySelector("[data-chat-messages]");
        if (!chatArea) return;

        const anchorNode = selection?.anchorNode;
        if (!anchorNode || !chatArea.contains(anchorNode)) return;
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const fitsAbove = rect.top - POPUP_HEIGHT >= SAFE_MARGIN;

        setSelectedText(text);
        setPosition({
          x: rect.left + rect.width / 2,
          y: fitsAbove ? rect.top - 8 : rect.bottom + 8,
          flipBelow: !fitsAbove,
        });
      }, 10);
    }

    function handleMouseDown(e: MouseEvent) {
      if (popupRef.current?.contains(e.target as Node)) return;
      hidePopup();
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [hidePopup]);

  function handleAddToNotes() {
    addNote(selectedText);
    window.getSelection()?.removeAllRanges();
    hidePopup();
    window.dispatchEvent(new Event(NOTES_PANEL_OPEN));
    toast.success("Added to Notes");
  }

  async function handleNewDraft() {
    window.getSelection()?.removeAllRanges();
    hidePopup();
    try {
      await createConversation({
        title: selectedText.slice(0, 200),
        initialContent: selectedText,
      });
      window.dispatchEvent(new Event("drafts-updated"));
      toast.success("Draft created");
    } catch {
      toast.error("Failed to create draft");
    }
  }

  async function handleAddToQueue() {
    navigator.clipboard.writeText(selectedText);
    window.getSelection()?.removeAllRanges();
    hidePopup();

    try {
      const slotType = contentType === "Reply" ? ("REPLY" as const) : ("POST" as const);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await addToQueue(selectedText, conversationId, slotType, timezone);
      if (result) {
        const date = result.date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: timezone,
        });
        toast.success(`Copied + scheduled for ${date}, ${result.timeSlot}`);
        window.dispatchEvent(new Event("slots-updated"));
        window.dispatchEvent(new Event("drafts-updated"));
        const isMobile = window.matchMedia("(max-width: 767px)").matches;
        if (isMobile) {
          router.push("/schedule");
        } else {
          router.push("/");
          window.dispatchEvent(new Event("switch-to-scheduled"));
        }
      } else {
        toast.error("No empty slots available");
      }
    } catch {
      toast.error("Failed to add to queue");
    }
  }

  if (!position || !selectedText) return null;

  return (
    <div
      ref={popupRef}
      className="fixed z-50 flex items-center gap-2 rounded-lg border border-border bg-popover p-2 animate-in fade-in-0 zoom-in-95 duration-200"
      style={{
        left: position.x,
        top: position.y,
        transform: position.flipBelow ? "translate(-50%, 0%)" : "translate(-50%, -100%)",
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2.5 text-xs"
            onClick={handleNewDraft}
          >
            <FilePlus className="h-3.5 w-3.5" />
            Draft
          </Button>
        </TooltipTrigger>
        <TooltipContent>Create new draft with this text</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2.5 text-xs"
            onClick={handleAddToNotes}
          >
            <StickyNote className="h-3.5 w-3.5" />
            Notes
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add to Notes</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2.5 text-xs"
            onClick={handleAddToQueue}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Queue
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy + schedule in next empty slot</TooltipContent>
      </Tooltip>
    </div>
  );
}
