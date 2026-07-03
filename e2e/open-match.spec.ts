import { test, expect } from '@playwright/test';

// W6 "open match of the day" (ROADMAP.md §2, owner-approved premium
// packaging): ONE deterministic fixture per UTC day renders its premium
// deeper read FREE on the public match page; every other fixture keeps the
// single quiet premium callout.
//
// Selection (src/lib/queries/openMatch.ts) is a LIVE anon DB read of today's
// earliest displayed call — it has no preview hatch, so against the preview
// match pages (ids 1–8, PREVIEW_MATCH=1) the day's real fixture id usually
// falls outside the preview set. The deterministic, always-true contract is
// therefore pinned as: every match page shows EXACTLY ONE deeper-read
// surface (the open note XOR the premium callout — never both, never
// neither), and the open note appears on AT MOST one page per day. "Exactly
// one page shows it" additionally holds whenever the live open match id
// lands inside the rendered set — asserted as ≤1 here so the suite stays
// honest about what a preview build can prove. (A PREVIEW_OPEN_MATCH hatch
// would make the =1 case deterministic — noted for frontend-dev.)

const PREVIEW_MATCH_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

test('every preview match page shows exactly one deeper-read surface; the open note at most once', async ({
  page,
}) => {
  let openPages = 0;

  for (const id of PREVIEW_MATCH_IDS) {
    await page.goto(`/match/${id}`, { waitUntil: 'load' });

    const openNote = page.locator('section[aria-labelledby="open-read-heading"]');
    const callout = page.locator('section[aria-labelledby="deeper-read-heading"]');
    const openCount = await openNote.count();
    const calloutCount = await callout.count();

    expect(
      openCount + calloutCount,
      `/match/${id} must render exactly one deeper-read surface (got open=${openCount}, callout=${calloutCount})`,
    ).toBe(1);

    if (openCount > 0) {
      openPages += 1;
      // The open note states its own honesty terms: free for everyone on
      // this page, and the free-forever floor restated beside it.
      await expect(openNote.getByRole('heading', { name: 'Deeper read' })).toBeVisible();
      await expect(
        openNote.getByText('free for everyone on this page'),
      ).toBeVisible();
      await expect(
        openNote.getByText(/stay free forever either way/),
      ).toBeVisible();
    } else {
      // The standard quiet callout: identical for every visitor, one link
      // to the dynamic insights route which decides entitlement for itself.
      await expect(
        callout.getByRole('link', { name: 'See the deeper read' }),
      ).toHaveAttribute('href', `/match/${id}/insights`);
    }
  }

  expect(
    openPages,
    'the open-match deeper read must never appear on more than one match page per day',
  ).toBeLessThanOrEqual(1);
});
