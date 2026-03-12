"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Home,
  FileEdit,
  Calendar,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LeftSidebar } from "@/components/left-sidebar";
import { cn } from "@/lib/utils";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

type SheetTab = "drafts" | "scheduled" | null;

export function MobileBottomNav() {
  const pathname = usePathname();
  const [sheetTab, setSheetTab] = useState<SheetTab>(null);

  function NavLink({
    href,
    icon: Icon,
    label,
  }: {
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }) {
    const isActive =
      href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={cn(
          "flex flex-col items-center gap-0.5 px-3 py-1.5 text-[10px]",
          isActive ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="h-5 w-5" />
        <span>{label}</span>
      </Link>
    );
  }

  function NavButton({
    icon: Icon,
    label,
    tab,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    tab: SheetTab;
  }) {
    const isActive = sheetTab === tab;
    return (
      <button
        onClick={() => setSheetTab(tab)}
        className={cn(
          "flex flex-col items-center gap-0.5 px-3 py-1.5 text-[10px]",
          isActive ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="h-5 w-5" />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <>
      <nav className="flex md:hidden h-14 shrink-0 items-center justify-around border-t border-border px-2">
        <NavLink href="/" icon={Home} label="Home" />
        <NavButton icon={FileEdit} label="Drafts" tab="drafts" />
        <NavButton icon={Calendar} label="Schedule" tab="scheduled" />
        <NavLink href="/strategist" icon={TrendingUp} label="Strategy" />
        <NavLink href="/analytics" icon={BarChart3} label="Analytics" />
      </nav>

      <Sheet open={sheetTab !== null} onOpenChange={(open) => !open && setSheetTab(null)}>
        <SheetContent side="bottom" className="h-[70vh] p-0 rounded-t-xl">
          <VisuallyHidden>
            <SheetTitle>{sheetTab === "drafts" ? "Drafts" : "Schedule"}</SheetTitle>
          </VisuallyHidden>
          <LeftSidebar defaultTab={sheetTab === "scheduled" ? "scheduled" : "drafts"} />
        </SheetContent>
      </Sheet>
    </>
  );
}
