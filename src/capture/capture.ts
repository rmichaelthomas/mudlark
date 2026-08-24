import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { extractTree } from '../git/extract';
import { commitsForPath, type CommitMeta } from '../git/log';
import { ROUTED_PROPERTIES } from '../layers/routing';
import { serveTree } from './serve';
import { settlePage, waitForLayoutStable } from './settle';
import { walkPage } from './walk';
import type { Snapshot } from './types';
import { DEFAULT_STATE, type DeclaredState, type SubjectConfig } from '../states/types';
import { loadSubjectConfig } from '../states/load';

const VIEWPORT_WIDTH = 1280;
// The settle protocol's font-swap timing race (see settle.ts) was
// empirically stable at this height and got measurably flakier when
// this was raised to comfortably fit the whole page up front (confirmed:
// recapture divergence rate went from ~1-in-12 to ~3-in-4) — a taller
// viewport means more content to lay out during the same settle window,
// widening the race. Settle happens at this height; the walker's
// flip-card backface pruning needs the FULL page on-screen (see
// isFacingAway's use of document.elementsFromPoint), so captureState
// grows the viewport to fit only after settling, once layout is already
// stable and there's nothing left to race against.
const CAPTURE_HEIGHT = 2000;

// Resolved against the mudlark checkout, not the caller's cwd, so
// `npx mudlark` from an arbitrary directory shares one cache instead of
// leaving an out/ behind wherever it was run.
const FONT_CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../out/.fontcache');
const FONT_HOST_PATTERN = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

export interface CaptureOptions {
  viewportWidth?: number;
  captureHeight?: number;
}

// The subject loads five Google Fonts families on every load — 48
// round trips across a full multi-state run, and the only genuinely
// flaky step in the pipeline (checkpoint v1.2 §4, failure mode #3). A
// cold or stalled fetch resolves document.fonts.ready against fallback
// metrics, which shows up as a spurious Content+Layout delta on a commit
// that changed nothing. Cached to disk, keyed by URL hash, so capture
// is offline and byte-deterministic after the first run.
async function setupFontCache(context: BrowserContext): Promise<void> {
  await mkdir(FONT_CACHE_DIR, { recursive: true });
  await context.route(FONT_HOST_PATTERN, async (route) => {
    const url = route.request().url();
    const key = createHash('sha256').update(url).digest('hex');
    const bodyPath = path.join(FONT_CACHE_DIR, key);
    const metaPath = `${bodyPath}.json`;

    if (existsSync(bodyPath) && existsSync(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { contentType: string };
      const body = await readFile(bodyPath);
      await route.fulfill({ status: 200, contentType: meta.contentType, body });
      return;
    }

    const response = await route.fetch();
    const body = await response.body();
    await writeFile(bodyPath, body);
    await writeFile(metaPath, JSON.stringify({ contentType: response.headers()['content-type'] ?? 'application/octet-stream' }));
    await route.fulfill({ response, body });
  });
}

async function captureState(
  page: Page,
  servedUrl: string,
  commit: CommitMeta,
  state: DeclaredState,
  viewportWidth: number,
): Promise<Snapshot> {
  await page.goto(servedUrl, { waitUntil: 'load' });
  await settlePage(page, state);

  // Grow the viewport to fit the whole page only now, after layout has
  // already settled — the walker's flip-card backface-visibility
  // pruning needs every element on-screen to test paint visibility (see
  // walk.ts's isFacingAway). Re-stabilize afterward: resizing can itself
  // trigger a reflow (the subject listens for `resize`).
  const settledHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewport = page.viewportSize();
  if (viewport && settledHeight > viewport.height) {
    await page.setViewportSize({ width: viewportWidth, height: Math.ceil(settledHeight) });
    await waitForLayoutStable(page);
  }

  const nodes = await walkPage(page, ROUTED_PROPERTIES);
  const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const scriptText = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script'))
      .map((s) => s.textContent ?? '')
      .join('\n'),
  );
  const scriptHash = createHash('sha256').update(scriptText).digest('hex');

  return {
    sha: commit.sha,
    date: commit.date,
    author: commit.author,
    message: commit.message,
    stateId: state.id,
    viewportWidth,
    docHeight,
    nodes,
    scriptHash,
  };
}

// Captures a single (commit, state) pair standalone — its own
// extraction, serve, and context. Used where only one snapshot is
// needed (e.g. the verification script's recapture-and-diff check);
// captureAll below uses the shared-context path since it captures
// every state of a commit together.
export async function captureCommit(
  browser: Browser,
  repoDir: string,
  commit: CommitMeta,
  state: DeclaredState = DEFAULT_STATE,
  opts: CaptureOptions = {},
): Promise<Snapshot> {
  const viewportWidth = opts.viewportWidth ?? VIEWPORT_WIDTH;
  const captureHeight = opts.captureHeight ?? CAPTURE_HEIGHT;

  const destDir = path.join(os.tmpdir(), `mudlark-extract-${commit.sha}-${state.id}-${process.pid}`);
  await extractTree(repoDir, commit.sha, destDir);
  const served = await serveTree(destDir);

  // Settle protocol step 1: use the page's own prefers-reduced-motion
  // path rather than overriding styles ourselves.
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: viewportWidth, height: captureHeight },
  });
  await setupFontCache(context);
  const page = await context.newPage();

  try {
    return await captureState(page, served.url, commit, state, viewportWidth);
  } finally {
    await context.close();
    await served.close();
    await rm(destDir, { recursive: true, force: true });
  }
}

// Captures every declared state of one commit, reusing one extracted
// tree and one served instance across all of them (checkpoint v1.2
// §4) — extraction is tens of milliseconds on a local repo, so this is
// tidiness, not a performance measure. One context per commit, not per
// state: camera and frame (viewport, reducedMotion) are set once here
// and therefore identical across every state of this commit by
// construction (invariant 8). A fresh page per state, since a state
// script inherits whatever DOM state the previous script left behind.
async function captureCommitStates(
  browser: Browser,
  repoDir: string,
  commit: CommitMeta,
  states: DeclaredState[],
  opts: CaptureOptions = {},
): Promise<Snapshot[]> {
  const viewportWidth = opts.viewportWidth ?? VIEWPORT_WIDTH;
  const captureHeight = opts.captureHeight ?? CAPTURE_HEIGHT;

  const destDir = path.join(os.tmpdir(), `mudlark-extract-${commit.sha}-${process.pid}`);
  await extractTree(repoDir, commit.sha, destDir);
  const served = await serveTree(destDir);

  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: viewportWidth, height: captureHeight },
  });
  await setupFontCache(context);

  try {
    const snapshots: Snapshot[] = [];
    for (const state of states) {
      const page = await context.newPage();
      try {
        snapshots.push(await captureState(page, served.url, commit, state, viewportWidth));
      } finally {
        await page.close();
      }
    }
    return snapshots;
  } finally {
    await context.close();
    await served.close();
    await rm(destDir, { recursive: true, force: true });
  }
}

// Writes to out/snapshots/<stateId>/<sha>.json. Commits drive the outer
// loop, states the inner loop — invariant 1 (the commit set is never
// reduced) governs the outer loop; invariant 9 (state parity) follows
// from every state being captured for every commit here, unconditionally.
export async function captureAll(config: SubjectConfig, outDir: string): Promise<Snapshot[]> {
  const commits = await commitsForPath(config.repo, config.path);
  const browser = await chromium.launch();
  const allSnapshots: Snapshot[] = [];

  try {
    // Sequential, not parallel: capture must not run two commits through
    // the same browser concurrently, and there is no benefit to racing
    // local extractions against each other.
    for (const commit of commits) {
      const snapshots = await captureCommitStates(browser, config.repo, commit, config.states, {
        viewportWidth: VIEWPORT_WIDTH,
        captureHeight: CAPTURE_HEIGHT,
      });
      for (const snapshot of snapshots) {
        const stateDir = path.join(outDir, snapshot.stateId);
        await mkdir(stateDir, { recursive: true });
        await writeFile(path.join(stateDir, `${commit.sha}.json`), JSON.stringify(snapshot, null, 2));
        allSnapshots.push(snapshot);
      }
    }
  } finally {
    await browser.close();
  }

  return allSnapshots;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // MUDLARK_SUBJECT selects which subjects/<name>.json config to use.
  // BUILDBACK_SUBJECT is the pre-rename name, kept as a fallback so an
  // existing shell profile or script keeps working.
  const subjectName = process.env.MUDLARK_SUBJECT ?? process.env.BUILDBACK_SUBJECT ?? 'one-surface';
  const outDir = path.resolve('out/snapshots');
  loadSubjectConfig(subjectName)
    .then((config) => captureAll(config, outDir))
    .then((snapshots) => {
      console.log(`captured ${snapshots.length} snapshots (${new Set(snapshots.map((s) => s.stateId)).size} states) -> ${outDir}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
