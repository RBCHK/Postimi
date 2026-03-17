"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type { VoiceBankType } from "@/generated/prisma";

export async function getVoiceBankEntries(type?: "REPLY" | "POST", limit?: number) {
  const userId = await requireUserId();
  const where = type ? { userId, type: type as VoiceBankType } : { userId };
  const rows = await prisma.voiceBankEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    ...(limit ? { take: limit } : {}),
  });
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    type: r.type === "REPLY" ? "Reply" : ("Post" as "Reply" | "Post"),
    topic: r.topic,
    createdAt: r.createdAt,
  }));
}

export async function addVoiceBankEntry(content: string, type: "REPLY" | "POST", topic?: string) {
  const userId = await requireUserId();
  await prisma.voiceBankEntry.create({
    data: { content, type: type as VoiceBankType, topic, userId },
  });
}

export async function removeVoiceBankEntry(id: string) {
  const userId = await requireUserId();
  // Ownership check: only delete if belongs to current user
  const entry = await prisma.voiceBankEntry.findFirst({ where: { id, userId } });
  if (!entry) throw new Error("Entry not found");
  await prisma.voiceBankEntry.delete({ where: { id } });
}
