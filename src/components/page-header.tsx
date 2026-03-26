import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon: Icon, children, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-4 md:mb-6 shrink-0", className)}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}
