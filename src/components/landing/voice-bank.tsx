import { Reveal } from "@/components/landing/primitives/reveal";
import { VoiceBankMock } from "@/components/landing/mocks/voice-bank-mock";
import { Quote, Voice } from "@/components/landing/icons";
import { LANDING_COPY } from "@/lib/landing-copy";

export function VoiceBank() {
  const copy = LANDING_COPY.voice;
  return (
    <section id="voice" className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
          <Reveal>
            <VoiceBankMock />
          </Reveal>
          <Reveal delay={120}>
            <div>
              <div className="eyebrow inline-flex items-center gap-1.5">
                <Voice className="size-3" /> {copy.eyebrow}
              </div>
              <h2 className="h-section mt-3.5">
                {copy.headlineLead}{" "}
                <span className="display-italic" style={{ color: "var(--accent-text)" }}>
                  {copy.headlineAccent}
                </span>
              </h2>
              <p className="lead mt-5 max-w-[520px]">{copy.lead}</p>
              <div
                className="mt-7 rounded-[14px] border border-border p-5"
                style={{ background: "var(--bg-2)" }}
              >
                <Quote className="mb-2.5 size-5" style={{ color: "var(--accent-text)" }} />
                <div
                  className="text-[17px] leading-[1.55] tracking-[-0.012em]"
                  style={{ color: "var(--text-0)" }}
                >
                  {copy.quote}
                </div>
                <div className="mt-3.5 text-[13px]" style={{ color: "var(--text-3)" }}>
                  {copy.quoteAttribution}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
