# ADR-007: Open-registration path — waitlist → invitation → paid subscription

## Status

Accepted (in progress — see Postimi launch plan, PRs 2–7)

## Context

Postimi (ex-xREBA) is moving from "private dev app owned by a single developer" to a public multi-user SaaS. Every new user costs real money through Anthropic LLM calls, Tavily search, and X / LinkedIn / Threads API usage. We cannot open a public sign-up form without both a payment gate and a spending cap — otherwise a handful of free users would burn the founder's personal finances.

At the same time, marketing on X/Twitter is ready to start. We need a live landing page collecting interest **now**, while the payment rails and quota system are still being built, so that waitlist signups and paid-infra work can proceed in parallel.

The decision this ADR freezes: **the exact end-to-end path from "interested stranger on Twitter" to "first paying customer"**, so that each subsequent PR can reference this contract instead of re-debating it.

## Decision

### Four-layer gate

Between an anonymous web visitor and actual AI usage sit four sequential gates:

1. **Waitlist capture (public)** — anyone can submit an email. Stored in Prisma `WaitlistEntry`. Clerk **Restricted Mode** blocks self-serve sign-up for the entire waitlist phase.
2. **Invitation (founder-controlled)** — founder manually selects waitlist entries in an admin UI and triggers a batch. For each selected entry, the server creates a Clerk **Invitation** (via Backend API) and sends the invitation email through **Resend**. Invitation ticket is the _only_ way to reach sign-up.
3. **Sign-up (invitation ticket)** — Clerk invitation ticket bypasses Restricted Mode and creates a new `User`. The Clerk `user.created` webhook links `WaitlistEntry.convertedUserId` for conversion tracking. Sign-up alone does **not** grant AI access.
4. **Active subscription (Stripe)** — before any server action or API route that calls Anthropic, code checks `getActiveSubscription(userId)`. No active subscription → redirect to `/settings/billing`. Hard quota (`monthlyAiQuotaUsd`) is checked on top of subscription status — spend over the cap returns a typed `QuotaExceededError`.

### Data model summary

```
WaitlistEntry (new)
  email, source, locale, ipHash, priority, createdAt
  invitedAt, invitationId, convertedUserId (→ User)

Subscription (new, PR 5)
  userId (→ User, unique), stripeCustomerId, stripeSubscriptionId,
  stripePriceId, status (enum), currentPeriodStart/End,
  cancelAtPeriodEnd, canceledAt

AiUsage (new, PR 6)
  userId, operation, model, tokensIn, tokensOut, costUsd, createdAt

User (extend)
  monthlyAiQuotaUsd (nullable — null = use plan default)
  stripeCustomerId (cache)
```

### Quota model

- Each plan has a `monthlyAiQuotaUsd` default, currently hardcoded in `src/lib/plans.ts`.
- Spend = `SUM(AiUsage.costUsd WHERE userId AND createdAt >= subscription.currentPeriodStart)`.
- Hard cap: if `spent + estimatedCostUsd > quota`, `checkQuota()` throws `QuotaExceededError` and the request is rejected **before** hitting Anthropic.
- **Owner bypass:** the founder's Clerk ID is in `ADMIN_CLERK_IDS` and bypasses both the subscription check and the quota check. Otherwise the founder would get locked out of their own product while dogfooding.
- **Cost tracking** is recorded post-hoc in `recordUsage()` with the actual token counts from the Anthropic SDK. Tracking failure is non-fatal (per CLAUDE.md "non-critical side effects must never abort the critical path").

### Error taxonomy

All payment/quota errors live in one file (`src/lib/errors.ts`) as typed classes, so server actions can catch by `instanceof` and return structured results:

- `SubscriptionRequiredError` — thrown by `requireActiveSubscription()`
- `QuotaExceededError(usedUsd, limitUsd)` — thrown by `checkQuota()` when the estimate would cross the cap

No `throw new Error("SOME_STRING")` for known conditions — the string literal approach makes call sites fragile and prevents the compiler from catching missed cases.

### Single choke point for AI calls

Every Anthropic call in the codebase — server actions, API routes, cron jobs — must go through `withAiQuota()` (or `withStreamingAiQuota()` for streaming endpoints). Direct imports of `@ai-sdk/anthropic` outside this wrapper are forbidden. This gives us:

- One place to evolve the pricing table.
- One place to add Redis-based distributed quota in the future.
- One place to add per-feature cost caps or user notifications.

### What this ADR intentionally does NOT decide

- **Trial period** — current default is "no trial in v1." Can be added via Stripe Checkout `subscription_data.trial_period_days` later without schema changes.
- **Multiple plans** — v1 ships one plan ("Postimi Pro"). The `PLANS` constant is already a map, so adding "Postimi Team" later is additive.
- **Seat-based billing** — out of scope. Single-user subscriptions only.
- **Soft cap with overage billing** — explicitly rejected in favor of hard cap for v1: "predictable max spend" > "smoother UX near the cap." Can revisit once there are actual users hitting the cap.

## Consequences

**Positive**

- No open floodgate. Every new user is an intentional decision by the founder.
- Spending is bounded per-user AND per-plan. Even under abuse, max damage = `users × monthlyAiQuotaUsd`.
- Waitlist funnel is measurable end-to-end (`source → invited → converted → subscribed`).
- Marketing can start on day 1 of this plan (PR 3 ships landing), not on day N (after payment infra).

**Negative**

- Growth is gated by the founder's invitation throughput. Not a concern at pre-launch scale; will need to be revisited before Product Hunt / big marketing pushes.
- `ADMIN_CLERK_IDS` is a single config value; misconfiguring it (typo, extra whitespace) locks the founder out of their own AI features. Mitigation: `ADMIN_CLERK_IDS` parsing is centralized in `src/lib/auth.ts`; a test asserts `isAdminClerkId("user_abc123")` returns `true` when the env contains the value.
- Cost estimates for streaming endpoints must be conservative — actual token counts are only known after the response. Grace-period overshoot on 2–3 parallel requests is accepted for the waitlist phase; distributed quota is deferred until real contention shows up.
- Clerk free plan has an invitation cap (currently ~500 pending). Will need to check against actual waitlist size before any big batch send.

## Related work

- PR 2 (this PR) — `WaitlistEntry` schema + `joinWaitlist` server action
- PR 3 — subdomain split + landing + waitlist UI
- PR 4 — DNS / Clerk production instance / env swap (go-live)
- PR 5 — Stripe subscription + webhook + billing UI
- PR 6 — `AiUsage` tracking + `checkQuota` / `recordUsage` / `withAiQuota` wrapper
- PR 7 — Clerk Invitations + Resend + admin waitlist UI + billing gate
