"use client";

// Landing-page input. Submits by navigating to /results/[encoded query] —
// streaming + analysis happen on the results page (see app/results/[handle]/page.tsx).

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function AnalyzePanel() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isNavigating) return;
    setIsNavigating(true);
    router.push(`/results/${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={onSubmit} className="off-input-row">
      <input
        type="text"
        className="off-input"
        placeholder="@therebelkid · MrBeast · Apoorva Mukhija"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={isNavigating}
        aria-label="Creator handle, URL, or name"
        autoFocus
      />
      <button type="submit" className="off-button" disabled={isNavigating || !input.trim()}>
        {isNavigating ? "Opening..." : "Analyze →"}
      </button>
    </form>
  );
}
