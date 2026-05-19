"use client";

// Dedicated results surface. Mounts with a handle from the URL, streams the
// Creator Profile via /api/analyze, then fetches Brand Concepts from
// /api/concepts once the profile finishes. All sections render progressively
// as the stream arrives. No prose paragraphs — every block is bullets, pills,
// or labelled card fields.

import { useCompletion } from "@ai-sdk/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const META_START = "__OFFBEAT_META_START__";
const META_END = "__OFFBEAT_META_END__";

type CreatorMeta = {
  channelId: string;
  title: string;
  customUrl?: string;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
  country?: string;
  thumbnailUrl: string;
};

type RawSection = { heading: string; body: string };

type BrandConcept = {
  riskTier: "Proven extension" | "Adjacent leap" | "Whitespace bet";
  names: string[];
  category: string;
  positioning: string;
  wedge: string;
  whyThisCreatorWins: string;
};

// ---------------------------------------------------------------------------
// Stream parsing
// ---------------------------------------------------------------------------

function parseStream(raw: string): { meta: CreatorMeta | null; analysis: string } {
  if (!raw.startsWith(META_START)) return { meta: null, analysis: "" };
  const endIdx = raw.indexOf(META_END);
  if (endIdx === -1) return { meta: null, analysis: "" };
  const metaJson = raw.slice(META_START.length, endIdx);
  let meta: CreatorMeta | null = null;
  try {
    meta = JSON.parse(metaJson) as CreatorMeta;
  } catch {
    meta = null;
  }
  const analysis = raw.slice(endIdx + META_END.length).replace(/^\n+/, "");
  return { meta, analysis };
}

function splitSections(markdown: string): RawSection[] {
  if (!markdown.trim()) return [];
  const parts = markdown.split(/^##\s+/m);
  const sections: RawSection[] = [];
  // parts[0] is anything before the first heading; we ignore it.
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const newlineIdx = block.indexOf("\n");
    if (newlineIdx === -1) {
      sections.push({ heading: block.trim(), body: "" });
    } else {
      sections.push({
        heading: block.slice(0, newlineIdx).trim(),
        body: block.slice(newlineIdx + 1).trim(),
      });
    }
  }
  return sections;
}

function normHeading(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function findSection(sections: RawSection[], name: string): RawSection | undefined {
  const target = normHeading(name);
  return sections.find((s) => normHeading(s.heading) === target);
}

function parseBullets(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function parseTrust(body: string): { positioning: string; bullets: string[] } {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let positioning = "";
  const bullets: string[] = [];
  for (const line of lines) {
    if (!positioning && /^\*\*.+\*\*$/.test(line)) {
      positioning = line.replace(/^\*\*(.+)\*\*$/, "$1").trim();
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, "").trim());
    } else if (!positioning) {
      // Fallback: model forgot the bold wrapper but the first non-bullet line
      // is still the positioning sentence.
      positioning = line.replace(/^\*\*|\*\*$/g, "").trim();
    }
  }
  return { positioning, bullets };
}

function parseThemes(body: string): string[] {
  return parseBullets(body).map((s) => s.replace(/[.…]+$/, "").trim());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResultsView({ handle }: { handle: string }) {
  const startedRef = useRef(false);
  const conceptsRequestedRef = useRef(false);
  const [concepts, setConcepts] = useState<BrandConcept[] | null>(null);
  const [conceptsLoading, setConceptsLoading] = useState(false);
  const [conceptsError, setConceptsError] = useState<string | null>(null);

  const { completion, complete, isLoading, error } = useCompletion({
    api: "/api/analyze",
    streamProtocol: "text",
    onFinish: (_prompt, full) => {
      // Fires once when the profile stream finishes. We use this (rather
      // than an effect) so setState happens in event-callback context, not
      // inside the render → effect cycle. Concept fetch runs exactly once.
      if (conceptsRequestedRef.current) return;
      const { meta: finishedMeta, analysis: finishedAnalysis } = parseStream(full);
      if (!finishedMeta || !finishedAnalysis.trim()) return;

      conceptsRequestedRef.current = true;
      setConceptsLoading(true);
      setConceptsError(null);

      fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelTitle: finishedMeta.title,
          country: finishedMeta.country,
          profile: finishedAnalysis,
        }),
      })
        .then(async (r) => {
          if (!r.ok) {
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error || `Concepts request failed (${r.status})`);
          }
          return r.json() as Promise<{ concepts: BrandConcept[] }>;
        })
        .then((data) => setConcepts(data.concepts))
        .catch((e: Error) => setConceptsError(e.message))
        .finally(() => setConceptsLoading(false));
    },
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void complete(handle, { body: { query: handle } });
  }, [handle, complete]);

  const { meta, analysis } = useMemo(() => parseStream(completion), [completion]);
  const sections = useMemo(() => splitSections(analysis), [analysis]);

  const audience = findSection(sections, "Audience");
  const trust = findSection(sections, "Trust Archetype");
  const comments = findSection(sections, "Comment Culture");
  const themes = findSection(sections, "Content Themes");

  return (
    <main className="results-root">
      <header className="results-topbar">
        <Link href="/" className="results-back">
          ← Analyze another
        </Link>
        <span className="results-brand">OFF/BEAT</span>
      </header>

      {error && <ErrorBlock message={error.message} />}

      <div className="results-stack">
        <ChannelHeaderBlock meta={meta} loading={isLoading && !meta} handle={handle} />

        <AudienceBlock section={audience} loading={isLoading} />
        <TrustBlock section={trust} loading={isLoading} />
        <CommentsBlock section={comments} loading={isLoading} />
        <ThemesBlock section={themes} loading={isLoading} />

        <ConceptsBlock
          concepts={concepts}
          loading={conceptsLoading}
          error={conceptsError}
          profileDone={!isLoading && Boolean(meta) && Boolean(analysis.trim())}
          creatorTitle={meta?.title ?? ""}
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Section blocks
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="results-section-label">{children}</h2>;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="results-bullets">
      {items.map((it, i) => (
        <li key={i}>{renderInline(it)}</li>
      ))}
    </ul>
  );
}

function ChannelHeaderBlock({
  meta,
  loading,
  handle,
}: {
  meta: CreatorMeta | null;
  loading: boolean;
  handle: string;
}) {
  if (!meta) {
    return (
      <section className="results-section">
        <div className="results-channel">
          <div className="results-thumb results-thumb-skeleton" />
          <div className="results-channel-text">
            <p className="results-channel-name">
              {loading ? `Resolving “${handle}”…` : handle}
            </p>
            <p className="results-channel-meta">&nbsp;</p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="results-section">
      <div className="results-channel">
        {meta.thumbnailUrl ? (
          <Image
            src={meta.thumbnailUrl}
            alt={meta.title}
            width={80}
            height={80}
            unoptimized
            className="results-thumb"
          />
        ) : (
          <div className="results-thumb results-thumb-skeleton" />
        )}
        <div className="results-channel-text">
          <p className="results-channel-name">{meta.title}</p>
          <p className="results-channel-meta">
            {formatSubs(meta.subscriberCount)}
            {meta.country ? ` · ${meta.country}` : ""}
            {meta.customUrl ? ` · ${meta.customUrl}` : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function AudienceBlock({ section, loading }: { section: RawSection | undefined; loading: boolean }) {
  const bullets = section ? parseBullets(section.body) : [];
  return (
    <section className="results-section">
      <SectionLabel>Audience</SectionLabel>
      {bullets.length > 0 ? (
        <BulletList items={bullets} />
      ) : (
        <SectionPlaceholder loading={loading} />
      )}
    </section>
  );
}

function TrustBlock({ section, loading }: { section: RawSection | undefined; loading: boolean }) {
  const parsed = section ? parseTrust(section.body) : { positioning: "", bullets: [] };
  return (
    <section className="results-section">
      <SectionLabel>Trust Archetype</SectionLabel>
      {parsed.positioning ? (
        <p className="results-takeaway">{parsed.positioning}</p>
      ) : null}
      {parsed.bullets.length > 0 ? (
        <BulletList items={parsed.bullets} />
      ) : !parsed.positioning ? (
        <SectionPlaceholder loading={loading} />
      ) : null}
    </section>
  );
}

function CommentsBlock({
  section,
  loading,
}: {
  section: RawSection | undefined;
  loading: boolean;
}) {
  const bullets = section ? parseBullets(section.body) : [];
  return (
    <section className="results-section">
      <SectionLabel>Comment Culture</SectionLabel>
      {bullets.length > 0 ? (
        <BulletList items={bullets} />
      ) : (
        <SectionPlaceholder loading={loading} />
      )}
    </section>
  );
}

function ThemesBlock({ section, loading }: { section: RawSection | undefined; loading: boolean }) {
  const themes = section ? parseThemes(section.body) : [];
  return (
    <section className="results-section">
      <SectionLabel>Content Themes</SectionLabel>
      {themes.length > 0 ? (
        <div className="results-pill-grid">
          {themes.map((t, i) => (
            <span key={i} className="results-pill">
              {t}
            </span>
          ))}
        </div>
      ) : (
        <SectionPlaceholder loading={loading} />
      )}
    </section>
  );
}

function ConceptsBlock({
  concepts,
  loading,
  error,
  profileDone,
  creatorTitle,
}: {
  concepts: BrandConcept[] | null;
  loading: boolean;
  error: string | null;
  profileDone: boolean;
  creatorTitle: string;
}) {
  return (
    <section className="results-section results-section-final">
      <SectionLabel>Brand Concepts</SectionLabel>

      {!profileDone && !concepts && !error && (
        <p className="results-section-status">
          Concepts unlock once the profile finishes.
        </p>
      )}

      {profileDone && loading && (
        <p className="results-section-status">Generating 3 concepts across risk tiers…</p>
      )}

      {error && <p className="results-section-error">{error}</p>}

      {concepts && concepts.length > 0 && (
        <div className="results-concept-grid">
          {concepts.map((c, i) => (
            <ConceptCard key={i} concept={c} creatorTitle={creatorTitle} />
          ))}
        </div>
      )}
    </section>
  );
}

function ConceptCard({ concept, creatorTitle }: { concept: BrandConcept; creatorTitle: string }) {
  return (
    <article className="results-concept-card">
      <span className="results-tier-badge">{concept.riskTier}</span>

      <div className="results-concept-names">
        {concept.names.map((n, i) => (
          <span key={i} className="results-concept-name">
            {n}
          </span>
        ))}
      </div>

      <ConceptField label="Category" value={concept.category} />
      <ConceptField label="Positioning" value={concept.positioning} />
      <ConceptField label="The wedge" value={concept.wedge} />
      <ConceptField
        label={`Why ${creatorTitle || "this creator"} wins it`}
        value={concept.whyThisCreatorWins}
      />
    </article>
  );
}

function ConceptField({ label, value }: { label: string; value: string }) {
  return (
    <div className="results-concept-field">
      <p className="results-concept-field-label">{label}</p>
      <p className="results-concept-field-value">{value}</p>
    </div>
  );
}

function SectionPlaceholder({ loading }: { loading: boolean }) {
  return (
    <p className="results-section-status">
      {loading ? "Streaming…" : "No content for this section."}
    </p>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="results-error-block">
      <p className="results-section-error">{message || "Something went wrong."}</p>
      <Link href="/" className="results-back">
        ← Try a different creator
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*(.+)\*\*$/);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <span key={i}>{p}</span>;
  });
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M subscribers`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K subscribers`;
  return `${n.toLocaleString("en-US")} subscribers`;
}
