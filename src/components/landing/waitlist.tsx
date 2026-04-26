import { Reveal } from "@/components/landing/primitives/reveal";
import { WaitlistForm } from "@/components/waitlist-form";
import { LANDING_COPY } from "@/lib/landing-copy";

type Props = {
  count: number;
};

export function Waitlist({ count }: Props) {
  const copy = LANDING_COPY.waitlist;
  return (
    <section id="waitlist" className="relative overflow-hidden px-5 py-20 md:px-8 md:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, oklch(0.55 0.19 285 / 0.25) 0%, transparent 65%)",
          filter: "blur(40px)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-[640px] text-center">
        <Reveal>
          <div className="eyebrow">{copy.eyebrow}</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="h-section mt-3.5">
            {copy.headlineLead}{" "}
            <span className="display-italic" style={{ color: "var(--accent-text)" }}>
              {copy.headlineAccent}
            </span>
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="lead mx-auto mt-[18px] max-w-[540px]">{copy.lead}</p>
        </Reveal>
        <Reveal delay={240}>
          <div className="mx-auto mt-8 max-w-[460px] text-left">
            <WaitlistForm source="landing-hero" />
          </div>
        </Reveal>
        <Reveal delay={320}>
          <div className="mt-[18px] font-mono text-[12px]" style={{ color: "var(--text-3)" }}>
            {copy.fineprintTemplate(count)}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
