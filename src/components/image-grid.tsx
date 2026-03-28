"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaItem } from "@/lib/types";

interface ImageGridProps {
  images: MediaItem[];
  onDelete?: (id: string) => void;
  className?: string;
}

/**
 * X-style image grid layouts:
 * 1 image:  full width, 16:9
 * 2 images: side-by-side, 8:9 each
 * 3 images: 1 large left (row-span-2) + 2 stacked right
 * 4 images: 2×2, 16:9 each
 */
export function ImageGrid({ images, onDelete, className }: ImageGridProps) {
  if (images.length === 0) return null;

  const count = images.length;

  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-2xl border border-white/10",
        count === 1 && "grid-cols-1",
        count === 2 && "grid-cols-2",
        count >= 3 && "grid-cols-2 grid-rows-2",
        className
      )}
    >
      {images.slice(0, 4).map((item, idx) => (
        <div
          key={item.id}
          className={cn(
            "group relative overflow-hidden bg-white/5",
            count === 1 && "aspect-video",
            count === 2 && "aspect-8/9",
            count === 3 && idx === 0 && "row-span-2",
            count === 3 && idx > 0 && "aspect-8/9",
            count === 4 && "aspect-video"
          )}
        >
          <Image
            src={item.thumbnailUrl ?? item.url}
            alt={item.alt || item.filename}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, 300px"
          />
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100"
              aria-label={`Remove ${item.filename}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
