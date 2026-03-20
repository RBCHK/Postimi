"use client";

import { ChevronDown, MessageSquare, FileText, AlignLeft, BookOpen, Repeat2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONTENT_TYPES, type ContentType } from "@/lib/types";
import { cn } from "@/lib/utils";

const contentTypeColor: Record<ContentType, string> = {
  Reply: "#59C3FA",
  Post: "#9983F7",
  Thread: "#86FCE2",
  Article: "#F8D849",
  Quote: "#FB923C",
};

const contentTypeIcon: Record<ContentType, React.ReactNode> = {
  Reply: <MessageSquare className="h-3.5 w-3.5" style={{ color: contentTypeColor.Reply }} />,
  Post: <FileText className="h-3.5 w-3.5" style={{ color: contentTypeColor.Post }} />,
  Thread: <AlignLeft className="h-3.5 w-3.5" style={{ color: contentTypeColor.Thread }} />,
  Article: <BookOpen className="h-3.5 w-3.5" style={{ color: contentTypeColor.Article }} />,
  Quote: <Repeat2 className="h-3.5 w-3.5" style={{ color: contentTypeColor.Quote }} />,
};

export interface ContentTypeDropdownProps {
  value: ContentType;
  /** When omitted, renders as a read-only badge (no dropdown, no chevron). */
  onValueChange?: (type: ContentType) => void;
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
  const isReadOnly = !onValueChange;

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        variant === "badge"
          ? "h-6 gap-1 rounded-md px-2 text-xs font-normal"
          : "h-8 shrink-0 gap-1.5 rounded-md px-2 text-xs [@media(hover:hover)]:hover:bg-white/6",
        isReadOnly && "cursor-default [@media(hover:hover)]:hover:bg-transparent",
        className
      )}
      disabled={disabled}
    >
      {contentTypeIcon[value]}
      <span style={{ color: contentTypeColor[value] }}>{value}</span>
      {!isReadOnly && <ChevronDown className="h-3 w-3 opacity-50" />}
    </Button>
  );

  if (isReadOnly) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CONTENT_TYPES.map((type) => (
          <DropdownMenuItem key={type} onClick={() => onValueChange(type)} className="gap-2">
            {contentTypeIcon[type]}
            <span style={{ color: contentTypeColor[type] }}>{type}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
