import { Reveal } from "@/components/landing/primitives/reveal";
import { Calendar, Target, Voice } from "@/components/landing/icons";
import { LANDING_COPY } from "@/lib/landing-copy";

const ICONS = {
  target: Target,
  voice: Voice,
  calendar: Calendar,
} as const;

export function Pillars() {
  const copy = LANDING_COPY.pillars;
  return (
    <section className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <Reveal>
          <div className="eyebrow">{copy.eyebrow}</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="h-section mt-3 max-w-[880px]">
            {copy.headlineLead} <span style={{ color: "var(--text-3)" }}>{copy.headlineMuted}</span>
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {copy.items.map((p, i) => {
            const Icon = ICONS[p.icon];
            return (
              <Reveal key={p.title} delay={i * 80}>
                <div
                  className="h-full rounded-[14px] border border-border p-7 transition-[transform,box-shadow,border-color] duration-200 [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:border-[var(--border-strong)] [@media(hover:hover)]:hover:shadow-[var(--shadow-md)]"
                  style={{ background: "var(--bg-elev)" }}
                >
                  <div
                    className="mb-5 inline-flex size-11 items-center justify-center rounded-xl border"
                    style={{
                      background: "var(--accent-soft)",
                      borderColor: "var(--accent-border)",
                      color: "var(--accent-text)",
                    }}
                  >
                    <Icon className="size-[22px]" />
                  </div>
                  <h3 className="h-card">{p.title}</h3>
                  <p
                    className="mt-2.5 text-[15px] leading-[1.6]"
                    style={{ color: "var(--text-2)" }}
                  >
                    {p.description}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
