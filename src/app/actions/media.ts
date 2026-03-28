"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { getSupabase, MEDIA_BUCKET } from "@/lib/supabase";
import { MediaItem } from "@/lib/types";

function toMediaItem(m: {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  position: number;
  alt: string;
}): MediaItem {
  return {
    id: m.id,
    url: m.url,
    thumbnailUrl: m.thumbnailUrl,
    filename: m.filename,
    mimeType: m.mimeType,
    width: m.width,
    height: m.height,
    position: m.position,
    alt: m.alt,
  };
}

export async function getMediaForConversation(conversationId: string): Promise<MediaItem[]> {
  const userId = await requireUserId();
  return getMediaForConversationInternal(conversationId, userId);
}

export async function getMediaForConversationInternal(
  conversationId: string,
  userId: string
): Promise<MediaItem[]> {
  const media = await prisma.media.findMany({
    where: { conversationId, userId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      url: true,
      thumbnailUrl: true,
      filename: true,
      mimeType: true,
      width: true,
      height: true,
      position: true,
      alt: true,
    },
  });
  return media.map(toMediaItem);
}

export async function reorderMedia(conversationId: string, orderedIds: string[]): Promise<void> {
  const userId = await requireUserId();

  // Verify all media belong to this conversation and user
  const existing = await prisma.media.findMany({
    where: { conversationId, userId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((m) => m.id));
  const valid = orderedIds.every((id) => existingIds.has(id));
  if (!valid || orderedIds.length !== existing.length) {
    throw new Error("Invalid media IDs for reorder");
  }

  await Promise.all(
    orderedIds.map((id, index) =>
      prisma.media.update({
        where: { id },
        data: { position: index },
      })
    )
  );
}

export async function updateMediaAlt(mediaId: string, alt: string): Promise<void> {
  const userId = await requireUserId();
  const media = await prisma.media.findFirst({
    where: { id: mediaId, userId },
    select: { id: true },
  });
  if (!media) throw new Error("Media not found");

  await prisma.media.update({
    where: { id: mediaId },
    data: { alt },
  });
}

export async function deleteMediaStorageForConversation(
  conversationId: string,
  userId: string
): Promise<void> {
  const media = await prisma.media.findMany({
    where: { conversationId, userId },
    select: { storageKey: true, thumbnailUrl: true },
  });

  if (media.length === 0) return;

  const keys = media.flatMap((m) => {
    const result = [m.storageKey];
    if (m.thumbnailUrl) {
      const parts = m.storageKey.split("/");
      const filename = parts.pop()!;
      const thumbKey = [...parts, `thumb_${filename.replace(/\.\w+$/, ".jpg")}`].join("/");
      result.push(thumbKey);
    }
    return result;
  });

  await getSupabase()
    .storage.from(MEDIA_BUCKET)
    .remove(keys)
    .catch(() => {}); // non-critical
}
