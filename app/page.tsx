import { AnalyzePanel } from "@/components/AnalyzePanel";

export default function Home() {
  return (
    <main
      className="min-h-screen w-full"
      style={{ background: "var(--bg)" }}
    >
      {/* Brand mark — anchored top-left, deliberately outside the centered column. */}
      <div className="px-6 md:px-10 pt-12 md:pt-16">
        <span
          style={{
            color: "var(--pink)",
            fontSize: 16,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            display: "inline-block",
          }}
        >
          CONCEPT LAB
        </span>
      </div>

      {/* Centered content column. */}
      <div className="max-w-4xl mx-auto px-8 py-20 md:py-32">
        <p
          style={{
            fontSize: 12,
            color: "var(--pink)",
            margin: "0 0 1.5rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Audience hai · ab brand banao
        </p>

        <h1
          className="text-7xl md:text-8xl lg:text-9xl leading-[0.95] tracking-[-0.04em]"
          style={{
            color: "var(--fg)",
            margin: "0 0 2rem",
          }}
        >
          What should this creator{" "}
          <span style={{ color: "var(--pink)" }}>actually</span> build?
        </h1>

        <p
          style={{
            fontSize: 18,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            margin: "0 0 3rem",
            maxWidth: 560,
          }}
        >
          Drop in any creator. We map their audience, score the categories their
          audience actually buys, and surface brand concepts grounded in
          evidence — not vibes.
        </p>

        <AnalyzePanel />

        <div
          className="off-phase-row"
          style={{
            display: "flex",
            gap: "1.5rem",
            alignItems: "center",
            paddingTop: "1.5rem",
            borderTop: "0.5px solid var(--border-faint)",
            marginTop: "3rem",
            flexWrap: "wrap",
          }}
        >
          <p
            style={{
              fontSize: 11,
              color: "var(--pink)",
              margin: 0,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Phase 01
          </p>
          <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: 0 }}>
            Creator profile
          </p>
          <p style={{ fontSize: 12, color: "var(--fg-faint)", margin: 0 }}>
            → Deal scoring
          </p>
          <p style={{ fontSize: 12, color: "var(--fg-faint)", margin: 0 }}>
            → Concept generation
          </p>
        </div>
      </div>
    </main>
  );
}
