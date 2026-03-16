export interface Hook {
  id: number;
  name: string;
  description: string;
  formula: string;
  example: string;
}

export const HOOKS: Hook[] = [
  {
    id: 1,
    name: "Counterintuitive Truth",
    description:
      "State something that sounds wrong but is actually correct. Forces the reader to stop and verify.",
    formula: "[Common belief] is wrong. Here's what's actually happening:",
    example:
      "The app store was never built for grandmas — first, power users built it, then grandmas showed up.",
  },
  {
    id: 2,
    name: "Specific Number",
    description: "Lead with a concrete, specific number that creates curiosity or shock.",
    formula: "[Specific number] [unexpected context]",
    example:
      '9 out of 10 "AI productivity" posts are written by people who haven\'t shipped in 6 months.',
  },
  {
    id: 3,
    name: "Hidden Cost / Dark Side",
    description: "Reveal the downside or cost everyone ignores about a popular idea or tool.",
    formula: "The real cost of [popular thing] nobody talks about:",
    example: "The real cost of shipping live: your app is secondary. The broadcast is the product.",
  },
  {
    id: 4,
    name: "Pattern Interrupt",
    description: "Start with something that breaks the expected pattern of your niche.",
    formula: "[Bold claim that contradicts niche consensus]",
    example:
      "Hiring an HR chief while your own product replaces HR functions. The irony isn't lost on anyone.",
  },
  {
    id: 5,
    name: "Before/After Transformation",
    description: "Show a specific transformation — the delta is the hook.",
    formula: "[Specific before state] → [Specific after state]. Here's what changed:",
    example:
      "We're moving from 'AI as a tool you use' to 'AI as a team that works for you'. All automated. All coordinated. All invisible.",
  },
  {
    id: 6,
    name: "Inside Information",
    description: "Share something most people don't have access to — data, experience, or context.",
    formula: "After [specific experience], here's what I learned that surprised me:",
    example:
      "After running reply sessions every day for 3 months: your writing style is more consistent than your fingerprint.",
  },
  {
    id: 7,
    name: "Prediction / Warning",
    description: "State a specific prediction about something happening soon. Creates urgency.",
    formula: "[Specific thing] is about to [change dramatically]. Here's why:",
    example:
      "The line between 'distillation' and 'learning from public output' is getting real blurry — and everyone building models knows it.",
  },
];

export function formatHooksForPrompt(): string {
  return HOOKS.map(
    (h) =>
      `Hook ${h.id} – ${h.name}: ${h.description}\n  Formula: "${h.formula}"\n  Example: ${h.example}`
  ).join("\n\n");
}
