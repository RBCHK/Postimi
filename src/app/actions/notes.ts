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
    messageId: r.messageId,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

export async function addNote(conversationId: string, content: string, messageId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true },
  });
  if (!message) throw new Error("Message not found");

  const note = await prisma.note.create({
    data: { conversationId, content, messageId },
  });
  revalidatePath(`/c/${conversationId}`);
  return {
    id: note.id,
    messageId: note.messageId,
    content: note.content,
    createdAt: note.createdAt,
  };
}

export async function removeNote(id: string, conversationId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  // Defense-in-depth: Note is owned transitively via Conversation, but
  // restating the constraint in the WHERE (`conversation.userId`) means
  // that if Note ever gets its own ownership column or the precheck is
  // removed, this write still can't reach another user's row.
  await prisma.note.deleteMany({
    where: { id, conversation: { id: conversationId, userId } },
  });
  revalidatePath(`/c/${conversationId}`);
}

export async function updateNote(id: string, content: string, conversationId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  await prisma.note.updateMany({
    where: { id, conversation: { id: conversationId, userId } },
    data: { content },
  });
  revalidatePath(`/c/${conversationId}`);
}

export async function clearNotes(conversationId: string) {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");

  await prisma.note.deleteMany({
    where: { conversation: { id: conversationId, userId } },
  });
  revalidatePath(`/c/${conversationId}`);
}
