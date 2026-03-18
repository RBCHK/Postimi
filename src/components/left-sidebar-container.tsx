"use client";

import { useState } from "react";
import { GripVertical } from "lucide-react";
import { LeftSidebar } from "@/components/left-sidebar";

const SIDEBAR_WIDTH = 300;
const COLLAPSED_WIDTH = 55;

export function LeftSidebarContainer({ showAdmin }: { showAdmin?: boolean }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="hidden md:flex shrink-0">
      <div
        className="flex h-full flex-col bg-sidebar overflow-hidden rounded-[12px] transition-[width] duration-300 ease-in-out"
        style={{ width: isOpen ? SIDEBAR_WIDTH : COLLAPSED_WIDTH }}
      >
        <LeftSidebar
          collapsed={!isOpen}
          onExpand={() => setIsOpen(true)}
          onToggle={() => setIsOpen((v) => !v)}
          showAdmin={showAdmin}
        />
      </div>

      {/* Resize handle / divider */}
      <div
        className="group flex w-[15px] shrink-0 cursor-col-resize items-center justify-center"
        onDoubleClick={() => setIsOpen((v) => !v)}
        title={isOpen ? "Double-click to collapse" : "Double-click to expand"}
      >
        <div className="flex h-8 w-[15px] items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground/60">
          <GripVertical className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
