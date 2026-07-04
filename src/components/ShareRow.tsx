'use client';

// Reusable share control (audit #9). Not wired into any page here — other
// components import it and pass their own { url, text, title }.
//
// Prefers the native Web Share API (one tap, the OS's own share sheet) and
// falls back to one-tap prefilled intent links for X / Bluesky / WhatsApp
// when it isn't available. `navigator` is only ever touched inside the click
// handler, never at render time, so server and pre-hydration client markup
// always match — no SSR guard needed beyond that. Zero external deps: the
// icon is inline SVG.

import { useId, useState } from 'react';

export interface ShareRowProps {
  /** Absolute URL to share (e.g. a match or ledger page). Omit for
   *  text-only shares — the fallback intent links simply carry no link. */
  url?: string;
  text: string;
  title?: string;
  className?: string;
}

function ShareIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </svg>
  );
}

/** Bluesky and WhatsApp intents have no separate `url` field — the link
 *  rides along inside the text, same as pasting a link into either app. */
function buildIntentLinks(url: string | undefined, text: string) {
  const textWithUrl = url ? `${text} ${url}` : text;
  return {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url ?? '')}`,
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(textWithUrl)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(textWithUrl)}`,
  };
}

export default function ShareRow({ url, text, title, className }: ShareRowProps) {
  const [revealed, setRevealed] = useState(false);
  const listId = useId();
  const links = buildIntentLinks(url, text);

  async function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // The visitor cancelled the system share sheet, or it failed for
        // some other reason — nothing to surface; the fallback links below
        // remain a manual option if they reveal them.
      }
      return;
    }
    setRevealed((r) => !r);
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleShare}
        aria-expanded={revealed}
        aria-controls={listId}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
      >
        <ShareIcon />
        Share
      </button>
      <ul id={listId} className={`mt-2 flex flex-wrap gap-2 ${revealed ? '' : 'hidden'}`}>
        <li>
          <a
            href={links.x}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3.5 text-sm text-fg-dim transition-colors hover:text-fg"
          >
            X
          </a>
        </li>
        <li>
          <a
            href={links.bluesky}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3.5 text-sm text-fg-dim transition-colors hover:text-fg"
          >
            Bluesky
          </a>
        </li>
        <li>
          <a
            href={links.whatsapp}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3.5 text-sm text-fg-dim transition-colors hover:text-fg"
          >
            WhatsApp
          </a>
        </li>
      </ul>
    </div>
  );
}
