import Link from "next/link";
import { LANDING_COPY } from "@/lib/landing-copy";

export function Footer() {
  const copy = LANDING_COPY.footer;
  return (
    <footer className="mt-6 border-t border-border px-5 pt-12 pb-16 md:px-8">
      <div className="mx-auto max-w-[1240px]">
        <div className="flex flex-wrap justify-between gap-8">
          <div className="max-w-[320px]">
            <Link href="#top" className="inline-flex items-center gap-2.5">
              <span className="logo-mark">P</span>
              <span className="font-semibold" style={{ color: "var(--text-0)" }}>
                Postimi
              </span>
            </Link>
            <p className="mt-3.5 text-[13px] leading-[1.6]" style={{ color: "var(--text-2)" }}>
              {copy.tagline}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-14 gap-y-8">
            {copy.columns.map((c) => (
              <div key={c.heading}>
                <div className="eyebrow mb-3.5">{c.heading}</div>
                <div className="flex flex-col gap-2.5">
                  {c.links.map((l) => (
                    <Link
                      key={l.label}
                      href={l.href}
                      className="text-[13px]"
                      style={{ color: "var(--text-2)" }}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div
          className="mt-12 flex flex-wrap justify-between gap-3 border-t border-border pt-6 font-mono text-[12px]"
          style={{ color: "var(--text-3)" }}
        >
          <span>{copy.copyright}</span>
          <span>{copy.motto}</span>
        </div>
      </div>
    </footer>
  );
}
