"use client";

import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sizeClasses = {
  default: "h-8 w-8 rounded-md [&_svg]:h-4 [&_svg]:w-4",
  sm: "h-6 w-6 rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5",
} as const;

export interface SendMessageButtonProps extends Omit<
  React.ComponentProps<typeof Button>,
  "size" | "children"
> {
  size?: keyof typeof sizeClasses;
}

export function SendMessageButton({
  size = "default",
  className,
  ...props
}: SendMessageButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("shrink-0", sizeClasses[size], className)}
      aria-label="Send message"
      {...props}
    >
      <SendHorizontal />
    </Button>
  );
}
