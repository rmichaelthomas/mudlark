import type { Page } from 'playwright';
import type { DeclaredState } from '../states/types';

// The settle protocol (checkpoint v1.1 §4, extended by v1.2 §4), run in
// order before any measurement. Step 1 — launching the browser context
// with `reducedMotion: 'reduce'` — happens where the context is created
// (src/capture/capture.ts), not here, since it is a context launch
// option rather than a page action.
//
// Every step below is best-effort. Earlier commits in the subject range
// predate the redesign and may have no `.reveal-ready` elements and no
// reduced-motion CSS block at all — a missing selector is not an error,
// per checkpoint failure mode #8. State scripts (step 5) inherit this
// discipline exactly: a script written against a later commit's markup
// can throw on an earlier one, and that is not an error either — it is
// the state captured in whatever position the page was already in.
export async function settlePage(page: Page, state: DeclaredState): Promise<void> {
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

  // Step 5: run the declared state's script, if any. No hash, no
  // switchView call of our own — whatever the state wants, the state's
  // own script says so explicitly.
  if (state.script !== null) {
    try {
      await page.evaluate(state.script);
    } catch (err) {
      console.warn(`[settle] state "${state.id}" script threw, capturing as-is: ${(err as Error).message}`);
    }

    // A state script can reveal a region that was display:none, whose
    // IntersectionObservers never fired while hidden — re-run the
    // reveal-forcing pass and give the page a moment to react.
    await page
      .evaluate(() => {
        document.querySelectorAll('.reveal-ready').forEach((el) => el.classList.add('revealed'));
      })
      .catch(() => {});
    await page.waitForTimeout(100);
  }
}
