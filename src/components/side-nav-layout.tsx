"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SideNavItem<T extends string> {
  value: T;
  label: string;
}

export interface SideNavLink {
  href: string;
  label: string;
}

interface Props<T extends string> {
  items: SideNavItem<T>[];
  active: T;
  onChange: (value: T) => void;
  links?: SideNavLink[];
  children: React.ReactNode;
}

export function SideNavLayout<T extends string>({
  items,
  active,
  onChange,
  links,
  children,
}: Props<T>) {
  return (
    <>
      {/* Mobile: horizontal scrollable tabs */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-2 shrink-0 scrollbar-hide">
        {items.map((item) => (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              active === item.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-muted"
            )}
          >
            {item.label}
          </button>
        ))}
        {links?.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-muted transition-colors"
          >
            {l.label}
          </Link>
        ))}
      </div>

      {/* Desktop: sidebar + content */}
      <div className="flex flex-1 min-h-0 gap-8 w-full">
        <nav className="hidden md:flex flex-col gap-0.5 w-44 shrink-0">
          {items.map((item) => (
            <button
              key={item.value}
              onClick={() => onChange(item.value)}
              className={cn(
                "text-left px-3 py-2 rounded-md text-sm transition-colors",
                active === item.value
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-muted/60"
              )}
            >
              {item.label}
            </button>
          ))}
          {links?.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-left px-3 py-2 rounded-md text-sm text-muted-foreground [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-muted/60 transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
