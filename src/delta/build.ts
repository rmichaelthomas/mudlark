import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Snapshot } from '../capture/types';
import type { Delta } from './types';
import { matchTrees } from '../identity/match';
import { nodeKey } from '../identity/signature';
import { extractLayers } from '../layers/extract';
import { LAYER_ORDER } from '../layers/routing';
import { commitsForPath } from '../git/log';

type ChangeLayer = 'frame' | 'skin' | 'voice' | 'life';
const CHANGE_LAYERS = LAYER_ORDER.filter((layer): layer is ChangeLayer => layer !== 'bones');

export function buildDelta(from: Snapshot, to: Snapshot): Delta {
  const { matched, inserted, removed } = matchTrees(from, to);

  const changed: Delta['changed'] = [];
  for (const [f, t] of matched) {
    const fLayers = extractLayers(f);
    const tLayers = extractLayers(t);
    const layers: Delta['changed'][number]['layers'] = {};

    for (const layerName of CHANGE_LAYERS) {
      const fBag = fLayers[layerName];
      const tBag = tLayers[layerName];
      const propDiffs: Record<string, [string, string]> = {};
      const allProps = new Set([...Object.keys(fBag), ...Object.keys(tBag)]);
      for (const prop of allProps) {
        const before = fBag[prop] ?? '';
        const after = tBag[prop] ?? '';
        if (before !== after) propDiffs[prop] = [before, after];
      }
      if (Object.keys(propDiffs).length > 0) {
        layers[layerName] = propDiffs;
      }
    }

    if (Object.keys(layers).length > 0) {
      changed.push({ key: nodeKey(t), layers });
    }
  }

  return {
    from: from.sha,
    to: to.sha,
    inserted: inserted.map(nodeKey),
    removed: removed.map(nodeKey),
    changed,
    lifeFileChanged: from.scriptHash !== to.scriptHash,
  };
}

export async function buildAllDeltas(repoDir: string, subjectPath: string, snapshotsDir: string, outDir: string): Promise<Delta[]> {
  const commits = await commitsForPath(repoDir, subjectPath);
  await mkdir(outDir, { recursive: true });

  const deltas: Delta[] = [];
  // Invariant 1: every adjacent pair, in order, no skipping — the
  // commit set driving this loop is exactly what commitsForPath
  // returned, unfiltered.
  for (let i = 0; i < commits.length - 1; i++) {
    const fromSha = commits[i].sha;
    const toSha = commits[i + 1].sha;
    const from: Snapshot = JSON.parse(await readFile(path.join(snapshotsDir, `${fromSha}.json`), 'utf8'));
    const to: Snapshot = JSON.parse(await readFile(path.join(snapshotsDir, `${toSha}.json`), 'utf8'));

    const delta = buildDelta(from, to);
    deltas.push(delta);
    await writeFile(path.join(outDir, `${fromSha}_${toSha}.json`), JSON.stringify(delta, null, 2));
  }

  return deltas;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const repoDir = process.env.BUILDBACK_SUBJECT_REPO ?? '/Users/rmichaelthomas/Websites/one-surface';
  const snapshotsDir = path.resolve('out/snapshots');
  const outDir = path.resolve('out/deltas');
  buildAllDeltas(repoDir, 'index.html', snapshotsDir, outDir)
    .then(async (deltas) => {
      // A small manifest listing every commit in order, so the player
      // (a static page with no directory-listing capability) knows what
      // to fetch from /snapshots and /deltas without guessing filenames.
      const commits = await commitsForPath(repoDir, 'index.html');
      await writeFile(path.resolve('out/manifest.json'), JSON.stringify({ commits }, null, 2));
      console.log(`built ${deltas.length} deltas -> ${outDir}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
