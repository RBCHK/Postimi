import { AppFrame } from "@/components/landing/mocks/app-frame";
import { Target } from "@/components/landing/icons";

const PLAN_ROWS = [
  {
    title: "Ship 1 contrarian thread on Tuesday",
    why: "highest pattern: 4.2× engagement vs. average",
  },
  {
    title: "Reply faster to @swyx and @dcurtis",
    why: "their threads peak in your timezone at 9–11am",
  },
  {
    title: "Skip Friday afternoons",
    why: "your Friday posts get 28% lower impressions",
  },
];

export function StrategistMock() {
  return (
    <AppFrame title="postimi.app — Strategist">
      <div className="border-b border-border px-[18px] py-3.5">
        <div className="flex items-center gap-2">
          <Target className="size-3.5" style={{ color: "var(--accent-text)" }} />
          <div className="text-[13px] font-semibold" style={{ color: "var(--text-0)" }}>
            Weekly analysis · Apr 13 — 19
          </div>
          <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--text-3)" }}>
            X · 12 posts · 38.2k imp
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <div
          className="mb-3.5 rounded-[10px] border border-border p-4"
          style={{ background: "var(--bg-2)" }}
        >
          <div
            className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.08em]"
            style={{ color: "var(--text-3)" }}
          >
            The headline
          </div>
          <div className="text-[15px] font-medium leading-[1.4]" style={{ color: "var(--text-0)" }}>
            Your <span style={{ color: "var(--accent-text)" }}>contrarian threads</span> drove 63%
            of impressions this week. Replies on weekday mornings are your highest-leverage
            activity.
          </div>
        </div>
        <div
          className="mb-2 font-mono text-[9px] uppercase tracking-[0.08em]"
          style={{ color: "var(--text-3)" }}
        >
          Plan for next week
        </div>
        {PLAN_ROWS.map((r, i) => (
          <div key={r.title} className="flex gap-2.5 border-b border-border py-2.5">
            <div
              className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold"
              style={{
                background: "var(--accent-soft)",
                borderColor: "var(--accent-border)",
                color: "var(--accent-text)",
              }}
            >
              {i + 1}
            </div>
            <div>
              <div className="text-[12.5px] font-medium" style={{ color: "var(--text-0)" }}>
                {r.title}
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {r.why}
              </div>
            </div>
          </div>
        ))}
        <div className="mt-3.5 flex gap-2">
          <span
            className="inline-flex h-7 items-center rounded-md px-3 text-[11px] font-medium text-white"
            style={{ background: "var(--accent-color)" }}
          >
            Accept plan
          </span>
          <span
            className="inline-flex h-7 items-center rounded-md border border-border px-3 text-[11px]"
            style={{ background: "var(--bg-2)", color: "var(--text-1)" }}
          >
            Tweak
          </span>
        </div>
      </div>
    </AppFrame>
  );
}
