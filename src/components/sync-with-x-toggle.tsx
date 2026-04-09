"use client";

import { Switch } from "@/components/ui/switch";
import { PlatformIcon } from "@/components/platform-icons";

interface SyncWithXToggleProps {
  synced: boolean;
  onToggle: () => void;
}

export function SyncWithXToggle({ synced, onToggle }: SyncWithXToggleProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Switch size="sm" checked={synced} onCheckedChange={onToggle} />
      <span className="text-xs text-[#71767b]">Sync with</span>
      <PlatformIcon platform="X" className="h-3 w-3 text-[#71767b]" />
    </div>
  );
}
