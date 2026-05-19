"use client";

// Sponsor scorecard renderer.
// Receives a flat SponsorScorecard[] (one row per canonical brand) plus
// loading / error state from the parent. Splits the rows into three
// sections so the table stays signal-led:
//   1. Main — branded sponsored relationships (sorted server-side).
//   2. Affiliate-only — paid relationships but a weaker tier.
//   3. Unidentified — paidProductPlacement videos where no brand was named.

import type { SponsorScorecard as SponsorRow, SponsorSignal } from "@/lib/sponsors";

export type SponsorScorecardData = SponsorRow[];

export function SponsorScorecard({
  scorecard,
  loading,
  error,
}: {
  scorecard: SponsorRow[] | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="results-section">
      <div className="scorecard-header">
        <h2 className="results-section-label">Sponsor Scorecard</h2>
        <p className="scorecard-subtitle">
          Past 18 months — who paid, who worked, who didn&apos;t. Recurrence scanned all-time.
        </p>
      </div>

      {loading && (
        <p className="results-section-status">
          Reading the last 18 months of sponsors + scanning all-time recurrence…
        </p>
      )}

      {!loading && error && <p className="results-section-error">{error}</p>}

      {!loading && !error && scorecard && scorecard.length === 0 && (
        <p className="results-section-status">
          No paid brand integrations detected in the last 18 months.
        </p>
      )}

      {!loading && !error && scorecard && scorecard.length > 0 && (
        <ScorecardBody rows={scorecard} />
      )}
    </section>
  );
}

function ScorecardBody({ rows }: { rows: SponsorRow[] }) {
  const mainRows = rows.filter((r) => !r.affiliate && r.brand !== "Unknown");
  const affiliateRows = rows.filter((r) => r.affiliate && r.brand !== "Unknown");
  const unknownRows = rows.filter((r) => r.brand === "Unknown");
  const unknownTotal = unknownRows.reduce((s, r) => s + r.integrationsRecent, 0);

  return (
    <>
      {mainRows.length > 0 ? (
        <ScorecardTable rows={mainRows} />
      ) : (
        <p className="results-section-status">
          No named sponsors detected in the last 18 months.
        </p>
      )}

      {affiliateRows.length > 0 && (
        <div className="scorecard-subsection">
          <h3 className="scorecard-subhead">Affiliate relationships (not sponsored)</h3>
          <ScorecardTable rows={affiliateRows} />
        </div>
      )}

      {unknownTotal > 0 && (
        <div className="scorecard-subsection">
          <h3 className="scorecard-subhead">
            Unidentified paid placements ({unknownTotal} {unknownTotal === 1 ? "video" : "videos"})
          </h3>
          <p className="scorecard-unknown-note">
            YouTube&apos;s paid-promotion flag is set on these videos but no brand
            could be extracted from the description.
          </p>
        </div>
      )}
    </>
  );
}

function ScorecardTable({ rows }: { rows: SponsorRow[] }) {
  return (
    <>
      <div className="scorecard-table-wrapper">
        <table className="scorecard-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Format</th>
              <th>Integrations</th>
              <th>Relationship</th>
              <th>Views vs baseline</th>
              <th>Sentiment</th>
              <th>Freshness</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.brand}>
                <td className="scorecard-brand">{r.brand}</td>
                <td>
                  <FormatBadge contentType={r.contentType} />
                </td>
                <td>{r.integrationsRecent}×</td>
                <td className="scorecard-relationship">
                  {formatRelationship(r)}
                </td>
                <td>
                  <RatioBar ratio={r.avgViewsVsBaseline} />
                </td>
                <td>
                  <SentimentChip
                    sentiment={r.sentiment}
                    evidence={r.sentimentEvidence ?? ""}
                  />
                </td>
                <td>
                  <FreshnessPip freshness={r.freshness} />
                </td>
                <td>
                  <SignalBadge signal={r.signal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="scorecard-cards">
        {rows.map((r) => (
          <article key={r.brand} className="scorecard-card">
            <div className="scorecard-card-top">
              <p className="scorecard-card-brand">{r.brand}</p>
              <SignalBadge signal={r.signal} />
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Format</span>
              <FormatBadge contentType={r.contentType} />
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Integrations</span>
              <span className="scorecard-card-value">{r.integrationsRecent}×</span>
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Relationship</span>
              <span className="scorecard-card-value">{formatRelationship(r)}</span>
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Views vs baseline</span>
              <RatioBar ratio={r.avgViewsVsBaseline} />
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Sentiment</span>
              <SentimentChip
                sentiment={r.sentiment}
                evidence={r.sentimentEvidence ?? ""}
              />
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Freshness</span>
              <FreshnessPip freshness={r.freshness} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function formatRelationship(r: SponsorRow): string {
  if (r.totalAppearancesAllTime <= 1 || !r.firstSeenAt || !r.lastSeenAt) {
    return `${r.totalAppearancesAllTime || r.integrationsRecent}× appearance${
      (r.totalAppearancesAllTime || r.integrationsRecent) === 1 ? "" : "s"
    }`;
  }
  const months = monthsBetween(r.firstSeenAt, r.lastSeenAt);
  if (months <= 0) {
    return `${r.totalAppearancesAllTime} appearances`;
  }
  return `${r.totalAppearancesAllTime} appearances · ${months} ${months === 1 ? "month" : "months"}`;
}

function monthsBetween(firstIso: string, lastIso: string): number {
  const a = Date.parse(firstIso);
  const b = Date.parse(lastIso);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.max(1, Math.round((b - a) / (30 * 24 * 60 * 60 * 1000)));
}

function FormatBadge({ contentType }: { contentType: SponsorRow["contentType"] }) {
  const label = contentType === "longform" ? "Longform" : contentType === "shorts" ? "Shorts" : "Both";
  return <span className={`scorecard-format is-${contentType}`}>{label}</span>;
}

function RatioBar({ ratio }: { ratio: number }) {
  if (ratio === 0) {
    return <span className="scorecard-ratio-value is-below">no data</span>;
  }
  const clamped = Math.max(0, Math.min(ratio, 2));
  const above = clamped >= 1;
  const fillPct = above ? ((clamped - 1) / 1) * 50 : ((1 - clamped) / 1) * 50;
  return (
    <div className="scorecard-ratio">
      <span className={`scorecard-ratio-value${above ? "" : " is-below"}`}>
        {ratio.toFixed(2)}×
      </span>
      <div className="scorecard-ratio-track" aria-hidden>
        <div className="scorecard-ratio-mid" />
        <div
          className={`scorecard-ratio-fill${above ? " is-above" : " is-below"}`}
          style={{
            left: above ? "50%" : `${50 - fillPct}%`,
            width: `${fillPct}%`,
          }}
        />
      </div>
    </div>
  );
}

function SentimentChip({
  sentiment,
  evidence,
}: {
  sentiment: "positive" | "neutral" | "mixed" | "negative" | null;
  evidence: string;
}) {
  if (sentiment === null) {
    return <span className="scorecard-sentiment is-neutral">—</span>;
  }
  return (
    <span className={`scorecard-sentiment is-${sentiment}`} title={evidence}>
      {sentiment}
    </span>
  );
}

function FreshnessPip({ freshness }: { freshness: SponsorRow["freshness"] }) {
  return (
    <span className={`scorecard-freshness is-${freshness.toLowerCase()}`}>
      <span className="scorecard-freshness-dot" aria-hidden />
      {freshness}
    </span>
  );
}

function SignalBadge({ signal }: { signal: SponsorSignal }) {
  return <span className={`scorecard-signal is-${signal.toLowerCase()}`}>{signal}</span>;
}
