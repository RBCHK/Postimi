import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionLabelProps {
  children: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export function SectionLabel({ children, icon: Icon, className }: SectionLabelProps) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {children}
    </span>
  );
}
