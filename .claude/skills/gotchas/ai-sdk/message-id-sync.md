# useChat message IDs don't match DB IDs

## Problem

`useChat` generates its own client-side IDs for messages. `addMessage` creates DB records with separate `cuid()` IDs. DOM elements render client-side IDs via `data-message-id`, but server actions (e.g. `addNote`) look up by DB ID → "Message not found".

## Wrong approach

`sendMessage({ text, messageId: dbId })` — `messageId` is for editing/regenerating existing messages, NOT for setting new message IDs. Causes "message with id X not found" error.

## Correct approach

Use `generateId` option on `useChat` + a ref to inject DB IDs:

```typescript
const nextMessageIdRef = useRef<string | null>(null);

useChat({
  generateId: () => {
    if (nextMessageIdRef.current) {
      const id = nextMessageIdRef.current;
      nextMessageIdRef.current = null;
      return id;
    }
    return generateId(); // from 'ai' package
  },
});
```

- **User messages**: save to DB first → get dbId → set `nextMessageIdRef.current = dbId` → call `aiSendMessage({ text })` → useChat picks up the DB ID via `generateId`
- **Assistant messages**: in `onFinish`, pass `message.id` (SDK-generated) to `addMessage(id)` → DB stores the same ID
