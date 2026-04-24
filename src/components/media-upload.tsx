"use client";

import { useCallback, useRef, useState } from "react";
import { ImagePlus, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaItem, Platform } from "@/lib/types";
import { PLATFORM_IMAGE_LIMITS } from "@/lib/types";

interface MediaUploadProps {
  conversationId: string;
  platform: Platform;
  media: MediaItem[];
  onMediaChange: (items: MediaItem[]) => void;
  hasMediaWriteScope?: boolean;
}

export function MediaUpload({
  conversationId,
  platform,
  media,
  onMediaChange,
  hasMediaWriteScope = true,
}: MediaUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxImages = PLATFORM_IMAGE_LIMITS[platform];

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const remaining = maxImages - media.length;
      if (remaining <= 0) return;

      const filesToUpload = Array.from(files).slice(0, remaining);
      setUploading(true);

      try {
        const newItems: MediaItem[] = [];
        for (const file of filesToUpload) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("conversationId", conversationId);

          const res = await fetch("/api/media/upload", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: "Upload failed" }));
            console.error("[MediaUpload] Upload error:", data.error);
            continue;
          }

          const item: MediaItem = await res.json();
          newItems.push(item);
        }
        if (newItems.length > 0) {
          onMediaChange([...media, ...newItems]);
        }
      } catch (err) {
        console.error("[MediaUpload] Upload error:", err);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [conversationId, maxImages, media, onMediaChange]
  );

  const scopeWarning = !hasMediaWriteScope && media.length > 0;

  return (
    <div className="space-y-2">
      {/* Scope warning */}
      {scopeWarning && (
        <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Image posting requires updated permissions. Reconnect X in Settings.</span>
        </div>
      )}

      {/* Upload button */}
      {media.length < maxImages && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
            {uploading ? "Uploading…" : "Add image"}
          </Button>
          {media.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {media.length}/{maxImages}
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}
