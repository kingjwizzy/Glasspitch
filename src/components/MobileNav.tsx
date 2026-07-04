'use client';

// Below-md hamburger nav — a small client island beside the (server-rendered)
// Header (audit #2, CRITICAL: a 393px phone clipped the inline link row to
// "Home | Ma…", hiding Chances/Leagues/Play/Track record/About). Header stays
// a static Server Component; this is the one deliberate bit of client JS the
// mobile nav needs, and it renders nothing at md+ (Header's own inline row
// takes over there, unchanged).
//
// Dialog pattern (WAI-ARIA APG): focus moves into the panel on open and back
// to the toggle button on close; Esc, a backdrop click, or a link click all
// close it; Tab is trapped inside while open; body scroll is locked. The
// overlay markup always stays in the DOM (toggled with the `hidden` utility,
// not conditional mounting) so aria-controls always references a real
// element. Motion (the panel's entrance) reuses the existing `.rise-in`
// keyframe, which already sits behind globals.css's prefers-reduced-motion
// kill-switch — nothing new to gate here.

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CrossIcon } from '@/components/icons';
import { NAV } from '@/components/Header';
import { useAuthState } from '@/components/useAuthState';

const PREMIUM_LIVE = process.env.NEXT_PUBLIC_PREMIUM_LIVE === '1';

function HamburgerIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const signedIn = useAuthState() === 'in';
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const toggleButton = toggleRef.current;
    closeRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      (previouslyFocused ?? toggleButton)?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="ml-auto md:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors hover:text-fg"
      >
        {open ? <CrossIcon className="h-5 w-5" /> : <HamburgerIcon />}
      </button>

      <div className={`fixed inset-0 z-30 ${open ? '' : 'hidden'}`}>
        <div
          aria-hidden="true"
          onClick={close}
          className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        />
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Primary navigation"
          className="glass rise-in absolute inset-x-3 top-3 max-h-[calc(100vh-1.5rem)] overflow-y-auto p-2 shadow-2xl"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-display text-sm font-semibold text-fg">Menu</span>
            <button
              ref={closeRef}
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg-dim transition-colors hover:text-fg"
            >
              <CrossIcon className="h-5 w-5" />
            </button>
          </div>
          <ul className="mt-1 border-t border-line pt-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={close}
                  className="flex min-h-11 items-center rounded-md px-2 text-base text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {PREMIUM_LIVE ? (
              <li>
                <Link
                  href="/premium"
                  onClick={close}
                  className="flex min-h-11 items-center rounded-md px-2 text-base font-medium text-away transition-colors hover:bg-surface-2"
                >
                  Go Premium
                </Link>
              </li>
            ) : null}
            <li className="mt-1 border-t border-line pt-1">
              <Link
                href={signedIn ? '/account' : '/login'}
                onClick={close}
                className="flex min-h-11 items-center rounded-md px-2 text-base text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {signedIn ? 'Account' : 'Sign in'}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
