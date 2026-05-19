"use client";

import { useCompletion } from "@ai-sdk/react";
import Image from "next/image";
import { useMemo, type FormEvent } from "react";

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

type Section = { heading: string; body: string };

type ParsedStream = {
  meta: CreatorMeta | null;
  analysis: string;
};

function parseStream(raw: string): ParsedStream {
  if (!raw.startsWith(META_START)) {
    // Envelope hasn't arrived yet — show nothing until we have the channel header.
    return { meta: null, analysis: "" };
  }
  const endIdx = raw.indexOf(META_END);
  if (endIdx === -1) {
    return { meta: null, analysis: "" };
  }
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

function splitSections(markdown: string): { intro: string; sections: Section[] } {
  if (!markdown.trim()) return { intro: "", sections: [] };
  const parts = markdown.split(/^##\s+/m);
  const intro = parts[0]?.trim() ?? "";
  const sections: Section[] = [];
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
  return { intro, sections };
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M subscribers`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K subscribers`;
  return `${n.toLocaleString("en-US")} subscribers`;
}

export function AnalyzePanel() {
  const {
    input,
    setInput,
    handleInputChange,
    completion,
    complete,
    isLoading,
    error,
    setCompletion,
  } = useCompletion({
    api: "/api/analyze",
    streamProtocol: "text",
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    void complete(trimmed, { body: { query: trimmed } });
  };

  const reset = () => {
    setInput("");
    setCompletion("");
  };

  const { meta, analysis } = useMemo(() => parseStream(completion), [completion]);
  const { sections } = useMemo(() => splitSections(analysis), [analysis]);
  const hasResults = Boolean(meta) || isLoading || Boolean(error);

  return (
    <div>
      <form onSubmit={onSubmit} className="off-input-row">
        <input
          type="text"
          className="off-input"
          placeholder="@therebelkid · MrBeast · Apoorva Mukhija"
          value={input}
          onChange={handleInputChange}
          disabled={isLoading}
          aria-label="Creator handle, URL, or name"
        />
        <button type="submit" className="off-button" disabled={isLoading || !input.trim()}>
          {isLoading ? "Analyzing..." : "Analyze →"}
        </button>
      </form>

      {hasResults && (
        <section
          style={{
            marginBottom: "3rem",
            paddingTop: "1.5rem",
            borderTop: "0.5px solid var(--border-faint)",
          }}
          aria-live="polite"
        >
          {error && (
            <p
              style={{
                color: "var(--pink)",
                fontSize: 14,
                marginBottom: "1.5rem",
              }}
            >
              {error.message || "Something went wrong. Try a different creator."}
            </p>
          )}

          {meta && <ChannelHeader meta={meta} />}

          {!meta && isLoading && (
            <p style={{ color: "var(--fg-muted)", fontSize: 14, margin: "1rem 0" }}>
              Resolving channel…
            </p>
          )}

          {sections.length === 0 && meta && isLoading && (
            <p
              style={{
                color: "var(--fg-muted)",
                fontSize: 14,
                marginTop: "1.5rem",
              }}
            >
              Reading recent videos…
            </p>
          )}

          {sections.length > 0 && (
            <div style={{ marginTop: "2rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
              {sections.map((s, i) => (
                <SectionBlock key={`${s.heading}-${i}`} section={s} />
              ))}
            </div>
          )}

          {!isLoading && (meta || error) && (
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "2.5rem",
                background: "transparent",
                border: 0,
                padding: 0,
                color: "var(--pink)",
                fontSize: 13,
                letterSpacing: "0.04em",
                cursor: "pointer",
              }}
            >
              ↺ Analyze another
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function ChannelHeader({ meta }: { meta: CreatorMeta }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        marginTop: "0.5rem",
      }}
    >
      {meta.thumbnailUrl ? (
        <Image
          src={meta.thumbnailUrl}
          alt={meta.title}
          width={56}
          height={56}
          unoptimized
          style={{
            borderRadius: 999,
            border: "0.5px solid var(--border)",
          }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: "var(--bg-elev)",
            border: "0.5px solid var(--border)",
          }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ margin: 0, fontSize: 18, color: "var(--fg)", letterSpacing: "-0.01em" }}>
          {meta.title}
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "var(--fg-muted)" }}>
          {formatSubs(meta.subscriberCount)}
          {meta.customUrl ? ` · ${meta.customUrl}` : ""}
        </p>
      </div>
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <div>
      <h2
        style={{
          fontSize: 13,
          color: "var(--pink)",
          margin: "0 0 0.75rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {section.heading}
      </h2>
      <SectionBody markdown={section.body} />
    </div>
  );
}

function SectionBody({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseBodyBlocks(markdown), [markdown]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      {blocks.map((b, i) => {
        if (b.type === "list") {
          return (
            <ul
              key={i}
              style={{
                margin: 0,
                paddingLeft: "1.1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              {b.items.map((item, j) => (
                <li
                  key={j}
                  style={{
                    color: "var(--fg)",
                    fontSize: 15,
                    lineHeight: 1.55,
                  }}
                >
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={i}
            style={{
              margin: 0,
              color: "var(--fg)",
              fontSize: 15,
              lineHeight: 1.6,
            }}
          >
            {renderInline(b.text)}
          </p>
        );
      })}
    </div>
  );
}

type BodyBlock = { type: "para"; text: string } | { type: "list"; items: string[] };

function parseBodyBlocks(md: string): BodyBlock[] {
  const lines = md.split("\n");
  const blocks: BodyBlock[] = [];
  let para: string[] = [];
  let listItems: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      if (text) blocks.push({ type: "para", text });
      para = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const bulletMatch = t.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      flushPara();
      listItems.push(bulletMatch[1]);
    } else {
      flushList();
      para.push(t);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function renderInline(text: string): React.ReactNode {
  // Bold via **...**; everything else as plain text.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*(.+)\*\*$/);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <span key={i}>{p}</span>;
  });
}
