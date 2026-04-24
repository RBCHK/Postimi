import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabase, MEDIA_BUCKET } from "@/lib/supabase";
import {
  processImage,
  generateThumbnail,
  isAllowedMimeType,
  MAX_FILE_SIZE,
  MAX_IMAGES_PER_CONVERSATION,
} from "@/lib/media-processing";
import { MediaItem } from "@/lib/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mimeType] ?? "jpg";
}

const MAX_FILENAME_LENGTH = 120;
const UNSAFE_FILENAME_CHARS_RE = /[^A-Za-z0-9._-]+/g;

/**
 * Normalize a client-supplied filename before persisting. React escapes
 * text on render, so this is not fixing a live XSS — it's belt-and-
 * suspenders against a future template that uses `dangerouslySetInnerHTML`
 * or a migration that exports filenames into a non-HTML context (CSV,
 * Content-Disposition header, S3 key).
 *
 * Policy: collapse anything outside [A-Za-z0-9._-] to a single "_",
 * cap at 120 chars, and fall back to "file.<ext>" if nothing survives.
 */
function sanitizeFilename(raw: string, fallbackExt: string): string {
  const cleaned = raw
    .normalize("NFKC")
    .replace(UNSAFE_FILENAME_CHARS_RE, "_")
    .replace(/^[._-]+/, "") // strip leading dots so ".htaccess"-style names can't shadow
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned.length > 0 ? cleaned : `file.${fallbackExt}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await requireUserId();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversationId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    // Validate mime type
    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Allowed: JPEG, PNG, GIF, WebP" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 5MB" }, { status: 400 });
    }

    // Verify conversation belongs to user
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Check image count limit
    const existingCount = await prisma.media.count({
      where: { conversationId, userId },
    });
    if (existingCount >= MAX_IMAGES_PER_CONVERSATION) {
      return NextResponse.json(
        { error: `Maximum ${MAX_IMAGES_PER_CONVERSATION} images allowed` },
        { status: 400 }
      );
    }

    // Process image
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const processed = await processImage(rawBuffer, file.type);
    const thumbnail = await generateThumbnail(processed.buffer);

    // Upload to Supabase Storage
    const fileId = crypto.randomUUID();
    const ext = mimeToExtension(processed.mimeType);
    const storageKey = `${userId}/${conversationId}/${fileId}.${ext}`;
    const thumbKey = `${userId}/${conversationId}/thumb_${fileId}.jpg`;

    const supabase = getSupabase();
    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storageKey, processed.buffer, {
        contentType: processed.mimeType,
        upsert: false,
      });
    if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { error: thumbError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(thumbKey, thumbnail.buffer, {
        contentType: thumbnail.mimeType,
        upsert: false,
      });
    if (thumbError) {
      // Cleanup original on thumbnail failure
      await supabase.storage.from(MEDIA_BUCKET).remove([storageKey]);
      return NextResponse.json(
        { error: `Thumbnail upload failed: ${thumbError.message}` },
        { status: 500 }
      );
    }

    // Get public URLs
    const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storageKey);
    const { data: thumbUrlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(thumbKey);

    // Create DB record
    let media;
    try {
      media = await prisma.media.create({
        data: {
          userId,
          conversationId,
          storageKey,
          url: urlData.publicUrl,
          thumbnailUrl: thumbUrlData.publicUrl,
          filename: sanitizeFilename(file.name, ext),
          mimeType: processed.mimeType,
          sizeBytes: processed.buffer.length,
          width: processed.width,
          height: processed.height,
          position: existingCount,
        },
      });
    } catch (dbError) {
      // Cleanup storage on DB failure
      await supabase.storage.from(MEDIA_BUCKET).remove([storageKey, thumbKey]);
      throw dbError;
    }

    const result: MediaItem = {
      id: media.id,
      url: media.url,
      thumbnailUrl: media.thumbnailUrl,
      filename: media.filename,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      position: media.position,
      alt: media.alt,
    };

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[media/upload] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
