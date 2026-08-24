// Records the player playing one full film and writes assets/demo.gif.
//
// Reads out/ the way the player does — it does NOT run the capture
// pipeline. Run `npm run mudlark -- <file>` (or capture + delta) first.
//
// Two deliberate choices about what the demo shows:
//   Zoom is fit-width. Fit frames the whole artifact, which is the right
//   default for watching but the wrong one for a thumbnail: the
//   reference subject is 1280x4037, so fitting it whole into a recording
//   pane leaves a ~145px ribbon adrift in a 960px frame and you cannot
//   read what changed. Width-fit trades the bottom of the page for
//   content you can actually see accrete.
//   Speed is 4x. The reference film is 45s at 1x, which makes a GIF far
//   too large for a README and too slow to hold anyone's attention.
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets');
const MANIFEST = path.join(PACKAGE_ROOT, 'out/manifest.json');
const DEV_URL_PATTERN = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/;

const RECORD_WIDTH = 1280;
const RECORD_HEIGHT = 900;
const PLAYBACK_SPEED = '4';
const ZOOM_MODE = 'fit-width';
const MAX_FILM_WAIT_MS = 60_000;

// GIF encoding. Two passes so the palette is generated from the actual
// frames rather than a generic web palette — a dark, low-contrast film
// bands badly otherwise.
const GIF_FPS = 12;
const GIF_WIDTH = 960;
const GIF_COLORS = 128;
const SIZE_BUDGET_BYTES = 10 * 1024 * 1024; // GitHub renders README images up to ~10MB

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function die(message: string): never {
  console.error(`record-demo: ${message}`);
  process.exit(1);
}

// A system ffmpeg is preferred when present; ffmpeg-static is the
// fallback so a fresh clone can record a demo without a system install.
function resolveFfmpeg(): string | null {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    // not on PATH — fall through
  }
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null;
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // ffmpeg-static not installed
  }
  return null;
}

function startDevServer(): Promise<{ url: string; child: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite'], { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('dev server did not report a URL within 60s'));
    }, 60_000);

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

function gifFilter(fps: number, width: number, colors: number): string {
  return (
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`
  );
}

function encodeGif(ffmpeg: string, input: string, output: string, fps: number, width: number, colors: number): void {
  execFileSync(ffmpeg, ['-y', '-i', input, '-vf', gifFilter(fps, width, colors), '-loop', '0', output], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

async function recordFilm(url: string, videoDir: string): Promise<string> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      recordVideo: { dir: videoDir, size: { width: RECORD_WIDTH, height: RECORD_HEIGHT } },
      viewport: { width: RECORD_WIDTH, height: RECORD_HEIGHT },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#timeline', { timeout: 20_000 });
    await page.waitForFunction(() => (document.querySelectorAll('#stage > div').length > 0), null, { timeout: 20_000 });

    await page.selectOption('#zoom', ZOOM_MODE);
    await page.selectOption('#speed', PLAYBACK_SPEED);
    await sleep(700); // let the re-frame settle before the first recorded frame

    await page.click('#play');
    // Off the transport, so no hover tooltip sits over the timeline for
    // the whole recording.
    await page.mouse.move(RECORD_WIDTH / 2, RECORD_HEIGHT / 2);

    const total = await page.$eval('#timeline', (el) => Number(el.getAttribute('aria-valuemax')));
    const deadline = Date.now() + MAX_FILM_WAIT_MS;
    while (Date.now() < deadline) {
      const now = await page.$eval('#timeline', (el) => Number(el.getAttribute('aria-valuenow')));
      if (now >= total - 0.05) break;
      await sleep(100);
    }
    // Stop on the final frame rather than through the loop's beat, so the
    // GIF's own loop cuts straight from last commit back to first.
    await sleep(250);

    const video = page.video();
    if (!video) throw new Error('playwright recorded no video');
    await page.close();
    await context.close(); // the video file is only finalized on context close
    return await video.path();
  } finally {
    if (browser) await browser.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(MANIFEST)) {
    die('Run `npm run mudlark` first to generate capture data');
  }

  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    die(
      'no ffmpeg available. Install one with `npm install --save-dev ffmpeg-static`, or a system ffmpeg (`brew install ffmpeg`).',
    );
  }

  await mkdir(ASSETS_DIR, { recursive: true });
  const videoDir = path.join(os.tmpdir(), `mudlark-demo-${process.pid}`);
  await mkdir(videoDir, { recursive: true });

  const { url, child } = await startDevServer();
  let webm: string;
  try {
    console.log('record-demo: recording one full film...');
    webm = await recordFilm(url, videoDir);
  } finally {
    child.kill();
  }

  const gifPath = path.join(ASSETS_DIR, 'demo.gif');
  console.log('record-demo: encoding gif...');
  encodeGif(ffmpeg, webm, gifPath, GIF_FPS, GIF_WIDTH, GIF_COLORS);

  // Step down quality only as far as the budget actually requires, so a
  // film that fits comfortably keeps its full frame rate and size.
  const fallbacks: Array<[number, number, number]> = [
    [10, 900, 96],
    [8, 800, 64],
    [8, 720, 64],
    [6, 640, 48],
  ];
  for (const [fps, width, colors] of fallbacks) {
    const { size } = await stat(gifPath);
    if (size <= SIZE_BUDGET_BYTES) break;
    console.log(
      `record-demo: ${(size / 1024 / 1024).toFixed(1)}MB exceeds budget, re-encoding at ${fps}fps ${width}px ${colors} colors...`,
    );
    encodeGif(ffmpeg, webm, gifPath, fps, width, colors);
  }

  const { size } = await stat(gifPath);
  // Keep the source recording next to the gif when it fits; it is a much
  // better artifact than the gif for anything but a README.
  const webmPath = path.join(ASSETS_DIR, 'demo.webm');
  await copyFile(webm, webmPath);
  const { size: webmSize } = await stat(webmPath);

  await rm(videoDir, { recursive: true, force: true });

  console.log(`record-demo: assets/demo.gif  ${(size / 1024 / 1024).toFixed(2)}MB`);
  console.log(`record-demo: assets/demo.webm ${(webmSize / 1024 / 1024).toFixed(2)}MB`);
  if (size > SIZE_BUDGET_BYTES) {
    console.error(`record-demo: WARNING gif is over the ${SIZE_BUDGET_BYTES / 1024 / 1024}MB budget`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
