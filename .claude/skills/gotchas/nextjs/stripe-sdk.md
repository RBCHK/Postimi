### Stripe SDK v17+: current_period moved to SubscriptionItem

**Tried:** `sub.current_period_start` / `sub.current_period_end` on `Stripe.Subscription`
**Broke:** `TS2339: Property 'current_period_start' does not exist on type 'Subscription'`
**Fix:** In Stripe SDK v17+, billing period fields moved from the subscription root to `sub.items.data[0].current_period_start` / `.current_period_end`. Always read from the first item.

### Stripe SDK: top-level throw on missing env var breaks builds

**Tried:** `if (!process.env.STRIPE_SECRET_KEY) throw new Error(...)` at module top level in `src/lib/stripe.ts`
**Broke:** Any import of `stripe.ts` (even transitive) crashes build/test if `STRIPE_SECRET_KEY` is not set.
**Fix:** Use lazy initialization via a `Proxy` that defers `new Stripe(...)` until first property access. The env var check runs at call-time, not import-time.

### Stripe SDK: Proxy for lazy init needs Reflect.get

**Tried:** `(getStripe() as Record<string | symbol, unknown>)[prop]`
**Broke:** `TS2352: Conversion of type 'Stripe' to type 'Record<string | symbol, unknown>' may be a mistake`
**Fix:** Use `Reflect.get(real, prop, receiver)` + bind functions: `typeof value === "function" ? value.bind(real) : value`
