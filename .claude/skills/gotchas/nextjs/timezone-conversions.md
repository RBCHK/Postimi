# Timezone — Slot Time Conversions

### setUTCHours with local time slots

**Tried:** `date.setUTCHours(h, m)` where h/m came from parsing "8:15 AM" (user's local time)
**Broke:** Slot at 8:15 AM Moscow (UTC+3) was treated as 8:15 AM UTC → appeared as already passed → auto-marked POSTED with green indicator
**Fix:** All timezone conversions go through `src/lib/date-utils.ts`:

- Server: `slotToUtcDate(date, timeSlot, timezone)` — uses `Intl.DateTimeFormat.formatToParts`
- Client: `slotToLocalDate(date, timeSlot)` — constructs browser-local Date
- Never use `setUTCHours` with local time values
  **Watch out:**
- `checkAndUpdatePassedSlots` also needs timezone — it compares slot times with `now` to auto-transition FILLED → POSTED. Without timezone, future slots get marked as posted.
- `new Date(localeString)` parses in SERVER's timezone, NOT UTC. On local dev (PT) with user in PT, the offset zeroes out. Use `formatToParts` + explicit "Z" suffix parsing instead.

### Inline timezone formatting scattered across actions

**Tried:** `now.toLocaleDateString("en-CA", { timeZone })` and `now.toLocaleTimeString(...)` copy-pasted in every function
**Broke:** Each copy was a chance to get the conversion wrong; some missed timezone param entirely
**Fix:** Use `nowInTimezone(timezone)` from `date-utils.ts` — returns `{ dateStr, timeSlot, date }` in one call. Single source of truth.
