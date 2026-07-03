'use client';

// Tiny copy-to-clipboard affordance for a pool's invite link — a client
// island on an authed dynamic segment only (the public surface stays
// zero-client-JS). The full link is ALWAYS rendered as selectable text by the
// parent, so this button is a convenience, never the only path.

import { useState } from 'react';

export default function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard unavailable (permissions/http) — the visible link
          // remains selectable, so there is nothing further to do.
        }
      }}
      className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
    >
      {copied ? 'Copied' : 'Copy link'}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Invite link copied to clipboard' : ''}
      </span>
    </button>
  );
}
