import { AppFrame } from "@/components/landing/mocks/app-frame";

const STATS = [
  { label: "Impressions", value: "38.2k", delta: "+24%", up: true },
  { label: "Followers", value: "+412", delta: "+8%", up: true },
  { label: "Engagement", value: "5.6%", delta: "+0.4", up: true },
  { label: "Top hour", value: "9–11am", delta: "weekdays", up: false },
];

const PERIODS = ["Day", "Week", "Month"];
const ACTIVE_PERIOD = 1;

const W = 600;
const H = 180;
const P = 8;

function buildChart() {
  const points = Array.from({ length: 30 }, (_, i) => {
    const base = 30 + Math.sin(i * 0.5) * 12 + i * 1.4;
    return Math.max(8, base + (i > 22 ? (i - 22) * 6 : 0));
  });
  const max = Math.max(...points);
  const path = points
    .map((v, i) => {
      const x = P + (i / (points.length - 1)) * (W - 2 * P);
      const y = H - P - (v / max) * (H - 2 * P);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L${W - P},${H - P} L${P},${H - P} Z`;
  const dots = points
    .map((v, i) => {
      if (i % 5 !== 0) return null;
      const x = P + (i / (points.length - 1)) * (W - 2 * P);
      const y = H - P - (v / max) * (H - 2 * P);
      return { x, y, key: i };
    })
    .filter((d): d is { x: number; y: number; key: number } => d !== null);
  return { path, area, dots };
}

export function AnalyticsMock() {
  const { path, area, dots } = buildChart();
  return (
    <AppFrame title="postimi.app — Analytics" showSidebar={false} height={460}>
      <div className="flex items-center gap-3 border-b border-border px-[22px] py-3.5">
        <div className="text-[13px] font-semibold" style={{ color: "var(--text-0)" }}>
          X · last 30 days
        </div>
        <div className="ml-auto flex gap-1">
          {PERIODS.map((p, i) => (
            <span
              key={p}
              className="inline-flex h-6 items-center rounded-[5px] border px-2.5 text-[11px]"
              style={{
                background: i === ACTIVE_PERIOD ? "var(--bg-2)" : "transparent",
                borderColor: i === ACTIVE_PERIOD ? "var(--border)" : "transparent",
                color: i === ACTIVE_PERIOD ? "var(--text-0)" : "var(--text-3)",
              }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-[22px] px-[22px] py-5">
        {STATS.map((k) => (
          <div key={k.label} className="min-w-[110px]">
            <div
              className="mb-1 font-mono text-[9px] uppercase tracking-[0.08em]"
              style={{ color: "var(--text-3)" }}
            >
              {k.label}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="text-2xl font-semibold tracking-[-0.02em]"
                style={{ color: "var(--text-0)" }}
              >
                {k.value}
              </span>
              <span
                className="font-mono text-[11px]"
                style={{
                  color: k.up ? "var(--success)" : "var(--text-3)",
                }}
              >
                {k.delta}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col px-[22px] pb-[22px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="size-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="landingChartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.65 0.19 285)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="oklch(0.65 0.19 285)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#landingChartFill)" />
          <path d={path} fill="none" stroke="oklch(0.72 0.16 285)" strokeWidth="2" />
          {dots.map((d) => (
            <circle key={d.key} cx={d.x} cy={d.y} r="2.5" fill="oklch(0.72 0.16 285)" />
          ))}
        </svg>
      </div>
    </AppFrame>
  );
}
