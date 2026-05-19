"use client";

// Renders the sponsor scorecard returned by GET /api/sponsors/[handle].
// Purely presentational — the parent (ResultsView) owns the fetch and the
// loading/error state. Desktop layout is a single table; mobile collapses
// to stacked cards so the columns stay readable.

import type { SponsorScorecard as Scorecard, SponsorSignal } from "@/lib/sponsors";

export type SponsorScorecardData = Scorecard;

export function SponsorScorecard({
  scorecard,
  loading,
  error,
}: {
  scorecard: Scorecard | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="results-section">
      <div className="scorecard-header">
        <h2 className="results-section-label">Sponsor Scorecard</h2>
        <p className="scorecard-subtitle">
          Past 6 months — who paid, who worked, who didn&apos;t.
        </p>
      </div>

      {loading && (
        <p className="results-section-status">
          Reading the last 6 months of sponsors…
        </p>
      )}

      {!loading && error && <p className="results-section-error">{error}</p>}

      {!loading && !error && scorecard && scorecard.sponsors.length === 0 && (
        <p className="results-section-status">
          No paid brand integrations detected in the last 6 months
          {scorecard.totalVideosInWindow > 0
            ? ` across ${scorecard.totalVideosInWindow} videos.`
            : "."}
        </p>
      )}

      {!loading && !error && scorecard && scorecard.sponsors.length > 0 && (
        <ScorecardBody scorecard={scorecard} />
      )}
    </section>
  );
}

function ScorecardBody({ scorecard }: { scorecard: Scorecard }) {
  return (
    <>
      <p className="scorecard-meta">
        {scorecard.sponsoredVideoCount} sponsored / {scorecard.totalVideosInWindow} videos ·
        baseline {compactInt(scorecard.baselineMedianViews)} views
      </p>

      {/* Desktop: table. Mobile: stacked cards. CSS hides one or the other. */}
      <div className="scorecard-table-wrapper">
        <table className="scorecard-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Integrations</th>
              <th>Views vs baseline</th>
              <th>Sentiment</th>
              <th>Returned</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.sponsors.map((s) => (
              <tr key={s.brand}>
                <td className="scorecard-brand">{s.brand}</td>
                <td>{s.integrationCount}×</td>
                <td>
                  <RatioBar ratio={s.avgViewsVsBaseline} />
                </td>
                <td>
                  <SentimentChip sentiment={s.sentiment} evidence={s.sentimentEvidence} />
                </td>
                <td className="scorecard-recurrence">{s.recurrence ? "✓" : "✗"}</td>
                <td>
                  <SignalBadge signal={s.signal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="scorecard-cards">
        {scorecard.sponsors.map((s) => (
          <article key={s.brand} className="scorecard-card">
            <div className="scorecard-card-top">
              <p className="scorecard-card-brand">{s.brand}</p>
              <SignalBadge signal={s.signal} />
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Integrations</span>
              <span className="scorecard-card-value">{s.integrationCount}×</span>
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Views vs baseline</span>
              <RatioBar ratio={s.avgViewsVsBaseline} />
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Sentiment</span>
              <SentimentChip sentiment={s.sentiment} evidence={s.sentimentEvidence} />
            </div>
            <div className="scorecard-card-row">
              <span className="scorecard-card-label">Returned</span>
              <span className="scorecard-card-value">{s.recurrence ? "Yes" : "No"}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function RatioBar({ ratio }: { ratio: number }) {
  // Visual: a centred bar with 1.0 at the midpoint. Magnitude up to 2.0× fills
  // the right half; down to 0.0× fills the left. Anything > 2× is clamped.
  const clamped = Math.max(0, Math.min(ratio, 2));
  const above = clamped >= 1;
  const fillPct = above ? ((clamped - 1) / 1) * 50 : ((1 - clamped) / 1) * 50;
  const display = `${ratio.toFixed(2)}×`;
  return (
    <div className="scorecard-ratio">
      <span className={`scorecard-ratio-value${above ? "" : " is-below"}`}>{display}</span>
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
  sentiment: "positive" | "neutral" | "mixed" | "negative";
  evidence: string;
}) {
  return (
    <span className={`scorecard-sentiment is-${sentiment}`} title={evidence}>
      {sentiment}
    </span>
  );
}

function SignalBadge({ signal }: { signal: SponsorSignal }) {
  return (
    <span className={`scorecard-signal is-${signal.toLowerCase()}`}>{signal}</span>
  );
}

function compactInt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString("en-US");
}
