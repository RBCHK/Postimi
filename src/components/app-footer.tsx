"use client";

export function AppFooter() {
  return (
    <footer className="hidden md:flex h-[22px] shrink-0 items-center justify-between px-4 text-xs text-muted-foreground">
      <span className="truncate">Ready</span>
      <span className="hidden md:inline">Haiku</span>
    </footer>
  );
}
