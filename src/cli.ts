#!/usr/bin/env -S npx tsx
// The zero-config path: one HTML file in, one running player out.
//
// It adds no pipeline logic of its own — it derives a subject config
// from the file path and then calls the same captureAll / buildAllDeltas
// / writeManifest that `npm run capture` and `npm run delta` call. The
// declared-states workflow (MUDLARK_SUBJECT + a hand-written config in
// subjects/) stays the path for anything with more than one register.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureAll } from './capture/capture';
import { buildAllDeltas, writeManifest } from './delta/build';
import { commitsForPath } from './git/log';
import { loadSubjectConfig } from './states/load';

// Everything this writes lives next to the mudlark checkout, not next to
// wherever the user happened to be standing — so `npx mudlark` from an
// arbitrary directory puts snapshots in the same place `npm run capture`
// would have.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUICK_SUBJECT = path.join(PACKAGE_ROOT, 'subjects', '_quick.json');
const DEV_URL_PATTERN = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?)/;

const USAGE = 'usage: mudlark <path-to-html-file>';

function die(message: string): never {
  console.error(`mudlark: ${message}`);
  process.exit(1);
}

// Walks up from the file until a .git entry appears. .git is a directory
// in a normal clone and a file in a worktree or submodule, so this tests
// for existence rather than for a directory.
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Vite prints its own banner; we want one line, and we want it to name
// the port Vite actually bound rather than the one we asked for.
function startDevServer(): void {
  const vite = spawn('npx', ['vite'], {
    cwd: PACKAGE_ROOT,
    stdio: ['inherit', 'pipe', 'inherit'],
    env: process.env,
  });

  let announced = false;
  vite.stdout.setEncoding('utf8');
  vite.stdout.on('data', (chunk: string) => {
    if (announced) {
      process.stdout.write(chunk);
      return;
    }
    const match = chunk.match(DEV_URL_PATTERN);
    if (match) {
      announced = true;
      console.log(`mudlark: ready at ${match[1]}`);
    }
  });

  const forward = (signal: NodeJS.Signals) => process.on(signal, () => vite.kill(signal));
  forward('SIGINT');
  forward('SIGTERM');

  vite.on('exit', (code) => process.exit(code ?? 0));
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || arg === '-h' || arg === '--help') {
    console.error(USAGE);
    process.exit(1);
  }

  const filePath = path.resolve(arg);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    die(`${arg}: file not found`);
  }

  const repoRoot = findRepoRoot(path.dirname(filePath));
  if (!repoRoot) die('not inside a git repository');

  const relativePath = path.relative(repoRoot, filePath);

  const commits = await commitsForPath(repoRoot, relativePath);
  if (commits.length === 0) die(`no commits touch ${relativePath} in ${repoRoot}`);

  // _quick is always the ephemeral one-shot config — overwritten, never
  // merged, and gitignored so it can't be mistaken for a real subject.
  await mkdir(path.dirname(QUICK_SUBJECT), { recursive: true });
  await writeFile(
    QUICK_SUBJECT,
    `${JSON.stringify({ name: '_quick', repo: repoRoot, path: relativePath, states: [] }, null, 2)}\n`,
  );

  const config = await loadSubjectConfig(QUICK_SUBJECT);

  console.log(`mudlark: capturing ${arg} (${commits.length} commits)...`);
  await captureAll(config, path.join(PACKAGE_ROOT, 'out/snapshots'));

  console.log('mudlark: building deltas...');
  await buildAllDeltas(config, path.join(PACKAGE_ROOT, 'out/snapshots'), path.join(PACKAGE_ROOT, 'out/deltas'));
  await writeManifest(config, path.join(PACKAGE_ROOT, 'out/manifest.json'));

  startDevServer();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
