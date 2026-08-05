import type { Page } from 'playwright';
import type { DeclaredState } from '../states/types';

// Polls document.documentElement.scrollHeight across animation frames
// until two consecutive frames agree, rather than guessing a fixed
// delay. Confirmed necessary and confirmed insufficient as a one-shot
// call after fonts.ready alone: layout can still drift after the
// reveal-forcing pass (step 4) and after a state script (step 5), so
// every step below that can change layout calls this again — a fixed
// wait anywhere in the middle isn't enough on its own.
export async function waitForLayoutStable(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      // Google Fonts serves with font-display: swap — text renders in a
      // fallback font immediately, then swaps once the custom font
      // loads, which is a second, separate reflow that can land a frame
      // or more after document.fonts.ready resolves. A single matching
      // pair of consecutive frames isn't reliable evidence the swap has
      // finished; require five in a row.
      let previous = -1;
      let stableStreak = 0;
      for (let i = 0; i < 60 && stableStreak < 5; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const current = document.documentElement.scrollHeight;
        if (current === previous) {
          stableStreak++;
        } else {
          stableStreak = 0;
        }
        previous = current;
      }
    })
    .catch(() => {});
}

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

  // Step 3: web fonts landed. `document.fonts.ready` resolves once every
  // FontFace has been fetched and parsed, but for a variable font (the
  // subject's Fraunces uses an optical-size axis) the browser can still
  // take several layout/paint passes to fully apply axis-dependent
  // metrics — measuring immediately after `ready` resolves is a real,
  // reproducible source of height drift (confirmed: consecutive
  // captures of the same commit landing on two distinct docHeight
  // values).
  await page
    .evaluate(async () => {
      if (typeof document.fonts !== 'undefined') {
        await document.fonts.ready;
      }
    })
    .catch(() => {});
  await waitForLayoutStable(page);

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
  await waitForLayoutStable(page);

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
    await waitForLayoutStable(page);
  }
}
