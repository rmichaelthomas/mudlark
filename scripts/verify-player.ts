// Player verification: drives the real player in a real browser and
// asserts the things that are easy to break by hand and impossible to
// see in a typecheck — that the film loops, that the whole artifact is
// actually inside the frame, that the timeline seeks where you clicked.
//
// Companion to verify-capture-playback.ts, which verifies the record.
// This one verifies the watching.
//
// The observable for film time is the timeline's `aria-valuenow`. That
// is a real accessibility attribute the player sets regardless of
// testing — no test-only instrumentation is compiled into the player.
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_URL_PATTERN = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/;
const SERVER_TIMEOUT_MS = 60_000;

interface Assertion {
  id: string;
  blocking: boolean;
  description: string;
  pass: boolean;
  detail: string;
}

const results: Assertion[] = [];

function assert(id: string, blocking: boolean, description: string, pass: boolean, detail: string): void {
  results.push({ id, blocking, description, pass, detail });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function startDevServer(): Promise<{ url: string; child: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite'], { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('dev server did not report a URL within 60s'));
    }, SERVER_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const match = chunk.match(DEV_URL_PATTERN);
      if (match) {
        clearTimeout(timer);
        resolve({ url: match[1], child });
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// --- observables -----------------------------------------------------

function filmSec(page: Page): Promise<number> {
  return page.$eval('#timeline', (el) => Number(el.getAttribute('aria-valuenow')));
}

function totalSec(page: Page): Promise<number> {
  return page.$eval('#timeline', (el) => Number(el.getAttribute('aria-valuemax')));
}

async function playState(page: Page): Promise<string> {
  return (await page.getAttribute('#play', 'data-state')) ?? '';
}

// Film time and wall-clock time sampled at the same instant, in the same
// clock, inside the page. Reading film time over CDP and wall-clock from
// Node puts round-trip latency into one term and not the other, which on
// a loaded machine skews a short measurement badly enough to fail a
// correct player.
async function sample(page: Page): Promise<{ sec: number; t: number }> {
  return page.evaluate(() => ({
    sec: Number(document.getElementById('timeline')!.getAttribute('aria-valuenow')),
    t: performance.now(),
  }));
}

// Measures how much film time passes per second of wall-clock time.
// `aria-valuenow` only advances on a rAF, so a read can lag reality by up
// to one frame; the window is wide enough that one slow frame doesn't
// dominate the result.
async function measureRate(page: Page, overMs: number): Promise<number> {
  const before = await sample(page);
  await sleep(overMs);
  const after = await sample(page);
  return (after.sec - before.sec) / ((after.t - before.t) / 1000);
}

// --- checks ----------------------------------------------------------

async function checkLoop(page: Page): Promise<void> {
  const total = await totalSec(page);

  // Park just before the end, at 1x, loop on, and let it run past.
  await page.selectOption('#speed', '1');
  await seekTo(page, total - 0.35);
  await setLoop(page, true);
  await page.click('#play');

  // Watch for the playhead to reach the end and stay there (the beat).
  let sawHold = false;
  let holdMs = 0;
  let restarted = false;
  const deadline = Date.now() + 12_000;
  let atEndSince: number | null = null;

  while (Date.now() < deadline) {
    const sec = await filmSec(page);
    if (sec >= total - 0.02) {
      if (atEndSince === null) atEndSince = Date.now();
    } else if (atEndSince !== null) {
      holdMs = Date.now() - atEndSince;
      sawHold = holdMs >= 300;
      restarted = sec < total * 0.5;
      break;
    }
    await sleep(50);
  }

  assert(
    'L1',
    true,
    'Loop: with loop on, the film restarts from the top after reaching the end instead of dying at the last frame',
    restarted,
    `restarted=${restarted} holdMs=${holdMs}`,
  );
  assert(
    'L2',
    true,
    'Loop beat: the playhead holds on the final frame for a visible beat (>=300ms) before restarting',
    sawHold,
    `holdMs=${holdMs} (target ~1200ms at 1x)`,
  );

  // Still playing after the loop.
  await sleep(400);
  assert(
    'L3',
    true,
    'Loop continuity: playback continues after the restart rather than stopping at the top',
    (await playState(page)) === 'playing',
    `playState=${await playState(page)}`,
  );
  await page.click('#play'); // pause
}

async function checkReplayAtEnd(page: Page): Promise<void> {
  await setLoop(page, false);
  const total = await totalSec(page);

  // Let the film genuinely run off the end rather than dropping the
  // playhead on the last pixel — the transition into "ended" is the
  // thing under test, not the seek.
  await page.selectOption('#speed', '1');
  await seekTo(page, total - 0.3);
  await page.click('#play');

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if ((await playState(page)) === 'ended') break;
    await sleep(50);
  }

  const stateAtEnd = await playState(page);
  const labelAtEnd = ((await page.textContent('#play')) ?? '').trim();
  const secAtEnd = await filmSec(page);

  assert(
    'L4',
    true,
    'End of film (loop off): playback stops on the final frame and the transport reports an ended state rather than looking playable',
    stateAtEnd === 'ended' && Math.abs(secAtEnd - total) < 0.05,
    `data-state=${stateAtEnd} filmSec=${secAtEnd.toFixed(2)}/${total.toFixed(2)} label=${JSON.stringify(labelAtEnd)}`,
  );

  // The regression this exists for: pressing play at the end used to run
  // for one frame and die, so the button looked alive and did nothing.
  await page.click('#play');
  await sleep(500);
  const secAfter = await filmSec(page);
  assert(
    'L5',
    true,
    'Play at the end restarts the film from the top (regression: it used to advance one frame and stop)',
    secAfter < total * 0.5 && (await playState(page)) === 'playing',
    `filmSec=${secAfter.toFixed(2)} of ${total.toFixed(2)} playState=${await playState(page)}`,
  );
  await page.click('#play');
  await setLoop(page, true);
}

async function checkFraming(page: Page): Promise<void> {
  // Fit width is the default: framing a 4000px page whole makes body
  // text a suggestion of text rather than readable text.
  assert(
    'F0',
    true,
    'Framing: the player opens in Fit width — the artifact legible at full width — rather than shrunk to fit whole',
    (await page.inputValue('#zoom')) === 'fit-width',
    `#zoom=${await page.inputValue('#zoom')}`,
  );

  // The default overflows vertically, so the top of the film has to be
  // both reachable and where you start. A flex container that centers an
  // overflowing child can strand its top above the scroll origin.
  const overflow = await page.evaluate(() => {
    const viewport = document.getElementById('viewport')!;
    const frame = document.getElementById('frame')!.getBoundingClientRect();
    return {
      scrollTop: viewport.scrollTop,
      scrollable: viewport.scrollHeight > viewport.clientHeight,
      frameTop: frame.top - viewport.getBoundingClientRect().top,
    };
  });
  assert(
    'F4',
    true,
    'Framing (Fit width): the film starts at its top and the top stays reachable when it overflows the pane',
    overflow.scrollTop === 0 && overflow.frameTop >= 0,
    `scrollTop=${overflow.scrollTop} frameTopRelativeToViewport=${overflow.frameTop.toFixed(1)} scrollable=${overflow.scrollable}`,
  );

  const widthMode = await page.evaluate(() => {
    const viewport = document.getElementById('viewport')!.getBoundingClientRect();
    const frame = document.getElementById('frame')!.getBoundingClientRect();
    return { ratio: frame.width / viewport.width };
  });
  assert(
    'F2',
    false,
    'Framing (Fit width): the artifact spans the viewport width (diagnostic — capped at 100%, so a wide pane can fall short)',
    widthMode.ratio > 0.9,
    `frameWidth/viewportWidth=${widthMode.ratio.toFixed(3)}`,
  );

  // Fit puts the whole artifact on screen at every window size.
  await page.selectOption('#zoom', 'fit');
  await sleep(300);

  const sizes = [
    { width: 1440, height: 900 },
    { width: 1920, height: 1200 },
    { width: 1180, height: 760 },
  ];

  const failures: string[] = [];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await sleep(400);
    const fits = await page.evaluate(() => {
      const viewport = document.getElementById('viewport')!.getBoundingClientRect();
      const frame = document.getElementById('frame')!.getBoundingClientRect();
      return {
        vw: viewport.width,
        vh: viewport.height,
        fw: frame.width,
        fh: frame.height,
        insideW: frame.width <= viewport.width + 1,
        insideH: frame.height <= viewport.height + 1,
      };
    });
    if (!fits.insideW || !fits.insideH) {
      failures.push(`${size.width}x${size.height}: frame ${fits.fw.toFixed(0)}x${fits.fh.toFixed(0)} in viewport ${fits.vw.toFixed(0)}x${fits.vh.toFixed(0)}`);
    }
  }

  assert(
    'F1',
    true,
    'Framing (Fit): the entire artifact fits inside the viewport at every tested window size — no scrolling to see the film',
    failures.length === 0,
    failures.length === 0 ? `fits at ${sizes.map((s) => `${s.width}x${s.height}`).join(', ')}` : failures.join('; '),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  await page.selectOption('#zoom', 'actual');
  await sleep(300);
  const actual = await page.evaluate(() => document.getElementById('frame')!.getBoundingClientRect().width);
  assert(
    'F3',
    true,
    'Framing (100%): the artifact renders at its captured 1280px width, unscaled',
    Math.abs(actual - 1280) < 2,
    `frameWidth=${actual.toFixed(1)} expected 1280`,
  );

  await page.selectOption('#zoom', 'fit-width');
  await sleep(300);
}

async function checkTimeline(page: Page): Promise<void> {
  const total = await totalSec(page);
  const box = (await page.$('#timeline'))!;
  const rect = (await box.boundingBox())!;

  // Click at 50% of the track: a scrubber seeks where you clicked, it
  // does not snap to the nearest commit boundary.
  await page.mouse.click(rect.x + rect.width * 0.5, rect.y + rect.height / 2);
  await sleep(300);
  const seeked = await filmSec(page);
  assert(
    'T1',
    true,
    'Timeline: clicking halfway along the track seeks to halfway through the film (continuous scrub, not commit-snapped)',
    Math.abs(seeked - total * 0.5) < total * 0.05,
    `clicked 50% -> ${seeked.toFixed(2)}s of ${total.toFixed(2)}s`,
  );

  // Dragging scrubs.
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const dragged = await filmSec(page);
  assert(
    'T2',
    true,
    'Timeline: dragging the track scrubs the film',
    Math.abs(dragged - total * 0.8) < total * 0.05,
    `dragged to 80% -> ${dragged.toFixed(2)}s of ${total.toFixed(2)}s`,
  );

  // Hover raises a styled tooltip carrying the commit message.
  await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height / 2);
  await sleep(300);
  const tip = await page.evaluate(() => {
    const el = document.querySelector('#timeline .tl-tip') as HTMLElement | null;
    if (!el) return null;
    return { visible: getComputedStyle(el).opacity !== '0', text: el.textContent ?? '' };
  });
  assert(
    'T3',
    true,
    'Timeline: hovering a commit segment raises a tooltip carrying that commit message',
    Boolean(tip && tip.visible && tip.text.trim().length > 0),
    tip ? `visible=${tip.visible} text=${JSON.stringify(tip.text.slice(0, 60))}` : 'no .tl-tip element',
  );

  // Commit stepping lives on the transport buttons and the arrow keys.
  await seekTo(page, 0);
  await sleep(200);
  const start = ((await page.textContent('#commit-count')) ?? '').trim();
  await page.click('#next-commit');
  await sleep(250);
  const afterNext = ((await page.textContent('#commit-count')) ?? '').trim();
  await page.click('#prev-commit');
  await sleep(250);
  const afterPrev = ((await page.textContent('#commit-count')) ?? '').trim();
  assert(
    'T4',
    true,
    'Transport: the previous/next commit buttons step exactly one commit and agree with the commit counter',
    start === '1 / 12' && afterNext === '2 / 12' && afterPrev === '1 / 12',
    `${start} -> next -> ${afterNext} -> prev -> ${afterPrev}`,
  );
}

async function checkControlSizing(page: Page): Promise<void> {
  const MIN_EDGE = 34; // a control smaller than this reads as an afterthought
  const boxes = await page.evaluate(() => {
    const ids = ['prev-commit', 'play', 'next-commit', 'loop', 'fullscreen', 'speed', 'zoom'];
    return ids.map((id) => {
      const rect = document.getElementById(id)!.getBoundingClientRect();
      return { id, w: Math.round(rect.width), h: Math.round(rect.height) };
    });
  });
  const tooSmall = boxes.filter((b) => Math.min(b.w, b.h) < MIN_EDGE);
  const play = boxes.find((b) => b.id === 'play')!;
  const prev = boxes.find((b) => b.id === 'prev-commit')!;

  assert(
    'C1',
    true,
    `Transport sizing: every control's shorter edge is at least ${MIN_EDGE}px, and play is the largest — the controls read as a transport, not as afterthoughts`,
    tooSmall.length === 0 && play.w > prev.w,
    `${boxes.map((b) => `${b.id}=${b.w}x${b.h}`).join(' ')}${tooSmall.length ? ` | undersized: ${tooSmall.map((b) => b.id).join(', ')}` : ''}`,
  );
}

// The reported nag: after picking a zoom or a speed with the mouse,
// focus is left on that dropdown, and the next reach is for Space.
async function checkKeyboardAfterDropdown(page: Page): Promise<void> {
  await seekTo(page, 0);
  await sleep(200);

  const cases: Array<[string, string]> = [
    ['#zoom', 'fit'],
    ['#speed', '2'],
  ];
  const failures: string[] = [];

  for (const [selector, value] of cases) {
    await page.selectOption(selector, value);
    await page.focus(selector); // exactly where a mouse pick leaves it
    await page.keyboard.press('Space');
    await sleep(350);
    const started = (await playState(page)) === 'playing';
    if (!started) failures.push(`${selector} -> Space did not start playback (state=${await playState(page)})`);
    if (started) {
      await page.keyboard.press('Space');
      await sleep(200);
    }
  }

  assert(
    'K1',
    true,
    'Keyboard: Space starts the film with a dropdown still focused, instead of reopening the dropdown',
    failures.length === 0,
    failures.length === 0 ? 'zoom and speed both yield to Space' : failures.join('; '),
  );

  // Arrows are the other half of the bargain: a focused dropdown keeps
  // them, so its values can still be cycled from the keyboard.
  await seekTo(page, 0);
  await sleep(200);
  const before = ((await page.textContent('#commit-count')) ?? '').trim();
  await page.focus('#zoom');
  await page.keyboard.press('ArrowDown');
  await sleep(250);
  const after = ((await page.textContent('#commit-count')) ?? '').trim();
  assert(
    'K2',
    true,
    'Keyboard: a focused dropdown keeps its own arrow keys — arrowing inside it does not step the film',
    before === after,
    `commit counter ${before} -> ${after} while arrowing inside #zoom`,
  );

  await page.selectOption('#zoom', 'fit-width');
  await page.selectOption('#speed', '1');
  await page.click('#viewport', { position: { x: 5, y: 5 } });
  await sleep(200);
}

async function checkSpeeds(page: Page): Promise<void> {
  const measured: Record<string, number> = {};
  const failures: string[] = [];

  for (const speed of ['0.5', '1', '2', '4', '8']) {
    await seekTo(page, 0);
    await page.selectOption('#speed', speed);
    await page.click('#play');
    await sleep(150); // let the first frame establish a baseline
    const rate = await measureRate(page, 1200);
    await page.click('#play');
    measured[`${speed}x`] = Number(rate.toFixed(2));
    // Generous tolerance: this is a real rAF loop on a real machine.
    if (Math.abs(rate - Number(speed)) > Number(speed) * 0.35) {
      failures.push(`${speed}x measured ${rate.toFixed(2)}`);
    }
  }

  assert(
    'S1',
    true,
    'Speed: every rung of the 0.5x/1x/2x/4x/8x ladder advances film time at its stated multiple of wall-clock time',
    failures.length === 0,
    JSON.stringify(measured),
  );
}

// --- helpers that drive the player the way a person would -------------

async function seekTo(page: Page, sec: number): Promise<void> {
  const handle = (await page.$('#timeline'))!;
  const rect = (await handle.boundingBox())!;
  const total = await totalSec(page);
  // Clamped just inside the right edge: a click at exactly rect.x +
  // rect.width lands one pixel outside the element.
  const fraction = Math.max(0, Math.min(0.999, sec / total));
  await page.mouse.click(rect.x + rect.width * fraction, rect.y + rect.height / 2);
}

async function setLoop(page: Page, on: boolean): Promise<void> {
  const pressed = (await page.getAttribute('#loop', 'aria-pressed')) === 'true';
  if (pressed !== on) await page.click('#loop');
}

// --- report ----------------------------------------------------------

function report(): boolean {
  const width = Math.max(...results.map((r) => r.id.length), 2);
  console.log('');
  console.log(`${'ID'.padEnd(width)}  BLOCKING  STATUS  DESCRIPTION`);
  for (const r of results) {
    console.log(`${r.id.padEnd(width)}  ${r.blocking ? 'yes' : 'no '}       ${r.pass ? 'PASS' : 'FAIL'}    ${r.description}`);
    console.log(`${''.padEnd(width)}  ${r.detail}`);
  }
  const blockingFailures = results.filter((r) => r.blocking && !r.pass);
  console.log('');
  if (blockingFailures.length === 0) {
    console.log(`RESULT: all blocking assertions (${results.filter((r) => r.blocking).map((r) => r.id).join(', ')}) pass.`);
    return true;
  }
  console.log(`RESULT: ${blockingFailures.length} blocking assertion(s) FAILED: ${blockingFailures.map((r) => r.id).join(', ')}`);
  return false;
}

async function main(): Promise<void> {
  const { url, child } = await startDevServer();
  let browser: Browser | null = null;
  const consoleErrors: string[] = [];

  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#timeline', { timeout: 15_000 });
    await sleep(1200);

    await checkFraming(page);
    await checkControlSizing(page);
    await checkTimeline(page);
    await checkKeyboardAfterDropdown(page);
    await checkSpeeds(page);
    await checkLoop(page);
    await checkReplayAtEnd(page);

    assert(
      'X1',
      true,
      'Console hygiene: the player raises no page errors or console errors across the whole run',
      consoleErrors.length === 0,
      consoleErrors.length === 0 ? 'clean' : consoleErrors.slice(0, 4).join(' | '),
    );
  } finally {
    if (browser) await browser.close();
    child.kill();
  }

  if (!report()) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
