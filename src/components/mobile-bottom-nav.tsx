"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, FileEdit, Calendar, TrendingUp, BarChart3, PenSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPOSER_PANEL_OPEN } from "@/components/composer-sidebar-container";

function NavLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center gap-0.5 px-3 py-1.5 text-[10px]",
        isActive ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </Link>
  );
}

export function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden bg-background items-start justify-around border-t border-border px-2 pt-2 pb-[env(safe-area-inset-bottom)]">
      <NavLink href="/" icon={Home} label="Home" />
      <NavLink href="/drafts" icon={FileEdit} label="Drafts" />
      <NavLink href="/schedule" icon={Calendar} label="Schedule" />
      <button
        type="button"
        className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-[10px] text-muted-foreground"
        onClick={() => window.dispatchEvent(new Event(COMPOSER_PANEL_OPEN))}
      >
        <PenSquare className="h-5 w-5" />
        <span>Compose</span>
      </button>
      <NavLink href="/strategist" icon={TrendingUp} label="Strategy" />
      <NavLink href="/analytics" icon={BarChart3} label="Analytics" />
    </nav>
  );
}
