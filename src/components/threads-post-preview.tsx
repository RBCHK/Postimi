"use client";

import Image from "next/image";
import { Heart, MessageCircle, Repeat2, Send } from "lucide-react";
import { ImageGrid } from "@/components/image-grid";
import { SyncWithXToggle } from "@/components/sync-with-x-toggle";
import type { MediaItem } from "@/lib/types";

interface ThreadsPostPreviewProps {
  text: string;
  onChange: (text: string) => void;
  placeholder?: string;
  displayName?: string;
  avatarUrl?: string;
  images?: MediaItem[];
  onDeleteImage?: (id: string) => void;
  syncedWithX?: boolean;
  onToggleSync?: () => void;
}

export function ThreadsPostPreview({
  text,
  onChange,
  placeholder = "What's new?",
  displayName = "username",
  avatarUrl,
  images = [],
  onDeleteImage,
  syncedWithX,
  onToggleSync,
}: ThreadsPostPreviewProps) {
  return (
    <div className="flex h-full w-full gap-3 rounded-2xl border border-white/10 bg-black p-4">
      {/* Avatar — fixed top-left */}
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={36}
            height={36}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold tracking-tight text-black">
            {displayName.slice(0, 5).toUpperCase()}
          </div>
        )}
      </div>

      {/* Right column: name, text, engagement */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Name row + dots */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[15px] font-semibold text-white">{displayName}</span>
          <span className="text-[15px] text-[#71767b]">now</span>
          <div className="flex-1" />
          {syncedWithX !== undefined && onToggleSync ? (
            <SyncWithXToggle synced={syncedWithX} onToggle={onToggleSync} />
          ) : (
            <div className="shrink-0 text-[#71767b]">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </div>
          )}
        </div>

        {/* Editable post text */}
        <div className="flex min-h-0 flex-1">
          <textarea
            className="w-full resize-none border-none bg-transparent p-0 pt-1 text-base leading-[20px] text-white outline-none placeholder:text-[#71767b] focus:ring-0 md:text-[15px]"
            placeholder={placeholder}
            value={text}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>

        {/* Image grid */}
        {images.length > 0 && (
          <div className="shrink-0 pt-2">
            <ImageGrid images={images} onDelete={onDeleteImage} />
          </div>
        )}

        {/* Engagement bar */}
        <div className="flex shrink-0 items-center gap-4 pt-3">
          <div className="flex items-center gap-1.5 text-[#71767b]">
            <Heart className="h-[20px] w-[20px]" />
            <span className="text-[13px]">0</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#71767b]">
            <MessageCircle className="h-[20px] w-[20px]" />
            <span className="text-[13px]">0</span>
          </div>
          <div className="flex items-center text-[#71767b]">
            <Repeat2 className="h-[20px] w-[20px]" />
          </div>
          <div className="flex items-center gap-1.5 text-[#71767b]">
            <Send className="h-[18px] w-[18px]" />
            <span className="text-[13px]">0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
