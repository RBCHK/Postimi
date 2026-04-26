import { Reveal } from "@/components/landing/primitives/reveal";
import { LANDING_COPY } from "@/lib/landing-copy";

export function HowItWorks() {
  const copy = LANDING_COPY.howItWorks;
  return (
    <section id="how" className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <Reveal>
          <div className="eyebrow">{copy.eyebrow}</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="h-section mt-3 max-w-[720px]">
            {copy.headlineLead}{" "}
            <span className="display-italic" style={{ color: "var(--accent-text)" }}>
              {copy.headlineAccent}
            </span>
          </h2>
        </Reveal>
        <div
          className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-border sm:grid-cols-2 lg:grid-cols-4"
          style={{ background: "var(--border)" }}
        >
          {copy.steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 60}>
              <div className="h-full p-7" style={{ background: "var(--bg-0)" }}>
                <div
                  className="font-mono text-[11px] tracking-[0.12em]"
                  style={{ color: "var(--text-3)" }}
                >
                  {s.n}
                </div>
                <h3
                  className="mt-3.5 text-lg font-semibold tracking-[-0.012em]"
                  style={{ color: "var(--text-0)" }}
                >
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-[1.6]" style={{ color: "var(--text-2)" }}>
                  {s.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
