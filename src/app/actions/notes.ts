"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";

export async function getNotes(conversationId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  const rows = await prisma.note.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

export async function addNote(conversationId: string, content: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  const note = await prisma.note.create({
    data: { conversationId, content },
  });
  revalidatePath(`/c/${conversationId}`);
  return { id: note.id, content: note.content, createdAt: note.createdAt };
}

export async function removeNote(id: string, conversationId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  await prisma.note.delete({ where: { id } });
  revalidatePath(`/c/${conversationId}`);
}

export async function updateNote(id: string, content: string, conversationId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  await prisma.note.update({ where: { id }, data: { content } });
  revalidatePath(`/c/${conversationId}`);
}

export async function clearNotes(conversationId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  await prisma.note.deleteMany({ where: { conversationId } });
  revalidatePath(`/c/${conversationId}`);
}
