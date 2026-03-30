### Run e2e tests before pushing — tsc+lint miss behavioral regressions

**Tried:** Only ran `npx tsc --noEmit` and `npm run lint` before committing. Skipped `npx playwright test`.

**Broke:** Changed `createConversationWithMessage` to save the first message to DB before navigation. This caused ConversationProvider's auto-start AI to fire on the first message (previously it didn't because the message wasn't in DB yet). The e2e test `multiple messages in a conversation` expected 2 assistant responses but got 3. Wasted 30+ minutes debugging CI failures on the PR.

Also: separate mobile auth setup was needed (Clerk ties sessions to user-agent), which would have been caught immediately by running tests locally.

**Fix:** Always run `npx playwright test` locally before pushing any change that touches:

- Conversation creation flow
- AI auto-start / message handling
- Auth / middleware
- Any server action that e2e tests exercise

**Watch out:** `tsc` and `lint` only check types and style — they cannot detect behavioral changes like "AI now responds to the first message too". If you changed _how_ something works (not just _what types_ it has), run the full test suite.
