import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Snapshot } from '../capture/types';
import type { Delta } from './types';
import { matchTrees } from '../identity/match';
import { nodeKey } from '../identity/signature';
import { extractLayers } from '../layers/extract';
import { LAYER_ORDER } from '../layers/routing';
import { commitsForPath } from '../git/log';
import type { SubjectConfig } from '../states/types';
import { loadSubjectConfig } from '../states/load';

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
    stateId: from.stateId,
    inserted: inserted.map(nodeKey),
    removed: removed.map(nodeKey),
    changed,
    lifeFileChanged: from.scriptHash !== to.scriptHash,
    otherStatesChanged: [], // filled in by buildAllDeltas's second pass, if applicable
  };
}

function isEmptyDelta(delta: Delta): boolean {
  return delta.inserted.length === 0 && delta.removed.length === 0 && delta.changed.length === 0;
}

async function buildDeltasForState(repoDir: string, subjectPath: string, stateId: string, snapshotsDir: string): Promise<Delta[]> {
  const commits = await commitsForPath(repoDir, subjectPath);
  const stateSnapshotsDir = path.join(snapshotsDir, stateId);

  const deltas: Delta[] = [];
  // Invariant 1: every adjacent pair, in order, no skipping — the
  // commit set driving this loop is exactly what commitsForPath
  // returned, unfiltered.
  for (let i = 0; i < commits.length - 1; i++) {
    const fromSha = commits[i].sha;
    const toSha = commits[i + 1].sha;
    const from: Snapshot = JSON.parse(await readFile(path.join(stateSnapshotsDir, `${fromSha}.json`), 'utf8'));
    const to: Snapshot = JSON.parse(await readFile(path.join(stateSnapshotsDir, `${toSha}.json`), 'utf8'));
    deltas.push(buildDelta(from, to));
  }
  return deltas;
}

// Builds every declared state's deltas, then annotates cross-state
// visibility, then writes to out/deltas/<stateId>/<from>_<to>.json.
//
// Two passes, not one, and the reason is structural: which OTHER
// states changed over a given commit pair can only be known once every
// state's deltas for that pair exist. A single pass building state A
// cannot yet know what state B's delta over the same pair will look
// like, because state B hasn't been built (checkpoint v1.2 §5).
export async function buildAllDeltas(config: SubjectConfig, snapshotsDir: string, outDir: string): Promise<Record<string, Delta[]>> {
  const commits = await commitsForPath(config.repo, config.path);
  const pairCount = commits.length - 1;

  // Pass 1: every state's own deltas, independent of one another.
  const perState: Record<string, Delta[]> = {};
  for (const state of config.states) {
    perState[state.id] = await buildDeltasForState(config.repo, config.path, state.id, snapshotsDir);
  }

  // Pass 2: annotate. otherStatesChanged is populated only on deltas
  // that are themselves empty (invariant 10) — it exists to explain an
  // otherwise-empty beat, never to editorialize on a real one.
  for (let i = 0; i < pairCount; i++) {
    const nonEmptyStateIds = config.states.filter((state) => !isEmptyDelta(perState[state.id][i])).map((state) => state.id);

    for (const state of config.states) {
      const delta = perState[state.id][i];
      delta.otherStatesChanged = isEmptyDelta(delta) ? nonEmptyStateIds.filter((id) => id !== state.id) : [];
    }
  }

  // Write, now that annotation is complete.
  for (const state of config.states) {
    const stateOutDir = path.join(outDir, state.id);
    await mkdir(stateOutDir, { recursive: true });
    for (let i = 0; i < pairCount; i++) {
      const delta = perState[state.id][i];
      await writeFile(path.join(stateOutDir, `${commits[i].sha}_${commits[i + 1].sha}.json`), JSON.stringify(delta, null, 2));
    }
  }

  return perState;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const subjectName = process.env.BUILDBACK_SUBJECT ?? 'one-surface';
  const snapshotsDir = path.resolve('out/snapshots');
  const outDir = path.resolve('out/deltas');

  loadSubjectConfig(subjectName)
    .then(async (config) => {
      const perState = await buildAllDeltas(config, snapshotsDir, outDir);

      // A small manifest listing every commit and declared state in
      // order, so the player (a static page with no directory-listing
      // capability) knows what to fetch without guessing filenames.
      const commits = await commitsForPath(config.repo, config.path);
      await writeFile(
        path.resolve('out/manifest.json'),
        JSON.stringify({ commits, states: config.states.map((s) => ({ id: s.id, label: s.label })) }, null, 2),
      );

      const total = Object.values(perState).reduce((sum, deltas) => sum + deltas.length, 0);
      console.log(`built ${total} deltas across ${config.states.length} state(s) -> ${outDir}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
