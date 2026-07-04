import type { ReactNode } from 'react';
import { BOTTOM_TAB_HREFS, NAV } from '@/components/Header';
import BottomTabLink from '@/components/BottomTabLink';
import MobileNav from '@/components/MobileNav';
import {
  HomeTabIcon,
  MatchesTabIcon,
  PlayTabIcon,
  TrackRecordTabIcon,
} from '@/components/icons';

// The persistent, thumb-reachable bottom tab bar (RAMBO wave 3 #6) — always
// visible below `md`, replacing "every destination is two taps deep behind a
// hamburger" with "the four most-used destinations are one tap away, and
// everything else is one tap into a labelled 'More' overflow" (the dominant
// sports-app pattern — FotMob/Sofascore/Onefootball/Flashscore all ship a
// 4–5 item bottom bar). A plain server-rendered `<nav>` of `<Link>`s
// (ARCHITECTURE.md §6: zero client JS on the public surface); only the
// per-tab ACTIVE-state highlight is a client island (BottomTabLink.tsx).
//
// A SECOND, DISTINCT landmark from Header's own `nav[aria-label="Primary"]`
// (deliberately different wording — "Bottom navigation" vs "Primary" — so a
// screen reader never announces two ambiguous, identically-labelled `nav`
// landmarks). Header's inline row stays the desktop-only primary nav;
// MobileNav (rendered here, as the 5th "More" slot) still carries the
// overflow destinations plus Sign in/Account/Go Premium exactly as before —
// unchanged behaviour, just relocated out of the header row and into this bar
// so mobile visitors get one consistent nav surface instead of two separate
// affordances (a header-corner hamburger AND — now — a tab bar).
//
// Offset math (coordinated with the sticky day-group headers, #7a, in the
// SAME pass): Header's rendered height is 56px (44px `min-h-11` content +
// 12px `py-1.5`, +1px border — the sticky headers use `top-14`/56px and
// accept that ~1px tolerance). This bar mirrors that: each tab is a fixed
// `h-14` (56px) row, so `env(safe-area-inset-bottom)` is the ONLY variable
// component of its total footprint — which is exactly what
// `src/app/layout.tsx`'s `<main>` reserves via its bottom padding.
// Rendered elements, not component references — a Server Component may pass
// JSX to a Client Component (BottomTabLink) as a prop, but never a bare
// function/component reference, which React can't serialise across that
// boundary.
const TAB_ICON: Record<(typeof BOTTOM_TAB_HREFS)[number], ReactNode> = {
  '/': <HomeTabIcon className="h-5 w-5" />,
  '/matches': <MatchesTabIcon className="h-5 w-5" />,
  '/play': <PlayTabIcon className="h-5 w-5" />,
  '/ledger': <TrackRecordTabIcon className="h-5 w-5" />,
};

export default function BottomTabBar() {
  // Built from BOTTOM_TAB_HREFS (not a filtered NAV) so each tab's `href`
  // keeps its narrow literal type — the label alone is looked up from NAV,
  // the single source of truth for the copy.
  const tabs = BOTTOM_TAB_HREFS.map((href) => {
    const label = NAV.find((n) => n.href === href)?.label;
    if (!label) {
      throw new Error(`BottomTabBar: NAV is missing an entry for ${href}`);
    }
    return { href, label, icon: TAB_ICON[href] };
  });

  return (
    // No backdrop-filter on this bar: a `backdrop-blur` would make it a
    // containing block for MobileNav's `position: fixed` overlay (rendered in
    // the "More" slot below), trapping the mobile menu inside this ~56px bar
    // instead of letting it cover the viewport. A solid `bg-bg` keeps the bar
    // opaque over scrolling content without that side effect. Do NOT re-add a
    // backdrop-filter/transform/filter here without portalling the overlay.
    <nav
      aria-label="Bottom navigation"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <BottomTabLink href={tab.href} label={tab.label} icon={tab.icon} />
          </li>
        ))}
        <li>
          <MobileNav />
        </li>
      </ul>
    </nav>
  );
}
