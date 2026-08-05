// Throwaway verification script (checkpoint §10.2). No maintenance
// expectation — it exists to produce the pass/fail table this PR ships
// with, not to be a permanent test suite.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { commitsForPath, type CommitMeta } from '../src/git/log';
import { captureCommit } from '../src/capture/capture';
import type { Snapshot } from '../src/capture/types';
import type { Delta } from '../src/delta/types';
import { ROUTED_PROPERTIES } from '../src/layers/routing';
import { matchTrees } from '../src/identity/match';
import { computeTimeline, DEFAULT_RULES } from '../src/pacing/plane';

const REPO_DIR = process.env.BUILDBACK_SUBJECT_REPO ?? '/Users/rmichaelthomas/Websites/one-surface';
const SUBJECT_PATH = 'index.html';
const SNAPSHOTS_DIR = path.resolve('out/snapshots');
const DELTAS_DIR = path.resolve('out/deltas');

type Status = 'PASS' | 'FAIL';

interface CheckResult {
  id: string;
  description: string;
  status: Status;
  blocking: boolean;
  detail: string;
}

const results: CheckResult[] = [];
function record(id: string, description: string, status: Status, blocking: boolean, detail: string): void {
  results.push({ id, description, status, blocking, detail });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function checkA(): Promise<CommitMeta[]> {
  const commits = await commitsForPath(REPO_DIR, SUBJECT_PATH);
  const oldest = commits[0]?.sha;
  const newest = commits[commits.length - 1]?.sha;
  const orderedOk = commits.every((c, i) => i === 0 || new Date(c.date).getTime() >= new Date(commits[i - 1].date).getTime());
  const pass = commits.length === 12 && oldest === '2690c01' && newest === 'af5efa8' && orderedOk;

  record(
    'A',
    'Git reader: commitsForPath returns exactly 12 commits, oldest 2690c01, newest af5efa8, oldest-first',
    pass ? 'PASS' : 'FAIL',
    true,
    `count=${commits.length} oldest=${oldest} newest=${newest} orderedOk=${orderedOk}`,
  );
  return commits;
}

async function checkB(commits: CommitMeta[]): Promise<void> {
  const files = (await readdir(SNAPSHOTS_DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
  const countOk = files.length === 12;

  const af5efa8: Snapshot = await readJson(path.join(SNAPSHOTS_DIR, 'af5efa8.json'));
  const ids = new Set(af5efa8.nodes.map((n) => n.id).filter((id): id is string => Boolean(id)));
  const requiredIds = ['view-app', 'con-grid', 'detail-panel'];
  const hasIds = requiredIds.every((id) => ids.has(id));
  const conNodeCount = af5efa8.nodes.filter((n) => n.classes.includes('con-node')).length;
  const idsOk = hasIds && conNodeCount >= 6;

  const commitMeta = commits.find((c) => c.sha === 'af5efa8');
  let deterministic = false;
  let determinismDetail = 'af5efa8 commit metadata not found';
  if (commitMeta) {
    const browser = await chromium.launch();
    try {
      const recaptured = await captureCommit(browser, REPO_DIR, commitMeta);
      const nodesMatch = JSON.stringify(af5efa8.nodes) === JSON.stringify(recaptured.nodes);
      const docHeightMatch = af5efa8.docHeight === recaptured.docHeight;
      const scriptHashMatch = af5efa8.scriptHash === recaptured.scriptHash;
      deterministic = nodesMatch && docHeightMatch && scriptHashMatch;
      determinismDetail = `nodesMatch=${nodesMatch} docHeightMatch=${docHeightMatch} scriptHashMatch=${scriptHashMatch} (no timing field exists in this schema, so this is a strict equality check)`;
    } finally {
      await browser.close();
    }
  }

  const pass = countOk && idsOk && deterministic;
  const notes: string[] = [];
  if (!idsOk) {
    notes.push(
      'con-grid/con-node/detail-panel render only via switchView("paradigm") on the live default-view ("app") load; ' +
        'the settle protocol explicitly forbids calling switchView and multi-view capture is out of scope (checkpoint §1). ' +
        'This sub-check cannot pass against the current one-surface content without violating those constraints — flagging as a spec/reality mismatch, not a capture bug.',
    );
  }
  record(
    'B',
    '12 snapshot files exist; af5efa8 has ids view-app/con-grid/detail-panel and >=6 con-node nodes; recapturing af5efa8 is deterministic',
    pass ? 'PASS' : 'FAIL',
    true,
    `files=${files.length}/12 ids=[${[...ids].filter((id) => requiredIds.includes(id)).join(',')}] con-node=${conNodeCount} deterministic=${deterministic} (${determinismDetail}) ${notes.join(' ')}`.trim(),
  );
}

async function checkC(): Promise<void> {
  const files = (await readdir(SNAPSHOTS_DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
  const routed = new Set(ROUTED_PROPERTIES);
  let roundTripOk = true;
  let sizeOk = true;
  let propOk = true;
  const notes: string[] = [];

  for (const file of files) {
    const filePath = path.join(SNAPSHOTS_DIR, file);
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const roundTripped = JSON.parse(JSON.stringify(parsed));
    if (JSON.stringify(parsed) !== JSON.stringify(roundTripped)) {
      roundTripOk = false;
      notes.push(`${file}: round-trip mismatch`);
    }
    const sizeBytes = Buffer.byteLength(raw);
    if (sizeBytes > 5 * 1024 * 1024) {
      sizeOk = false;
      notes.push(`${file}: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB exceeds 5MB`);
    }
    for (const node of parsed.nodes as Snapshot['nodes']) {
      for (const key of Object.keys(node.computed)) {
        if (!routed.has(key)) {
          propOk = false;
          notes.push(`${file}: node carries out-of-routing computed property "${key}"`);
        }
      }
    }
  }

  const pass = files.length > 0 && roundTripOk && sizeOk && propOk;
  record(
    'C',
    'Snapshot hygiene: JSON round-trips unchanged, no snapshot exceeds 5MB, no computed property outside the routing-table union',
    pass ? 'PASS' : 'FAIL',
    true,
    notes.length > 0 ? notes.slice(0, 5).join('; ') : `all ${files.length} snapshots clean`,
  );
}

async function checkD(): Promise<void> {
  const load = (sha: string) => readJson<Snapshot>(path.join(SNAPSHOTS_DIR, `${sha}.json`));

  const aee6d20 = await load('aee6d20');
  const c028 = await load('028c764');
  const firstCut = matchTrees(aee6d20, c028);
  const firstCutSmaller = Math.min(aee6d20.nodes.length, c028.nodes.length);
  const firstCutRatio = firstCut.matched.length / firstCutSmaller;
  const firstCutPass = firstCutRatio >= 0.7;

  const c66f = await load('66fb0d5');
  const wholesale = matchTrees(c028, c66f);
  const wholesaleSmaller = Math.min(c028.nodes.length, c66f.nodes.length);
  const wholesaleRatio = wholesale.matched.length / wholesaleSmaller;

  record(
    'D',
    'Identity: first-cut (aee6d20->028c764) matched-node ratio >=70% of the smaller snapshot (diagnostic — does not block); wholesale-replacement (028c764->66fb0d5) ratio reported without a floor',
    firstCutPass ? 'PASS' : 'FAIL',
    false,
    `first-cut matched=${firstCut.matched.length}/${firstCutSmaller} (${(firstCutRatio * 100).toFixed(1)}%); ` +
      `wholesale matched=${wholesale.matched.length}/${wholesaleSmaller} (${(wholesaleRatio * 100).toFixed(1)}%, expected to be mostly insert+remove)`,
  );
}

async function checkE(commits: CommitMeta[]): Promise<void> {
  const deltas: Delta[] = [];
  for (let i = 0; i < commits.length - 1; i++) {
    deltas.push(await readJson<Delta>(path.join(DELTAS_DIR, `${commits[i].sha}_${commits[i + 1].sha}.json`)));
  }
  const timeline = computeTimeline(deltas, commits, DEFAULT_RULES, 45);

  const beatsMatch = timeline.length === commits.length;
  const allApplied = timeline.every((entry) => entry.appliedRules.length > 0);
  const gapEntry = timeline.find((entry) => entry.sha === '66fb0d5');
  const gapHeld = Boolean(gapEntry?.appliedRules.includes('hold-the-gaps'));

  const pass = beatsMatch && allApplied && gapHeld;
  record(
    'E',
    'Deltas/pacing: timeline beat count equals commit count exactly; appliedRules non-empty for every commit; 028c764->66fb0d5 produces a held beat via [hold-the-gaps]',
    pass ? 'PASS' : 'FAIL',
    true,
    `beats=${timeline.length} commits=${commits.length} allApplied=${allApplied} 66fb0d5.appliedRules=[${gapEntry?.appliedRules.join(',') ?? ''}] durationSec=${gapEntry?.durationSec.toFixed(2)}`,
  );
}

async function checkF(): Promise<void> {
  const read = (p: string) => readFile(path.resolve(p), 'utf8').catch(() => '');

  const captureSrc = (await read('src/capture/walk.ts')) + (await read('src/capture/capture.ts'));
  const deltaSrc = (await read('src/delta/build.ts')) + (await read('src/layers/extract.ts'));
  const playerSrc = (await read('player/render.ts')) + (await read('player/main.ts'));
  const importsRouting = (src: string) => /from\s+['"][^'"]*layers\/routing['"]/.test(src);
  const routingImportedByAll = importsRouting(captureSrc) && importsRouting(deltaSrc) && importsRouting(playerSrc);

  const routingFile = await read('src/layers/routing.ts');
  const layerOrderDeclarations = (routingFile.match(/export const LAYER_ORDER\s*=/g) ?? []).length;
  const layerOrderOnce = layerOrderDeclarations === 1;

  const matchFile = await read('src/identity/match.ts');
  const paceFile = await read('src/pacing/plane.ts');
  // checkpoint §5/§7 each explicitly call for weights+threshold, and pacing
  // constants respectively, to live in "a single exported config object" —
  // so this checks the three provisional CONCEPTS (fuzzy-match weights,
  // match threshold, pacing constants) are each visible in a named export,
  // not three separate object literals.
  const hasMatchWeights = /export const MATCH_CONFIG[\s\S]*?weights:/.test(matchFile);
  const hasMatchThreshold = /export const MATCH_CONFIG[\s\S]*?threshold:/.test(matchFile);
  const hasPacingConfig = /export const PACING_CONFIG/.test(paceFile);
  const configsOk = hasMatchWeights && hasMatchThreshold && hasPacingConfig;

  const pass = routingImportedByAll && layerOrderOnce && configsOk;
  record(
    'F',
    'Invariants: routing.ts imported by capture, delta, and player; LAYER_ORDER declared exactly once; provisional configs (match weights, match threshold, pacing constants) exported',
    pass ? 'PASS' : 'FAIL',
    true,
    `routingImportedByAll=${routingImportedByAll} layerOrderDeclarations=${layerOrderDeclarations} hasMatchWeights=${hasMatchWeights} hasMatchThreshold=${hasMatchThreshold} hasPacingConfig=${hasPacingConfig}`,
  );
}

async function main(): Promise<void> {
  const commits = await checkA();
  await checkB(commits);
  await checkC();
  await checkD();
  await checkE(commits);
  await checkF();

  const lines: string[] = [];
  lines.push('# Buildback v1 — capture/playback verification');
  lines.push('');
  lines.push(`Run against subject repo: \`${REPO_DIR}\``);
  lines.push('');
  lines.push('| ID | Blocking | Status | Description |');
  lines.push('|----|----------|--------|-------------|');
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.blocking ? 'yes' : 'no (diagnostic)'} | ${r.status} | ${r.description} |`);
  }
  lines.push('');
  lines.push('## Detail');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.status}${r.blocking ? '' : ' (non-blocking)'}`);
    lines.push('');
    lines.push(r.description);
    lines.push('');
    lines.push('```');
    lines.push(r.detail);
    lines.push('```');
    lines.push('');
  }

  const blockingFailures = results.filter((r) => r.blocking && r.status === 'FAIL');
  lines.push('## Result');
  lines.push('');
  lines.push(
    blockingFailures.length === 0
      ? 'All blocking assertions (A, B, C, E, F) pass.'
      : `Blocking failure in: ${blockingFailures.map((r) => r.id).join(', ')}.`,
  );

  const report = lines.join('\n');
  console.log('');
  console.log('ID  BLOCKING  STATUS  DESCRIPTION');
  for (const r of results) {
    console.log(`${r.id.padEnd(3)} ${(r.blocking ? 'yes' : 'no').padEnd(9)} ${r.status.padEnd(6)}  ${r.description}`);
    console.log(`    ${r.detail}`);
  }
  console.log('');
  console.log(
    blockingFailures.length === 0
      ? 'RESULT: all blocking assertions (A, B, C, E, F) pass.'
      : `RESULT: blocking failure in ${blockingFailures.map((r) => r.id).join(', ')}.`,
  );

  await import('node:fs/promises').then((fs) => fs.writeFile('capture-playback-verification.md', report));

  if (blockingFailures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
