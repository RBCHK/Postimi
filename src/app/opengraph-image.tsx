import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "Postimi — An AI strategist that reads your data and tells you what to post next";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px",
        background:
          "radial-gradient(ellipse at 30% 30%, oklch(0.55 0.19 285 / 0.35), transparent 60%), oklch(0.18 0.005 285)",
        color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: "oklch(0.55 0.19 285)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            fontWeight: 700,
          }}
        >
          P
        </div>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.01em" }}>Postimi</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            maxWidth: 980,
          }}
        >
          An AI strategist that reads your data,{" "}
          <span style={{ color: "oklch(0.78 0.13 285)", fontStyle: "italic" }}>
            and tells you what to post next.
          </span>
        </div>
        <div
          style={{
            fontSize: 24,
            color: "rgba(255, 255, 255, 0.6)",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            letterSpacing: "0.02em",
          }}
        >
          postimi.com · X · LinkedIn · Threads
        </div>
      </div>
    </div>,
    size
  );
}
