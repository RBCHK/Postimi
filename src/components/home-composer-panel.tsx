"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, PenSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createConversation } from "@/app/actions/conversations";
import { PLATFORMS, PLATFORM_CONFIG } from "@/lib/types";
import type { Platform } from "@/lib/types";
import { PlatformIcon } from "@/components/platform-icons";

const COLLAPSED_WIDTH = 55;

export function HomeComposerPanel() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  async function handleCompose(platform?: Platform) {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const id = await createConversation({ title: "Untitled" });
      sessionStorage.setItem("composer-auto-open", platform ?? "X");
      router.push(`/c/${id}`);
    } catch {
      setIsCreating(false);
    }
  }

  return (
    <div className="hidden md:flex shrink-0">
      {/* Grip divider */}
      <div className="flex w-[15px] shrink-0 items-center justify-center">
        <div className="flex h-8 w-[15px] items-center justify-center rounded-sm text-muted-foreground/60">
          <GripVertical className="h-4 w-4 opacity-0" />
        </div>
      </div>

      <div
        className="flex h-full flex-col bg-sidebar overflow-hidden rounded-[12px]"
        style={{ width: COLLAPSED_WIDTH }}
      >
        {isCreating ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center gap-1 py-3">
            {PLATFORMS.map((p) => (
              <TooltipProvider key={p} delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-xs font-bold"
                      onClick={() => handleCompose(p)}
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => handleCompose()}
                  >
                    <PenSquare className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Quick compose</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    </div>
  );
}
