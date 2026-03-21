# Prisma — Mutation Gotchas

### addMessage FK violation when conversation deleted mid-stream

**Tried:** `prisma.message.create({ data: { conversationId, role, content } })` directly

**Broke:** `PrismaClientKnownRequestError` — Foreign key constraint failed on `Message_conversationId_fkey`.
Happens when user deletes a conversation while AI is still streaming — the conversation is gone by the time `addMessage` fires.

**Fix:** Always verify the conversation exists AND belongs to the current user before inserting:

```typescript
const conversation = await prisma.conversation.findFirst({
  where: { id: conversationId, userId },
  select: { id: true },
});
if (!conversation) return; // deleted or wrong user — silently skip
```

**Watch out:** Without the `userId` check this is also a security hole — any authenticated user who knows a `conversationId` can inject messages into someone else's conversation. Always include `userId` in the where clause.
