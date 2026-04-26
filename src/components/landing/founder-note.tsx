import { Reveal } from "@/components/landing/primitives/reveal";
import { LANDING_COPY } from "@/lib/landing-copy";

export function FounderNote() {
  const copy = LANDING_COPY.founderNote;
  return (
    <section className="px-5 py-12 md:px-8 md:py-16">
      <div className="mx-auto max-w-[980px]">
        <Reveal>
          <div
            className="rounded-[18px] border border-border p-8 md:p-10"
            style={{ background: "var(--bg-elev)" }}
          >
            <div className="eyebrow">{copy.eyebrow}</div>
            <div
              className="mt-5 max-w-[700px] space-y-4 text-[19px] leading-[1.65] tracking-[-0.008em]"
              style={{ color: "var(--text-1)" }}
            >
              {copy.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <div className="mt-7 flex items-center gap-3">
              <div
                className="inline-flex size-9 items-center justify-center rounded-full font-semibold text-white"
                style={{ background: "var(--accent-color)" }}
              >
                {copy.initials}
              </div>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                  {copy.name}
                </div>
                <div className="text-[13px]" style={{ color: "var(--text-3)" }}>
                  {copy.role}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
