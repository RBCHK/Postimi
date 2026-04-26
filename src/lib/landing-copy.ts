/**
 * All user-facing strings on the marketing landing page.
 *
 * Keep them here (not inline in JSX) so wrapping with `useTranslations()`
 * later is a five-minute job. Order mirrors the section order in
 * `src/app/page.tsx` and `design-handoff/landing/SECTIONS.md`.
 */

export const LANDING_COPY = {
  nav: {
    brand: "Postimi",
    beta: "Beta",
    links: [
      { href: "#how", label: "How it works" },
      { href: "#strategist", label: "Strategist" },
      { href: "#voice", label: "Voice Bank" },
      { href: "#faq", label: "FAQ" },
    ] as const,
    signIn: "Sign in",
    join: "Join waitlist",
    openApp: "Open app",
  },

  hero: {
    pillTemplate: (count: number) =>
      `Invite-only · ${count.toLocaleString("en-US")} creators on waitlist`,
    headlineLead: "An AI strategist that reads your data,",
    headlineAccent: "and tells you what to post next.",
    leadParagraph:
      "Postimi reads your analytics, learns your voice, and helps you plan and publish content that actually moves the needle — without the rocket-emoji vibes.",
    ctaPrimary: "Get early access",
    ctaSecondary: "See it in 90 seconds",
    finePrint: "No credit card · 14-day trial",
    platformsLabel: "Built for the platforms creators actually grow on",
    platforms: [
      { label: "X / Twitter", icon: "twitter" },
      { label: "LinkedIn", icon: "linkedin" },
      { label: "Threads", icon: "threads" },
    ] as const,
  },

  pillars: {
    eyebrow: "What it does",
    headlineLead: "Three things that compound.",
    headlineMuted: "Everything else is a distraction.",
    items: [
      {
        title: "AI Strategist",
        description:
          "Studies your weekly metrics, search queries, and follower behavior. Gives you a plan, not a dashboard.",
        icon: "target",
      },
      {
        title: "Voice Bank",
        description:
          "Saves your best phrases, openers, and patterns. AI drafts in your voice — not generic LLM-speak.",
        icon: "voice",
      },
      {
        title: "Plan & Publish",
        description:
          "Slot-based schedule, multi-platform variants, auto-publish. Your week of content, lined up Sunday night.",
        icon: "calendar",
      },
    ] as const,
  },

  howItWorks: {
    eyebrow: "How it works",
    headlineLead: "From a blank page to a week of posts",
    headlineAccent: "in one Sunday evening.",
    steps: [
      {
        n: "01",
        title: "Connect your accounts",
        description:
          "OAuth into X, LinkedIn, Threads. We pull your historical analytics — CSV/XLSX or API.",
      },
      {
        n: "02",
        title: "Train your voice",
        description:
          "Pick 10–20 of your best posts. Postimi extracts the phrases and patterns that make your voice yours.",
      },
      {
        n: "03",
        title: "Get your weekly plan",
        description:
          "The Strategist analyzes the week. You get a markdown brief with what to post, when, and why.",
      },
      {
        n: "04",
        title: "Draft and ship",
        description:
          "AI co-writes drafts that match your voice. Schedule, auto-publish, see what worked.",
      },
    ] as const,
  },

  strategist: {
    eyebrow: "The Strategist",
    headlineLead: "Most tools give you charts.",
    headlineAccent: "We give you a plan.",
    lead: "Every Sunday, an AI strategist studies your week — what you posted, what landed, what your audience actually engaged with. It searches your space, reads the room, then writes you a plan in plain English.",
    bullets: [
      "Reads your analytics and your competitors’",
      "Shows the search queries it ran (no black box)",
      "Proposes specific posts, slots, and angles",
      "You accept, tweak, or ignore — your call",
    ],
  },

  voice: {
    eyebrow: "Voice Bank",
    headlineLead: "AI shouldn’t sound",
    headlineAccent: "like AI.",
    lead: "Save the phrases, openers, and rhythms that are unmistakably yours. Postimi drafts using your library — not the generic SaaS-LLM voice that infects every AI tool.",
    quote:
      "Drafts feel like me on a good writing day — not a hostage version of me run through a content optimizer.",
    quoteAttribution: "— Beta tester · 8.4k followers on X",
  },

  analytics: {
    eyebrow: "Analytics that answer questions",
    headlineLead: "Charts are a means.",
    headlineMuted: "Decisions are the end.",
    lead: 'Every metric leads with a sentence, not a number. "Your threads drove 63% of impressions this week" — then the chart, if you want to look closer.',
  },

  comparison: {
    eyebrow: "How we’re different",
    headlineLead: "We’re not Buffer.",
    headlineMuted: "We’re not Jasper. We don’t want to be.",
    columnHeaders: ["Postimi", "Buffer / Hootsuite", "Generic AI writer"],
    rows: [
      [
        "Built for",
        "Solo creators & founders",
        "Marketing teams, 100s of accounts",
        "Anyone with a prompt",
      ],
      ["AI that learns your voice", "✓", "—", "Generic LLM voice"],
      ["Strategy from your data", "✓ Weekly plan", "Schedule only", "—"],
      ["Multi-platform variants", "✓ X / LinkedIn / Threads", "✓ All", "—"],
      ["Honest about what it does", "Shows search queries", "Black box", "Black box"],
    ] as const,
  },

  testimonials: {
    eyebrow: "Early signal",
    quotes: [
      {
        text: "It’s the first AI writing tool that doesn’t make my posts feel like a press release.",
        author: "Maya R.",
        role: "Indie founder · 12k on X",
      },
      {
        text: "The Sunday plan saves me three hours of staring at a blank doc. That alone is worth it.",
        author: "Daniel K.",
        role: "Solo dev · 4.7k on LinkedIn",
      },
      {
        text: "The Voice Bank thing sounds gimmicky until you read drafts that genuinely sound like you.",
        author: "Priya S.",
        role: "Writer · 21k on Threads",
      },
    ] as const,
  },

  founderNote: {
    eyebrow: "Why we built this",
    body: [
      "I spent two years posting on X and LinkedIn alongside building products. The tools were either glorified schedulers or AI-slop generators. Nothing read my analytics like a strategist would. Nothing wrote like me.",
      "So I built it. Postimi is the tool I wished existed — calm, honest, and on the side of the writer.",
    ],
    name: "Artem Rybachuk",
    role: "Founder · @razRBCHK",
    initials: "AR",
  },

  faq: {
    eyebrow: "Questions",
    headline: "The honest answers.",
    items: [
      {
        q: "Is Postimi a Buffer/Hootsuite replacement?",
        a: "No. We’re a focused tool for solo creators and personal brands — one user, a few accounts. If you’re managing 50 brand accounts, Buffer is built for you. We’re not.",
      },
      {
        q: "How does the AI learn my voice?",
        a: "You curate 10–20 posts that you think represent you well. Postimi extracts the phrases, openers, and patterns into your Voice Bank. Drafts pull from there — not from a generic LLM personality.",
      },
      {
        q: "Which platforms do you support?",
        a: "X, LinkedIn, and Threads at launch. We’re focused on platforms where personal brands actually grow — not every social channel ever invented.",
      },
      {
        q: "Where does the analytics data come from?",
        a: "X via API or CSV export. LinkedIn via XLSX export (the only legal path — they have no API for post analytics). Threads via the Insights API.",
      },
      {
        q: "How much does it cost?",
        a: "Pricing is finalizing during beta. Expect a single subscription tier in the $20–$30/month range. Yearly will be discounted. Waitlist members get founder pricing locked in.",
      },
      {
        q: "Why is it invite-only?",
        a: "We want to support every early user properly while we iterate. The waitlist moves fast — most people are off it within 2 weeks.",
      },
    ] as const,
  },

  waitlist: {
    eyebrow: "Join the waitlist",
    headlineLead: "Write less.",
    headlineAccent: "Land more.",
    lead: "Founder pricing for early members. We’ll email when your invite is ready — usually within 2 weeks.",
    fineprintTemplate: (count: number) =>
      `${count.toLocaleString("en-US")} creators on the list · No spam · Unsubscribe anytime`,
  },

  footer: {
    tagline: "An AI growth copilot for solo creators on X, LinkedIn, and Threads.",
    columns: [
      {
        heading: "Product",
        links: [
          { label: "How it works", href: "#how" },
          { label: "Strategist", href: "#strategist" },
          { label: "Voice Bank", href: "#voice" },
        ],
      },
      {
        heading: "Company",
        links: [{ label: "Contact", href: "mailto:hello@postimi.com" }],
      },
      {
        heading: "Legal",
        links: [
          { label: "Privacy", href: "/legal/privacy" },
          { label: "Terms", href: "/legal/terms" },
        ],
      },
    ] as const,
    copyright: `© ${new Date().getFullYear()} Postimi. All rights reserved.`,
    motto: "Made for writers · Not for marketers",
  },
} as const;
