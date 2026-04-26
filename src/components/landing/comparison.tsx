import { Reveal } from "@/components/landing/primitives/reveal";
import { LANDING_COPY } from "@/lib/landing-copy";

export function Comparison() {
  const copy = LANDING_COPY.comparison;
  return (
    <section className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[980px]">
        <Reveal>
          <div className="eyebrow text-center">{copy.eyebrow}</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="h-section mx-auto mt-3.5 max-w-[720px] text-center">
            {copy.headlineLead} <span style={{ color: "var(--text-3)" }}>{copy.headlineMuted}</span>
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <div
            className="mt-14 overflow-hidden rounded-[14px] border border-border"
            style={{ background: "var(--bg-elev)" }}
          >
            {/* Desktop: 4-column grid (label + 3 vendors). Mobile: stack
                each row by collapsing into label-on-top, 3-column values. */}
            <div className="hidden md:block">
              <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] text-[13px]">
                <div className="px-5 py-4" />
                <div className="px-5 py-4 font-semibold" style={{ color: "var(--accent-text)" }}>
                  {copy.columnHeaders[0]}
                </div>
                <div className="px-5 py-4" style={{ color: "var(--text-3)" }}>
                  {copy.columnHeaders[1]}
                </div>
                <div className="px-5 py-4" style={{ color: "var(--text-3)" }}>
                  {copy.columnHeaders[2]}
                </div>
                {copy.rows.map((row) => (
                  <RowDesktop key={row[0]} row={row} />
                ))}
              </div>
            </div>
            <div className="block md:hidden">
              {copy.rows.map((row) => (
                <RowMobile key={row[0]} row={row} headers={copy.columnHeaders} />
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function RowDesktop({ row }: { row: readonly string[] }) {
  return (
    <>
      <div
        className="border-t border-border px-5 py-3.5 text-[13px]"
        style={{ color: "var(--text-1)" }}
      >
        {row[0]}
      </div>
      <div
        className="border-t border-border px-5 py-3.5 text-[13px] font-medium"
        style={{ color: "var(--text-0)", background: "var(--accent-soft)" }}
      >
        {row[1]}
      </div>
      <div
        className="border-t border-border px-5 py-3.5 text-[13px]"
        style={{ color: "var(--text-3)" }}
      >
        {row[2]}
      </div>
      <div
        className="border-t border-border px-5 py-3.5 text-[13px]"
        style={{ color: "var(--text-3)" }}
      >
        {row[3]}
      </div>
    </>
  );
}

function RowMobile({ row, headers }: { row: readonly string[]; headers: readonly string[] }) {
  return (
    <div className="border-b border-border p-4 last:border-b-0">
      <div className="mb-3 text-[13px] font-medium" style={{ color: "var(--text-1)" }}>
        {row[0]}
      </div>
      <div className="space-y-1.5 text-[13px]">
        {headers.map((h, i) => (
          <div key={h} className="flex justify-between gap-3">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.06em]"
              style={{ color: i === 0 ? "var(--accent-text)" : "var(--text-3)" }}
            >
              {h}
            </span>
            <span
              className="text-right text-[13px]"
              style={{
                color: i === 0 ? "var(--text-0)" : "var(--text-3)",
                fontWeight: i === 0 ? 500 : 400,
              }}
            >
              {row[i + 1]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
