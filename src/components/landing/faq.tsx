import { Reveal } from "@/components/landing/primitives/reveal";
import { ChevronDown } from "@/components/landing/icons";
import { LANDING_COPY } from "@/lib/landing-copy";

export function Faq() {
  const copy = LANDING_COPY.faq;
  return (
    <section id="faq" className="px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[820px]">
        <Reveal>
          <div className="eyebrow text-center">{copy.eyebrow}</div>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="h-section mt-3.5 text-center">{copy.headline}</h2>
        </Reveal>
        <div className="mt-12 divide-y divide-border border-y border-border">
          {copy.items.map((item, i) => (
            <details key={item.q} className="group" open={i === 0}>
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-medium [&::-webkit-details-marker]:hidden"
                style={{ color: "var(--text-0)" }}
              >
                <span>{item.q}</span>
                <ChevronDown
                  className="size-[18px] shrink-0 transition-transform duration-200 group-open:rotate-180"
                  style={{ color: "var(--text-3)" }}
                />
              </summary>
              <div
                className="pb-6 pr-8 text-[14px] leading-[1.65]"
                style={{ color: "var(--text-2)" }}
              >
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
