import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  message: string;
  description?: string;
  icon?: LucideIcon;
  size?: "compact" | "default" | "large";
  className?: string;
}

export function EmptyState({
  message,
  description,
  icon: Icon,
  size = "default",
  className,
}: EmptyStateProps) {
  if (size === "compact") {
    return (
      <p className={cn("py-4 text-center text-xs text-muted-foreground", className)}>{message}</p>
    );
  }

  if (size === "large") {
    return (
      <div className={cn("flex flex-col items-center justify-center py-20 text-center", className)}>
        {Icon && <Icon className="mb-3 h-10 w-10 text-muted-foreground/50" />}
        <p className="text-sm font-medium">{message}</p>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
    );
  }

  return (
    <p className={cn("py-12 text-center text-sm text-muted-foreground", className)}>{message}</p>
  );
}
