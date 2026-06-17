// Reserved ad slot. Renders NOTHING in v1.
//
// Ads are built-ready but OFF (ARCHITECTURE.md §4, §13): they require our own
// domain plus network approval and are deferred. This typed placeholder lets ad
// units be dropped in later without touching page layouts. It intentionally
// returns null.

export interface AdSlotProps {
  /** Logical slot name, e.g. 'home-top', 'match-top', 'ledger-inline'. */
  slot?: string;
  className?: string;
}

export default function AdSlot(props: AdSlotProps): null {
  // Reserved: `props` (slot, className) will configure the ad unit when ads are
  // switched on. Referenced here so it is not flagged as unused.
  void props;
  return null;
}
