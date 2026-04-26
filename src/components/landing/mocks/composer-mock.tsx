import { AppFrame } from "@/components/landing/mocks/app-frame";
import { Calendar, Send, Sparkles } from "@/components/landing/icons";

export function ComposerMock() {
  return (
    <AppFrame title="postimi.app — Compose">
      <div className="flex items-center justify-between gap-3 border-b border-border px-[18px] py-3.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold" style={{ color: "var(--text-0)" }}>
            Why most growth advice fails technical founders
          </div>
          <div className="font-mono text-[10px]" style={{ color: "var(--text-3)" }}>
            Autosaved · 247 / 280
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <span
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px]"
            style={{ background: "var(--bg-2)", color: "var(--text-1)" }}
          >
            <Calendar className="size-3" /> Schedule
          </span>
          <span
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-white"
            style={{ background: "var(--accent-color)" }}
          >
            <Send className="size-3" /> Publish
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-1 flex-col gap-3.5 px-[22px] py-5">
          <div className="flex gap-2 text-xs" style={{ color: "var(--text-2)" }}>
            <Sparkles
              className="mt-0.5 size-3.5 shrink-0"
              style={{ color: "var(--accent-text)" }}
            />
            <div>
              Drafted from your top thread last week. Hook leans into a contrarian frame — your
              highest-engagement pattern.
            </div>
          </div>
          <div
            className="rounded-[10px] border border-border p-3.5"
            style={{ background: "var(--bg-2)" }}
          >
            <div className="text-[12.5px] leading-[1.55]" style={{ color: "var(--text-0)" }}>
              Most &quot;grow on Twitter&quot; advice is built for marketers, not engineers.
              <br />
              <br />
              They optimize for reach. You optimize for signal.
              <br />
              <br />
              5 lessons after 18 months of writing for technical founders
              <span className="cursor-blink" />
            </div>
          </div>
          <div
            className="mt-auto rounded-xl border p-3 shadow-[var(--shadow-md)]"
            style={{
              background: "var(--bg-1)",
              borderColor: "var(--border-strong)",
            }}
          >
            <div className="text-xs" style={{ color: "var(--text-3)" }}>
              Make it punchier · Add a stat · Variations →
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-[10px]" style={{ color: "var(--text-3)" }}>
                ⌘↵ to send
              </span>
              <span
                className="inline-flex size-6 items-center justify-center rounded-md text-white"
                style={{ background: "var(--accent-color)" }}
              >
                <Send className="size-3" />
              </span>
            </div>
          </div>
        </div>
        <aside
          className="hidden w-[200px] border-l border-border p-3.5 lg:block"
          style={{ background: "var(--bg-1)" }}
        >
          <div
            className="mb-2 font-mono text-[9px] uppercase tracking-[0.08em]"
            style={{ color: "var(--text-3)" }}
          >
            Live preview · X
          </div>
          <div className="rounded-lg p-2.5" style={{ background: "var(--bg-2)" }}>
            <div className="mb-1.5 flex gap-1.5">
              <div
                className="size-[22px] rounded-full"
                style={{ background: "var(--accent-color)" }}
              />
              <div>
                <div className="text-[10px] font-semibold" style={{ color: "var(--text-0)" }}>
                  Artem
                </div>
                <div className="text-[9px]" style={{ color: "var(--text-3)" }}>
                  @razRBCHK · now
                </div>
              </div>
            </div>
            <div className="text-[10px] leading-[1.5]" style={{ color: "var(--text-1)" }}>
              Most &quot;grow on Twitter&quot; advice is built for marketers, not engineers…
            </div>
          </div>
          <div
            className="mt-3 rounded-md border p-2"
            style={{
              background: "var(--accent-soft)",
              borderColor: "var(--accent-border)",
            }}
          >
            <div className="mb-0.5 text-[10px] font-medium" style={{ color: "var(--accent-text)" }}>
              Hook score · 8.4
            </div>
            <div className="text-[9px]" style={{ color: "var(--text-2)" }}>
              Above your 30-day median (6.1).
            </div>
          </div>
        </aside>
      </div>
    </AppFrame>
  );
}
