"use client";

import Image from "next/image";
import { MessageCircle, Repeat2, Heart, BarChart3, Bookmark, Share } from "lucide-react";

interface XPostPreviewProps {
  text: string;
  onChange: (text: string) => void;
  placeholder?: string;
  displayName?: string;
  handle?: string;
  avatarUrl?: string;
}

export function XPostPreview({
  text,
  onChange,
  placeholder = "What is happening?!",
  displayName = "Your Name",
  handle = "@handle",
  avatarUrl,
}: XPostPreviewProps) {
  return (
    <div className="flex h-full w-full flex-col rounded-2xl border border-white/10 bg-black p-4">
      {/* Header: avatar + name + dots */}
      <div className="flex shrink-0 items-center gap-3">
        {/* Avatar */}
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/10">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              width={40}
              height={40}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white/40">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Name row */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate text-[15px] font-bold text-white">{displayName}</span>
          <svg
            viewBox="0 0 22 22"
            aria-label="Verified account"
            className="h-[18px] w-[18px] shrink-0"
          >
            <path
              d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.144.271.586.702 1.084 1.24 1.438.54.354 1.167.551 1.813.568.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.225 1.261.276 1.894.147.634-.13 1.219-.435 1.69-.88.445-.47.75-1.055.88-1.69.131-.634.084-1.292-.139-1.9.585-.273 1.084-.704 1.438-1.244.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
              fill="#1d9bf0"
            />
          </svg>
          <span className="truncate text-[15px] text-[#71767b]">{handle}</span>
          <span className="text-[15px] text-[#71767b]">·</span>
          <span className="shrink-0 text-[15px] text-[#71767b]">now</span>
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

      {/* Editable post text — indented to align with name, not avatar */}
      <div className="ml-[52px] flex min-h-0 flex-1">
        <textarea
          className="w-full resize-none border-none bg-transparent p-0 pt-1 text-[15px] leading-[20px] text-white outline-none placeholder:text-[#71767b] focus:ring-0"
          placeholder={placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>

      {/* Engagement bar */}
      <div className="ml-[52px] flex shrink-0 items-center justify-between max-w-[425px] pt-3">
        <div className="flex items-center gap-1.5 text-[#71767b]">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full">
            <MessageCircle className="h-[18px] w-[18px]" />
          </div>
          <span className="text-[13px]">0</span>
        </div>

        <div className="flex items-center gap-1.5 text-[#71767b]">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full">
            <Repeat2 className="h-[18px] w-[18px]" />
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[#71767b]">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full">
            <Heart className="h-[18px] w-[18px]" />
          </div>
          <span className="text-[13px]">0</span>
        </div>

        <div className="flex items-center gap-1.5 text-[#71767b]">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full">
            <BarChart3 className="h-[18px] w-[18px]" />
          </div>
          <span className="text-[13px]">0</span>
        </div>

        <div className="flex items-center gap-0">
          <div className="flex items-center text-[#71767b]">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full">
              <Bookmark className="h-[18px] w-[18px]" />
            </div>
          </div>
          <div className="flex items-center text-[#71767b]">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full">
              <Share className="h-[18px] w-[18px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
