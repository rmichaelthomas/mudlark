import type { Page } from 'playwright';

// The settle protocol (checkpoint v1.1 §4), run in order before any
// measurement. Step 1 — launching the browser context with
// `reducedMotion: 'reduce'` — happens where the context is created
// (src/capture/capture.ts), not here, since it is a context launch
// option rather than a page action.
//
// Every step below is best-effort. Earlier commits in the subject range
// predate the redesign and may have no `.reveal-ready` elements and no
// reduced-motion CSS block at all — a missing selector is not an error,
// per checkpoint failure mode #8.
export async function settlePage(page: Page): Promise<void> {
  // Step 2: network idle.
  await page.waitForLoadState('networkidle').catch(() => {});

  // Step 3: web fonts landed.
  await page
    .evaluate(async () => {
      if (typeof document.fonts !== 'undefined') {
        await document.fonts.ready;
      }
    })
    .catch(() => {});

  // Step 4: trip any IntersectionObserver that hasn't fired yet, then
  // force-reveal anything still waiting on one.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(50);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(50);
  await page
    .evaluate(() => {
      document.querySelectorAll('.reveal-ready').forEach((el) => el.classList.add('revealed'));
    })
    .catch(() => {});

  // Step 5: take the default view. No hash, no switchView call — this is
  // intentionally a no-op, left here so the protocol's five steps stay
  // visible as five steps rather than four-plus-an-omission.
}
