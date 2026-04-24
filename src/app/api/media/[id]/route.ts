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

    // Delete from DB and shift remaining positions down by one in a
    // single transaction. The prior implementation queried the remaining
    // rows and issued one UPDATE per row in parallel (up to 3 round trips
    // on top of the DELETE) and was non-atomic — a mid-flight failure
    // left positions in a half-swapped state. The raw UPDATE collapses
    // to one round trip and is atomic with the DELETE under the same
    // transaction. `Media.id`, `Media.conversationId`, `Media.userId` are
    // TEXT (cuid), not UUID, so no `::uuid` cast is needed.
    await prisma.$transaction([
      prisma.media.deleteMany({ where: { id, userId } }),
      prisma.$executeRaw`
        UPDATE "Media"
        SET position = position - 1
        WHERE "conversationId" = ${media.conversationId}
          AND "userId" = ${userId}
          AND position > ${media.position}
      `,
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[media/delete] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
