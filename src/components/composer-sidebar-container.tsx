"use client";

import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { ComposerSidebar } from "@/components/composer-sidebar";
import { useConversation } from "@/contexts/conversation-context";
import { cn } from "@/lib/utils";
import { getPrevComposerOpen, setPrevComposerOpen } from "@/lib/composer-sidebar-state";
import type { Platform } from "@/lib/types";

export const COMPOSER_PANEL_OPEN = "composer-panel-open";

export const EXPANDED_WIDTH = 650;
export const COLLAPSED_WIDTH = 55;
const MOBILE_BREAKPOINT = "(max-width: 1023px)";

function hasComposerContent(
  c: { shared?: string; x?: string; linkedin?: string; threads?: string } | null
): boolean {
  return !!(c?.shared?.trim() || c?.x?.trim() || c?.linkedin?.trim() || c?.threads?.trim());
}

export function ComposerSidebarContainer() {
  const [isMobile, setIsMobile] = useState(false);
  const { composerContent, updateComposer } = useConversation();

  const shouldBeOpen = hasComposerContent(composerContent);
  const prevOpen = getPrevComposerOpen();
  const isFirstMount = prevOpen === undefined;

  // On first mount: start at correct state instantly (no animation).
  // On navigation: start at previous state, animate to new state if different.
  const [isOpen, setIsOpen] = useState(() => (isFirstMount ? shouldBeOpen : prevOpen));
  const [transitionEnabled, setTransitionEnabled] = useState(() =>
    isFirstMount ? false : prevOpen !== shouldBeOpen
  );

  // Keep shared state in sync with current state.
  useEffect(() => {
    setPrevComposerOpen(isOpen);
  }, [isOpen]);

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

  // Guard against React Strict Mode double-firing: sessionStorage is consumed
  // on the first run, so the second run must not fall through to the else branch.
  const autoOpenProcessedRef = useRef(false);

  // Auto-open/close based on composer content.
  // On first mount: state is already correct from useState initializer.
  // On navigation: useEffect fires after paint (browser has rendered prev state
  // with transition class), then sets new state → CSS transition animates.
  useEffect(() => {
    const autoOpenPlatform = sessionStorage.getItem("composer-auto-open");
    if (autoOpenPlatform && !autoOpenProcessedRef.current) {
      autoOpenProcessedRef.current = true;
      sessionStorage.removeItem("composer-auto-open");
      updateComposer(composerContent, autoOpenPlatform as Platform);
      // Enable transition first, then open on next frame so the browser
      // paints the collapsed state with the transition class before animating.
      setTransitionEnabled(true);
      requestAnimationFrame(() => setIsOpen(true));
    } else if (!isFirstMount && !autoOpenProcessedRef.current) {
      // Navigation: animate to the new content-based state
      setIsOpen(shouldBeOpen);
    }
    // Enable transitions for future user interactions (toggle, double-click)
    if (!transitionEnabled) {
      requestAnimationFrame(() => setTransitionEnabled(true));
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
          "flex h-full flex-col bg-sidebar overflow-hidden rounded-[12px]",
          transitionEnabled && "transition-[width] duration-300 ease-in-out"
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
