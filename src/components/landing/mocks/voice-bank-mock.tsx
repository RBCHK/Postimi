const SNIPPETS = [
  {
    kind: "PHRASE",
    text: "I keep coming back to this idea: build less, ship more, iterate in public.",
  },
  {
    kind: "OPENER",
    text: "Most {x} advice is built for {audience-A}, not {audience-B}.",
  },
  {
    kind: "PHRASE",
    text: "Optimize for signal, not reach. Reach is rented; signal compounds.",
  },
  {
    kind: "CLOSER",
    text: "More on this in the replies — what’s missing?",
  },
];

export function VoiceBankMock() {
  return (
    <div
      className="w-full overflow-hidden rounded-[20px] border border-border shadow-[var(--shadow-lg)]"
      style={{ background: "var(--bg-1)" }}
    >
      <div
        className="flex h-8 items-center gap-1.5 border-b border-border px-3"
        style={{ background: "var(--bg-2)" }}
      >
        <span className="size-2.5 rounded-full" style={{ background: "var(--bg-3)" }} />
        <span className="size-2.5 rounded-full" style={{ background: "var(--bg-3)" }} />
        <span className="size-2.5 rounded-full" style={{ background: "var(--bg-3)" }} />
        <span
          className="ml-3 font-mono text-[11px] tracking-[0.02em]"
          style={{ color: "var(--text-3)" }}
        >
          postimi.app — Voice Bank
        </span>
      </div>
      <div className="overflow-hidden p-[22px]" style={{ height: 380, background: "var(--bg-1)" }}>
        <div className="mb-4 flex flex-wrap gap-2">
          <span
            className="inline-flex h-7 items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] font-medium tracking-[0.04em]"
            style={{
              background: "var(--accent-soft)",
              borderColor: "var(--accent-border)",
              color: "var(--accent-text)",
            }}
          >
            @razRBCHK · Active voice
          </span>
          <span
            className="inline-flex h-7 items-center rounded-full border border-border px-3 font-mono text-[11px] font-medium tracking-[0.04em]"
            style={{ background: "var(--bg-2)", color: "var(--text-2)" }}
          >
            142 references
          </span>
          <span
            className="inline-flex h-7 items-center rounded-full border border-border px-3 font-mono text-[11px] font-medium tracking-[0.04em]"
            style={{ background: "var(--bg-2)", color: "var(--text-2)" }}
          >
            EN · RU
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SNIPPETS.map((s, i) => (
            <div
              key={i}
              className="rounded-[10px] border border-border p-3.5"
              style={{ background: "var(--bg-2)" }}
            >
              <div
                className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                style={{ color: "var(--accent-text)" }}
              >
                {s.kind}
              </div>
              <div className="text-[13px] leading-[1.5]" style={{ color: "var(--text-0)" }}>
                {s.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
