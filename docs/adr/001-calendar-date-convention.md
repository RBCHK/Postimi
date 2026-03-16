# ADR-001: Calendar dates stored as UTC midnight

## Status

Accepted

## Context

xREBA stores calendar days (schedule slots, analytics, goals) in PostgreSQL `DateTime` fields. Need a convention that works across timezones for a multi-user SaaS on Vercel (UTC server).

## Decision

Store calendar dates as `YYYY-MM-DDT00:00:00.000Z` — the **UTC date component IS the calendar day**. This is a representation convention, not a real UTC timestamp.

- Extract date string: `calendarDateStr(date)` from `@/lib/date-utils` or `.toISOString().slice(0, 10)`
- Display: `toLocaleDateString(locale, { timeZone: "UTC" })`
- Parse: `new Date(\`${str}T00:00:00.000Z\`)`

## Why not alternatives

| Alternative                              | Problem                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Local midnight (`new Date(2026, 2, 15)`) | Varies by server TZ; Vercel = UTC but dev machine differs                                                        |
| Plain string `"2026-03-15"`              | Loses `Date` type in Prisma; can't use `gte`/`lte` queries                                                       |
| Real UTC timestamp                       | A slot at "2 PM Vancouver on Mar 15" = `2026-03-15T22:00:00Z`, but we need to group by calendar day, not instant |
| Store with user's timezone offset        | Complicates queries; different users see different offsets                                                       |

## Consequences

- **Never** use `toLocaleDateString(locale, { timeZone: userTZ })` on calendar dates — UTC midnight shifts to previous day for users west of UTC
- `formatSlotDate()` correctly uses `timeZone: "UTC"` — this is intentional, not a bug
- Real timestamps (`postedAt`, `createdAt`) are NOT calendar dates — display those with browser local time
