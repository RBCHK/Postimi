"use client";

import { useState } from "react";
import { LeftSidebar } from "@/components/left-sidebar";

const SIDEBAR_WIDTH = 300;
const COLLAPSED_WIDTH = 55;

export function LeftSidebarContainer() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="hidden md:block shrink-0">
      <div
        className="flex h-full flex-col bg-sidebar overflow-hidden rounded-[12px] transition-[width] duration-300 ease-in-out"
        style={{ width: isOpen ? SIDEBAR_WIDTH : COLLAPSED_WIDTH }}
      >
        <LeftSidebar
          collapsed={!isOpen}
          onExpand={() => setIsOpen(true)}
          onToggle={() => setIsOpen((v) => !v)}
        />
      </div>
    </div>
  );
}
