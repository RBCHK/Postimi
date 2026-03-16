"use server";

import { prisma } from "@/lib/prisma";
import type { VoiceBankType } from "@/generated/prisma";

export async function getVoiceBankEntries(type?: "REPLY" | "POST", limit?: number) {
  const where = type ? { type: type as VoiceBankType } : {};
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
  await prisma.voiceBankEntry.create({
    data: { content, type: type as VoiceBankType, topic },
  });
}

export async function removeVoiceBankEntry(id: string) {
  await prisma.voiceBankEntry.delete({ where: { id } });
}
