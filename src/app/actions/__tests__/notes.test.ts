import { describe, it, expect, vi, beforeEach } from "vitest";

// Notes live inside a Conversation — the owner is the Conversation's
// owner. Every action must precheck that the conversationId belongs to
// the caller's userId, and every write must restate that constraint
// (defense-in-depth: `conversation: { id, userId }` in the WHERE).

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-notes-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  conversation: { findFirst: vi.fn() },
  message: { findFirst: vi.fn() },
  note: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { revalidatePath } from "next/cache";
import { getNotes, addNote, removeNote, updateNote, clearNotes } from "../notes";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.conversation.findFirst.mockResolvedValue({ id: "conv-1" });
  prismaMock.message.findFirst.mockResolvedValue({ id: "msg-1" });
  prismaMock.note.findMany.mockResolvedValue([]);
  prismaMock.note.create.mockResolvedValue({
    id: "note-1",
    messageId: "msg-1",
    content: "body",
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
  });
  prismaMock.note.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.note.updateMany.mockResolvedValue({ count: 1 });
});

describe("getNotes — precheck blocks cross-tenant reads", () => {
  it("throws when the conversation is not owned by the caller", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(getNotes("victim-conv")).rejects.toThrow("Conversation not found");

    expect(prismaMock.note.findMany).not.toHaveBeenCalled();
  });

  it("precheck filters by (id, userId)", async () => {
    await getNotes("conv-1");

    expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: "conv-1", userId: USER_ID },
      select: { id: true },
    });
  });
});

describe("addNote — precheck + message existence + defense-in-depth", () => {
  it("throws when the conversation is not owned", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(addNote("victim-conv", "text", "msg-1")).rejects.toThrow("Conversation not found");

    expect(prismaMock.note.create).not.toHaveBeenCalled();
  });

  it("throws when the messageId doesn't live in this conversation", async () => {
    prismaMock.message.findFirst.mockResolvedValue(null);

    await expect(addNote("conv-1", "text", "msg-foreign")).rejects.toThrow("Message not found");

    expect(prismaMock.note.create).not.toHaveBeenCalled();
  });

  it("message precheck is scoped by (id, conversationId)", async () => {
    await addNote("conv-1", "body", "msg-1");

    expect(prismaMock.message.findFirst).toHaveBeenCalledWith({
      where: { id: "msg-1", conversationId: "conv-1" },
      select: { id: true },
    });
  });

  it("creates the note and revalidates the conversation page on success", async () => {
    const result = await addNote("conv-1", "body", "msg-1");

    expect(prismaMock.note.create).toHaveBeenCalledWith({
      data: { conversationId: "conv-1", content: "body", messageId: "msg-1" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/c/conv-1");
    expect(result).toEqual({
      id: "note-1",
      messageId: "msg-1",
      content: "body",
      createdAt: expect.any(Date),
    });
  });
});

describe("removeNote — defense-in-depth WHERE scopes by conversation.userId", () => {
  it("throws when the conversation is not owned", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(removeNote("note-1", "victim-conv")).rejects.toThrow("Conversation not found");

    expect(prismaMock.note.deleteMany).not.toHaveBeenCalled();
  });

  it("deleteMany restates (id, conversation: { id, userId }) — not just noteId", async () => {
    // Critical: if the WHERE were just `{ id }`, a forged noteId could
    // delete another user's note. Keep the conversation.userId bridge.
    await removeNote("note-1", "conv-1");

    expect(prismaMock.note.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "note-1",
        conversation: { id: "conv-1", userId: USER_ID },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/c/conv-1");
  });
});

describe("updateNote — defense-in-depth WHERE scopes by conversation.userId", () => {
  it("throws when the conversation is not owned", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(updateNote("note-1", "new", "victim-conv")).rejects.toThrow(
      "Conversation not found"
    );

    expect(prismaMock.note.updateMany).not.toHaveBeenCalled();
  });

  it("updateMany restates the conversation filter in the WHERE", async () => {
    await updateNote("note-1", "edited", "conv-1");

    expect(prismaMock.note.updateMany).toHaveBeenCalledWith({
      where: {
        id: "note-1",
        conversation: { id: "conv-1", userId: USER_ID },
      },
      data: { content: "edited" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/c/conv-1");
  });
});

describe("clearNotes — scoped bulk delete", () => {
  it("throws when the conversation is not owned", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(clearNotes("victim-conv")).rejects.toThrow("Conversation not found");

    expect(prismaMock.note.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes every note under (conversation.id, conversation.userId)", async () => {
    await clearNotes("conv-1");

    expect(prismaMock.note.deleteMany).toHaveBeenCalledWith({
      where: { conversation: { id: "conv-1", userId: USER_ID } },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/c/conv-1");
  });
});
