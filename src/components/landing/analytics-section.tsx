import { Reveal } from "@/components/landing/primitives/reveal";
import { AnalyticsMock } from "@/components/landing/mocks/analytics-mock";
import { LANDING_COPY } from "@/lib/landing-copy";

export function AnalyticsSection() {
  const copy = LANDING_COPY.analytics;
  return (
    <section className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <div className="mx-auto mb-12 max-w-[720px] text-center">
          <Reveal>
            <div className="eyebrow">{copy.eyebrow}</div>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="h-section mt-3.5">
              {copy.headlineLead}{" "}
              <span style={{ color: "var(--text-3)" }}>{copy.headlineMuted}</span>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="lead mt-5">{copy.lead}</p>
          </Reveal>
        </div>
        <Reveal delay={240}>
          <AnalyticsMock />
        </Reveal>
      </div>
    </section>
  );
}
