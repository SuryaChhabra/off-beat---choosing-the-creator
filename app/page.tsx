import { AnalyzePanel } from "@/components/AnalyzePanel";

export default function Home() {
  return (
    <main
      className="min-h-screen w-full"
      style={{
        background: "var(--bg)",
        padding: "4rem 2.5rem 3.5rem",
      }}
    >
      <div style={{ marginBottom: "5rem" }}>
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

      <div style={{ maxWidth: 580 }}>
        <p
          style={{
            fontSize: 12,
            color: "var(--pink)",
            margin: "0 0 1.25rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Audience hai · ab brand banao
        </p>

        <h1
          className="off-headline"
          style={{
            color: "var(--fg)",
            lineHeight: 0.96,
            margin: "0 0 1.5rem",
            letterSpacing: "-0.04em",
          }}
        >
          What should this creator{" "}
          <span style={{ color: "var(--pink)" }}>actually</span> build?
        </h1>

        <p
          style={{
            fontSize: 16,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            margin: "0 0 2.5rem",
            maxWidth: 460,
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
