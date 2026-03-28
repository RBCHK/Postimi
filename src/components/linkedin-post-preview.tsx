"use client";

import Image from "next/image";
import { ThumbsUp, MessageSquare, Repeat2, Send } from "lucide-react";
import { ImageGrid } from "@/components/image-grid";
import type { MediaItem } from "@/lib/types";

interface LinkedInPostPreviewProps {
  text: string;
  onChange: (text: string) => void;
  placeholder?: string;
  displayName?: string;
  headline?: string;
  avatarUrl?: string;
  images?: MediaItem[];
  onDeleteImage?: (id: string) => void;
}

export function LinkedInPostPreview({
  text,
  onChange,
  placeholder = "What do you want to talk about?",
  displayName = "Your Name",
  headline = "Your headline",
  avatarUrl,
  images = [],
  onDeleteImage,
}: LinkedInPostPreviewProps) {
  return (
    <div className="flex h-full w-full flex-col rounded-xl border border-white/10 bg-[#1b1f23] p-4">
      {/* Header: avatar + name/headline + dots */}
      <div className="flex shrink-0 items-start gap-2">
        {/* Avatar */}
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/10">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              width={48}
              height={48}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white/40">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Name + headline + time */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[14px] font-semibold text-white">{displayName}</span>
            {/* LinkedIn verified */}
            <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none">
              <path
                d="M8 0L10.2 2.5H13.5V5.8L16 8L13.5 10.2V13.5H10.2L8 16L5.8 13.5H2.5V10.2L0 8L2.5 5.8V2.5H5.8L8 0Z"
                fill="#71767b"
              />
              <path d="M6.5 10.5L4 8L5 7L6.5 8.5L11 4L12 5L6.5 10.5Z" fill="#1b1f23" />
            </svg>
          </div>
          <p className="truncate text-[12px] leading-[16px] text-[#71767b]">{headline}</p>
          <p className="text-[12px] leading-[16px] text-[#71767b]">now</p>
        </div>

        {/* More menu (dots) */}
        <div className="shrink-0 text-[#71767b]">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </div>
      </div>

      {/* Editable post text */}
      <div className="flex min-h-0 flex-1 pt-3">
        <textarea
          className="w-full resize-none border-none bg-transparent p-0 text-[14px] leading-[20px] text-white outline-none placeholder:text-[#71767b] focus:ring-0"
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

      {/* Divider */}
      <div className="shrink-0 border-t border-white/10 pt-2">
        {/* Action bar */}
        <div className="flex items-center justify-around">
          <div className="flex items-center gap-1.5 text-[#71767b]">
            <ThumbsUp className="h-4 w-4" />
            <span className="text-[12px] font-semibold">Like</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#71767b]">
            <MessageSquare className="h-4 w-4" />
            <span className="text-[12px] font-semibold">Comment</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#71767b]">
            <Repeat2 className="h-4 w-4" />
            <span className="text-[12px] font-semibold">Repost</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#71767b]">
            <Send className="h-4 w-4" />
            <span className="text-[12px] font-semibold">Send</span>
          </div>
        </div>
      </div>
    </div>
  );
}
