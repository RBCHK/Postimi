"use client";

import { useEffect, useState } from "react";
import { StickyNote } from "lucide-react";
import { useConversation } from "@/contexts/conversation-context";
import { NotesSidebar } from "@/components/notes-sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const NOTES_PANEL_OPEN = "notes-panel-open";

const MOBILE_BREAKPOINT = "(max-width: 1023px)";

export function NotesSidebarContainer() {
  const { notes } = useConversation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser API access requires effect for SSR safety
    setIsMobile(mq.matches);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener(NOTES_PANEL_OPEN, handler);
    return () => window.removeEventListener(NOTES_PANEL_OPEN, handler);
  }, []);

  const showBackdrop = isMobile && isOpen;
  const showFab = notes.length > 0 && isMobile && !isOpen;

  return (
    <>
      {showBackdrop && (
        <button
          type="button"
          aria-label="Close notes"
          className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ease-out"
          onClick={() => setIsOpen(false)}
        />
      )}
      {showFab && (
        <Button
          variant="secondary"
          size="sm"
          className="fixed bottom-24 right-4 z-40 gap-2 shadow-lg lg:hidden"
          onClick={() => setIsOpen(true)}
        >
          <StickyNote className="h-4 w-4" />
          Notes ({notes.length})
        </Button>
      )}
      <aside
        className={cn(
          "flex w-[118px] shrink-0 flex-col bg-sidebar",
          "max-lg:fixed max-lg:right-0 max-lg:top-0 max-lg:z-50 max-lg:h-full max-lg:w-full",
          isMobile && !isOpen && "max-lg:hidden"
        )}
      >
        <div className="flex h-full w-[118px] flex-col max-lg:w-full">
          <NotesSidebar onClose={isMobile ? () => setIsOpen(false) : undefined} />
        </div>
      </aside>
    </>
  );
}
