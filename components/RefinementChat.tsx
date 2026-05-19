"use client";

// Slide-in chat panel for refining a specific brand concept.
// Uses @ai-sdk/react's useChat with DefaultChatTransport so the messages
// + creator/concept context POST to /api/refine.
// Mount/unmount is driven by the parent — when the user picks a different
// concept, the parent re-keys this component so chat history resets.

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

const STARTERS = [
  "What if it were more premium?",
  "Pivot to a different category",
  "What are the unit economics?",
  "Who has tried this and failed?",
] as const;

export type RefinementConcept = {
  riskTier: string;
  names: string[];
  category: string;
  positioning: string;
  wedge: string;
  whyThisCreatorWins: string;
};

export function RefinementChat({
  open,
  onClose,
  creatorTitle,
  country,
  creatorProfile,
  concept,
}: {
  open: boolean;
  onClose: () => void;
  creatorTitle: string;
  country?: string;
  creatorProfile: string;
  concept: RefinementConcept;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/refine",
        body: { creatorTitle, country, creatorProfile, concept },
      }),
    [creatorTitle, country, creatorProfile, concept],
  );

  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auto-scroll to bottom as messages arrive.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    if (status === "submitted" || status === "streaming") return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const busy = status === "submitted" || status === "streaming";
  const showStarters = messages.length === 0;
  const primaryName = concept.names[0] ?? "this concept";

  return (
    <>
      <div
        className={`chat-backdrop${open ? " open" : ""}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`chat-panel${open ? " open" : ""}`}
        role="dialog"
        aria-modal
        aria-label={`Discuss ${primaryName}`}
      >
        <header className="chat-header">
          <div className="chat-header-text">
            <span className="chat-header-tier">{concept.riskTier}</span>
            <p className="chat-header-name">{primaryName}</p>
            <p className="chat-header-sub">{concept.category}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="chat-close"
          >
            ✕
          </button>
        </header>

        <div ref={listRef} className="chat-body">
          {showStarters && (
            <div className="chat-starters">
              <p className="chat-starters-hint">
                Start with one of these or write your own.
              </p>
              <div className="chat-starters-grid">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chat-starter"
                    onClick={() => setInput(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {status === "submitted" && (
            <div className="chat-msg chat-msg-assistant">
              <p className="chat-msg-meta">Advisor</p>
              <p className="chat-msg-text chat-msg-thinking">Thinking…</p>
            </div>
          )}

          {error && (
            <div className="chat-msg chat-msg-error">
              <p className="chat-msg-meta">Error</p>
              <p className="chat-msg-text">{error.message || "Something went wrong."}</p>
            </div>
          )}
        </div>

        <form className="chat-input-row" onSubmit={onSubmit}>
          <input
            type="text"
            className="chat-input"
            placeholder="Push back, pivot, or probe…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            aria-label="Message"
          />
          {busy ? (
            <button type="button" onClick={stop} className="chat-send chat-send-stop">
              Stop
            </button>
          ) : (
            <button type="submit" className="chat-send" disabled={!input.trim()}>
              Send →
            </button>
          )}
        </form>
      </aside>
    </>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const role = message.role;
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  return (
    <div className={`chat-msg ${role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`}>
      <p className="chat-msg-meta">{role === "user" ? "You" : "Advisor"}</p>
      <p className="chat-msg-text">{renderMessageText(text)}</p>
    </div>
  );
}

function renderMessageText(text: string): React.ReactNode {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((p, i) => (
    <span key={i} className="chat-paragraph">
      {p.split(/(\*\*[^*]+\*\*)/g).map((seg, j) => {
        const m = seg.match(/^\*\*(.+)\*\*$/);
        if (m) return <strong key={j}>{m[1]}</strong>;
        return <span key={j}>{seg}</span>;
      })}
    </span>
  ));
}
