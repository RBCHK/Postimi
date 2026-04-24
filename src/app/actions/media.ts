"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { getMediaForConversation as _getMediaForConversation } from "@/lib/server/media";
import type { MediaItem } from "@/lib/types";

export async function getMediaForConversation(conversationId: string): Promise<MediaItem[]> {
  const userId = await requireUserId();
  return _getMediaForConversation(conversationId, userId);
}

export async function reorderMedia(conversationId: string, orderedIds: string[]): Promise<void> {
  const userId = await requireUserId();

  const existing = await prisma.media.findMany({
    where: { conversationId, userId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((m) => m.id));
  const valid = orderedIds.every((id) => existingIds.has(id));
  if (!valid || orderedIds.length !== existing.length) {
    throw new Error("Invalid media IDs for reorder");
  }

  // One round-trip for all updates, atomic via `$transaction`. `Promise.all`
  // would issue N parallel queries against the connection pool and leave
  // positions partially reordered on a mid-flight failure.
  // Defense-in-depth: `updateMany` with `userId` in WHERE so a compromised
  // precheck can't leak cross-tenant writes here.
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.media.updateMany({
        where: { id, userId },
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

  // Defense-in-depth: scope by userId even though precheck verified ownership.
  await prisma.media.updateMany({
    where: { id: mediaId, userId },
    data: { alt },
  });
}
