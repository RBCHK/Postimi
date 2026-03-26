# React — Styling & Design System

### Inline page headers instead of `<PageHeader>`

**Tried:** Custom `<h1 className="text-2xl font-bold">` in each page view
**Broke:** 6 pages had 3 different h1 styles (text-2xl/text-xl/text-lg, font-bold/font-semibold). Visual inconsistency across the app.
**Fix:** Use `<PageHeader title icon? subtitle?>` from `@/components/page-header`. Action buttons go in `children` slot. Never write raw `<h1>` in page views.
**Watch out:** subtitle is `text-xs text-muted-foreground` — don't add extra wrappers.

### Inline empty states instead of `<EmptyState>`

**Tried:** `<p className="text-center text-muted-foreground py-8">No data</p>` scattered across pages
**Broke:** 7+ variations with different padding (py-4 to py-20), different text sizes, inconsistent icon usage.
**Fix:** Use `<EmptyState message description? icon? size?>` from `@/components/empty-state`. Three sizes: `compact` (inline lists), `default` (main content), `large` (full-page with icon + description).

### Inline section labels instead of `<SectionLabel>`

**Tried:** `<h2 className="text-sm font-medium text-muted-foreground">` or `<span>` with varying styles
**Broke:** Section headers had 3 different font-size/weight/case combos across pages.
**Fix:** Use `<SectionLabel icon?>` from `@/components/section-label`. Always `text-xs font-medium uppercase tracking-wider text-muted-foreground`.

### Custom button heights

**Tried:** `className="h-7 px-2 text-xs"` on shadcn `<Button>`
**Broke:** Buttons had inconsistent heights (h-7, h-8, h-9, h-10). h-7 is not a standard shadcn size and looks off next to h-8 buttons.
**Fix:** Only use shadcn `<Button>` size props: `default` (h-9), `sm` (h-8), `xs` (h-6), `icon` (h-9), `icon-sm` (h-8), `icon-xs` (h-6). Never set custom `h-` classes on buttons.
**Watch out:** If you need a height that doesn't exist in the size variants, it means you're using the wrong size — pick the closest standard one.

### Duplicated chart tooltip component

**Tried:** `CustomTooltip` component copy-pasted inside each Recharts chart file
**Broke:** 5 chart files had identical tooltip with UTC date parsing logic, each slightly drifting.
**Fix:** Use `<ChartTooltip>` from `@/components/chart-tooltip`. Exception: charts with non-date X axis (like PostVelocityChart "Day N") keep their own tooltip.

### Wrong typography scale

**Tried:** `text-2xl font-bold` for card values, `text-lg font-semibold` for sub-headings
**Broke:** Typography had no consistent scale — sizes ranged from text-xs to text-2xl with no system.
**Fix:** Strict scale: page title `text-xl font-semibold` (via PageHeader), section content `text-base`, card title `text-sm font-medium`, body `text-sm`, caption `text-xs`. Never use `text-2xl`, `text-lg`, or `font-bold` in page content.
