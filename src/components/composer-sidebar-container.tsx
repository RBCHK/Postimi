"use client";

import { useEffect, useState } from "react";
import { GripVertical } from "lucide-react";
import { ComposerSidebar } from "@/components/composer-sidebar";
import { useConversation } from "@/contexts/conversation-context";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/types";

export const COMPOSER_PANEL_OPEN = "composer-panel-open";

const EXPANDED_WIDTH = 650;
const COLLAPSED_WIDTH = 55;
const MOBILE_BREAKPOINT = "(max-width: 1023px)";

export function ComposerSidebarContainer() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { composerContent, updateComposer } = useConversation();

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    setIsMobile(mq.matches);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener(COMPOSER_PANEL_OPEN, handler);
    return () => window.removeEventListener(COMPOSER_PANEL_OPEN, handler);
  }, []);

  // Auto-open from home page compose action (sessionStorage flag)
  useEffect(() => {
    const autoOpenPlatform = sessionStorage.getItem("composer-auto-open");
    if (autoOpenPlatform) {
      sessionStorage.removeItem("composer-auto-open");
      updateComposer(composerContent, autoOpenPlatform as Platform);
      setIsOpen(true);
    }
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectPlatform = (platform: Platform) => {
    updateComposer(composerContent, platform);
    setIsOpen(true);
  };

  if (isMobile) {
    return (
      <>
        {isOpen && (
          <button
            type="button"
            aria-label="Close composer"
            className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ease-out"
            onClick={() => setIsOpen(false)}
          />
        )}
        {isOpen && (
          <aside className="fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-sidebar">
            <ComposerSidebar
              collapsed={false}
              onToggle={() => setIsOpen(false)}
              onClose={() => setIsOpen(false)}
            />
          </aside>
        )}
      </>
    );
  }

  return (
    <div className="hidden md:flex shrink-0">
      {/* Grip divider */}
      <div
        className="group flex w-[15px] shrink-0 cursor-col-resize items-center justify-center"
        onDoubleClick={() => setIsOpen((v) => !v)}
        title={isOpen ? "Double-click to collapse" : "Double-click to expand"}
      >
        <div className="flex h-8 w-[15px] items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground/60">
          <GripVertical className="h-4 w-4" />
        </div>
      </div>

      <div
        className={cn(
          "flex h-full flex-col bg-sidebar overflow-hidden rounded-[12px] transition-[width] duration-300 ease-in-out"
        )}
        style={{ width: isOpen ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
      >
        <ComposerSidebar
          collapsed={!isOpen}
          onToggle={() => setIsOpen((v) => !v)}
          onSelectPlatform={handleSelectPlatform}
        />
      </div>
    </div>
  );
}
