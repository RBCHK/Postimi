import { Reveal } from "@/components/landing/primitives/reveal";
import { Quote } from "@/components/landing/icons";
import { LANDING_COPY } from "@/lib/landing-copy";

export function Testimonials() {
  const copy = LANDING_COPY.testimonials;
  return (
    <section className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <Reveal>
          <div className="eyebrow text-center">{copy.eyebrow}</div>
        </Reveal>
        <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {copy.quotes.map((q, i) => (
            <Reveal key={q.author} delay={i * 80}>
              <figure
                className="flex h-full flex-col rounded-[14px] border border-border p-6"
                style={{ background: "var(--bg-elev)" }}
              >
                <Quote className="mb-3.5 size-5" style={{ color: "var(--accent-text)" }} />
                <blockquote
                  className="flex-1 text-[16px] leading-[1.5] tracking-[-0.01em]"
                  style={{ color: "var(--text-0)" }}
                >
                  {q.text}
                </blockquote>
                <figcaption className="mt-[18px] border-t border-border pt-3.5 text-[13px]">
                  <div className="font-medium" style={{ color: "var(--text-0)" }}>
                    {q.author}
                  </div>
                  <div className="mt-0.5" style={{ color: "var(--text-3)" }}>
                    {q.role}
                  </div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
