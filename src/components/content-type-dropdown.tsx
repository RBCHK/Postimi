"use client";

import { ChevronDown, MessageSquare, FileText, AlignLeft, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONTENT_TYPES, type ContentType } from "@/lib/types";
import { cn } from "@/lib/utils";

const contentTypeIcon: Record<ContentType, React.ReactNode> = {
  Reply: <MessageSquare className="h-3.5 w-3.5" />,
  Post: <FileText className="h-3.5 w-3.5" />,
  Thread: <AlignLeft className="h-3.5 w-3.5" />,
  Article: <BookOpen className="h-3.5 w-3.5" />,
};

export interface ContentTypeDropdownProps {
  value: ContentType;
  onValueChange: (type: ContentType) => void;
  /** Trigger appearance: "button" (ghost + chevron) or "badge" (Badge-like, for sidebar) */
  variant?: "button" | "badge";
  className?: string;
  disabled?: boolean;
}

export function ContentTypeDropdown({
  value,
  onValueChange,
  variant = "button",
  className,
  disabled,
}: ContentTypeDropdownProps) {
  const trigger =
    variant === "badge" ? (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-6 gap-1 rounded-md px-2 text-xs font-normal",
          className
        )}
        disabled={disabled}
      >
        {contentTypeIcon[value]}
        {value}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 shrink-0 gap-1.5 rounded-md px-2 text-xs text-muted-foreground [@media(hover:hover)]:hover:bg-white/6 [@media(hover:hover)]:hover:text-foreground",
          className
        )}
        disabled={disabled}
      >
        {contentTypeIcon[value]}
        {value}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </Button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CONTENT_TYPES.map((type) => (
          <DropdownMenuItem
            key={type}
            onClick={() => onValueChange(type)}
            className="gap-2"
          >
            {contentTypeIcon[type]}
            {type}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
