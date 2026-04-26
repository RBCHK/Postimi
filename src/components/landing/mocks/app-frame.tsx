/**
 * Faux macOS app window frame used by the marketing mock screenshots.
 *
 * Three traffic-light dots and a centered title bar. The mocks themselves
 * are static (not the real product UI) — they communicate intent until
 * we have real screenshots/video. See OPEN_QUESTIONS.md.
 */
import { Plus } from "@/components/landing/icons";

type FrameProps = {
  children: React.ReactNode;
  title?: string;
  showSidebar?: boolean;
  height?: number;
};

export function AppFrame({
  children,
  title = "postimi.app",
  showSidebar = true,
  height = 460,
}: FrameProps) {
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
          {title}
        </span>
      </div>
      <div className="flex" style={{ height, background: "var(--bg-1)" }}>
        {showSidebar && <MiniSidebar />}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

function MiniSidebar() {
  return (
    <div
      className="hidden w-[180px] shrink-0 border-r border-border p-2.5 text-[11px] sm:block"
      style={{ background: "var(--bg-1)" }}
    >
      <div className="flex items-center gap-1.5 px-1.5 pb-3 pt-1">
        <div
          className="flex size-[18px] items-center justify-center rounded-[5px] text-[10px] font-bold text-white"
          style={{
            background: "linear-gradient(135deg, var(--accent-color), oklch(0.62 0.18 320))",
          }}
        >
          P
        </div>
        <span className="text-xs font-semibold" style={{ color: "var(--text-0)" }}>
          Postimi
        </span>
      </div>
      <div
        className="mb-2 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[11px]"
        style={{
          background: "var(--accent-soft)",
          color: "var(--accent-text)",
          borderColor: "var(--accent-border)",
        }}
      >
        <Plus className="size-3" /> New draft
      </div>
      <div
        className="px-1.5 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.08em]"
        style={{ color: "var(--text-3)" }}
      >
        Today
      </div>
      {[
        { t: "Why most growth advice…", c: "var(--accent-color)" },
        { t: "AI cost trend framework", c: "oklch(0.72 0.13 220)" },
        { t: "Reply to @dcurtis", c: "oklch(0.75 0.14 160)" },
      ].map((d) => (
        <div key={d.t} className="flex items-center gap-1.5 rounded px-1.5 py-1">
          <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: d.c }} />
          <span className="truncate text-[11px]" style={{ color: "var(--text-1)" }}>
            {d.t}
          </span>
        </div>
      ))}
      <div
        className="px-1.5 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.08em]"
        style={{ color: "var(--text-3)" }}
      >
        Earlier
      </div>
      {["5 lessons shipping v1", "Empty draft"].map((t) => (
        <div key={t} className="flex items-center gap-1.5 rounded px-1.5 py-1">
          <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: "var(--bg-3)" }} />
          <span className="truncate text-[11px]" style={{ color: "var(--text-2)" }}>
            {t}
          </span>
        </div>
      ))}
    </div>
  );
}
