---
name: add-content-type
description: Add a new ContentType to the app (e.g. Newsletter, Quote)
disable-model-invocation: true
---

Add the content type "$ARGUMENTS" to the application. Follow these steps in order:

1. **Prisma schema** (`prisma/schema.prisma`):
   - Add the UPPER_CASE value to `ContentType` enum
   - Add the UPPER_CASE value to `SlotType` enum

2. **App types** (`src/lib/types.ts`):
   - Add PascalCase value to `SLOT_TYPES` array

3. **Conversations mapping** (`src/app/actions/conversations.ts`):
   - Add entry to `contentTypeToPrisma` record

4. **Schedule mappings** (`src/app/actions/schedule.ts`):
   - Add entry to `slotTypeToPrisma` record
   - Add case to `slotTypeFromPrisma` function
   - Add entry to `SECTION_TO_SLOT_TYPE` record
   - Add the new section to `ScheduleConfig` type
   - Update `DEFAULT_SCHEDULE` in `src/components/settings-sheet.tsx`

5. **Prompts** (`src/app/api/chat/route.ts`):
   - Check if the new type needs its own prompt or falls into the Post category
   - Update the contentType conditional in the route if needed

6. **Run migrations and verify**:
   - `npx prisma migrate dev --name add_<name>_type`
   - `npx prisma generate`
   - `npx tsc --noEmit`

After all steps, report which files were changed and verify TypeScript passes.
