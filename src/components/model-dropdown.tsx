"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODEL_OPTIONS, getStoredModel, setStoredModel } from "@/lib/model";

export function ModelDropdown({ disabled }: { disabled?: boolean }) {
  const [model, setModel] = useState(getStoredModel);

  function handleSelect(value: string) {
    setModel(value);
    setStoredModel(value);
  }

  const current = MODEL_OPTIONS.find((o) => o.value === model) ?? MODEL_OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1.5 rounded-md px-2 text-xs text-muted-foreground [@media(hover:hover)]:hover:bg-white/6 [@media(hover:hover)]:hover:text-foreground"
          disabled={disabled}
          suppressHydrationWarning
        >
          {current.shortLabel}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {MODEL_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => handleSelect(opt.value)}
            className="gap-2"
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
