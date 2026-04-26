import { Reveal } from "@/components/landing/primitives/reveal";
import { StrategistMock } from "@/components/landing/mocks/strategist-mock";
import { Check, Target } from "@/components/landing/icons";
import { LANDING_COPY } from "@/lib/landing-copy";

export function StrategistDeepDive() {
  const copy = LANDING_COPY.strategist;
  return (
    <section id="strategist" className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <Reveal>
            <div>
              <div className="eyebrow inline-flex items-center gap-1.5">
                <Target className="size-3" /> {copy.eyebrow}
              </div>
              <h2 className="h-section mt-3.5">
                {copy.headlineLead}
                <br />
                <span className="display-italic" style={{ color: "var(--accent-text)" }}>
                  {copy.headlineAccent}
                </span>
              </h2>
              <p className="lead mt-5 max-w-[520px]">{copy.lead}</p>
              <ul className="mt-6 flex flex-col gap-2.5">
                {copy.bullets.map((t) => (
                  <li
                    key={t}
                    className="flex items-start gap-2.5 text-[15px]"
                    style={{ color: "var(--text-1)" }}
                  >
                    <Check
                      className="mt-1 size-4 shrink-0"
                      style={{ color: "var(--accent-text)" }}
                    />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <StrategistMock />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
