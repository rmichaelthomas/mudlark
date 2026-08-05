import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { extractTree } from '../git/extract';
import { commitsForPath, type CommitMeta } from '../git/log';
import { ROUTED_PROPERTIES } from '../layers/routing';
import { serveTree } from './serve';
import { settlePage } from './settle';
import { walkPage } from './walk';
import type { Snapshot } from './types';

const VIEWPORT_WIDTH = 1280;
const CAPTURE_HEIGHT = 2000; // tall enough to avoid clipping; the film's frame height is decided in Phase 4

export interface CaptureOptions {
  viewportWidth?: number;
  captureHeight?: number;
}

export async function captureCommit(
  browser: Browser,
  repoDir: string,
  commit: CommitMeta,
  opts: CaptureOptions = {},
): Promise<Snapshot> {
  const viewportWidth = opts.viewportWidth ?? VIEWPORT_WIDTH;
  const captureHeight = opts.captureHeight ?? CAPTURE_HEIGHT;

  const destDir = path.join(os.tmpdir(), `buildback-extract-${commit.sha}-${process.pid}`);
  await extractTree(repoDir, commit.sha, destDir); // extractTree creates destDir
  const served = await serveTree(destDir);

  // Settle protocol step 1: use the page's own prefers-reduced-motion
  // path rather than overriding styles ourselves.
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: viewportWidth, height: captureHeight },
  });
  const page = await context.newPage();

  try {
    await page.goto(served.url, { waitUntil: 'load' });
    await settlePage(page);

    const nodes = await walkPage(page, ROUTED_PROPERTIES);
    const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    return {
      sha: commit.sha,
      date: commit.date,
      author: commit.author,
      message: commit.message,
      viewportWidth,
      docHeight,
      nodes,
    };
  } finally {
    await context.close();
    await served.close();
    await rm(destDir, { recursive: true, force: true });
  }
}

export async function captureAll(repoDir: string, subjectPath: string, outDir: string): Promise<Snapshot[]> {
  const commits = await commitsForPath(repoDir, subjectPath);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const snapshots: Snapshot[] = [];

  try {
    // Sequential, not parallel: capture must not run two commits through
    // the same browser concurrently, and there is no benefit to racing a
    // dozen local extractions against each other.
    for (const commit of commits) {
      const snapshot = await captureCommit(browser, repoDir, commit);
      snapshots.push(snapshot);
      await writeFile(path.join(outDir, `${commit.sha}.json`), JSON.stringify(snapshot, null, 2));
    }
  } finally {
    await browser.close();
  }

  return snapshots;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const repoDir = process.env.BUILDBACK_SUBJECT_REPO ?? '/Users/rmichaelthomas/Websites/one-surface';
  const outDir = path.resolve('out/snapshots');
  captureAll(repoDir, 'index.html', outDir)
    .then((snapshots) => {
      console.log(`captured ${snapshots.length} commits -> ${outDir}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
