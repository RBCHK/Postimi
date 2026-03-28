import { NextRequest, NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabase, MEDIA_BUCKET } from "@/lib/supabase";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    // Find media owned by user
    const media = await prisma.media.findFirst({
      where: { id, userId },
    });
    if (!media) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }

    // Delete from Supabase Storage
    const supabase = getSupabase();
    const keysToDelete = [media.storageKey];
    if (media.thumbnailUrl) {
      // Derive thumb key from storageKey
      const parts = media.storageKey.split("/");
      const filename = parts.pop()!;
      const thumbKey = [...parts, `thumb_${filename.replace(/\.\w+$/, ".jpg")}`].join("/");
      keysToDelete.push(thumbKey);
    }
    await supabase.storage
      .from(MEDIA_BUCKET)
      .remove(keysToDelete)
      .catch(() => {}); // non-critical: don't block on storage cleanup

    // Delete from DB
    await prisma.media.delete({ where: { id } });

    // Reorder remaining media positions
    const remaining = await prisma.media.findMany({
      where: { conversationId: media.conversationId, userId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    await Promise.all(
      remaining.map((m, index) =>
        prisma.media.update({
          where: { id: m.id },
          data: { position: index },
        })
      )
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[media/delete] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
