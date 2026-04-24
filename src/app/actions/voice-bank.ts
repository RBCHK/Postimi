"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { VoiceBankType as PrismaVoiceBankType } from "@/generated/prisma";

// App-side type kept narrow to the two values we currently accept. The
// mapping records force TS to error when a new Prisma variant lands in
// the schema — same convention as contentTypeToPrisma in conversations.ts.
type VoiceBankTypeApp = "Reply" | "Post";
type VoiceBankTypeInput = "REPLY" | "POST";

const voiceBankTypeToPrisma: Record<VoiceBankTypeInput, PrismaVoiceBankType> = {
  REPLY: "REPLY",
  POST: "POST",
};

const voiceBankTypeFromPrisma: Record<PrismaVoiceBankType, VoiceBankTypeApp> = {
  REPLY: "Reply",
  POST: "Post",
};

export async function getVoiceBankEntries(type?: VoiceBankTypeInput, limit?: number) {
  const userId = await requireUserId();
  const where = type ? { userId, type: voiceBankTypeToPrisma[type] } : { userId };
  const rows = await prisma.voiceBankEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    ...(limit ? { take: limit } : {}),
  });
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    type: voiceBankTypeFromPrisma[r.type],
    topic: r.topic,
    createdAt: r.createdAt,
  }));
}

export async function addVoiceBankEntry(content: string, type: VoiceBankTypeInput, topic?: string) {
  const userId = await requireUserId();
  await prisma.voiceBankEntry.create({
    data: { content, type: voiceBankTypeToPrisma[type], topic, userId },
  });
}

export async function removeVoiceBankEntry(id: string) {
  const userId = await requireUserId();
  // Ownership check: only delete if belongs to current user
  const entry = await prisma.voiceBankEntry.findFirst({ where: { id, userId } });
  if (!entry) throw new Error("Entry not found");
  // Defense-in-depth: scope the delete by userId so a refactor that drops
  // the precheck above still can't reach another user's row.
  await prisma.voiceBankEntry.deleteMany({ where: { id, userId } });
}
