import type { Delta } from '../delta/types';
import type { CommitMeta } from '../git/log';

export interface PacingRule {
  name: string; // e.g. 'weight-by-change'
  weight(delta: Delta, meta: CommitMeta, prev: CommitMeta | null): number | null;
  // returns a screen-time weight, or null if this rule does not apply
}

// Provisional — tuned against the full twelve-commit film by Rob, not
// chosen here. weight-by-change and dwell-on-structure compose into a
// base weight (proportional allocation); hold-the-gaps and
// floor-the-noise then clamp the resulting per-commit duration (a
// floor and a cap, respectively — see computeTimeline).
export const PACING_CONFIG = {
  gapThresholdDays: 14, // hold-the-gaps: wall-clock gaps longer than this get a held beat
  gapHoldSeconds: 3, // hold-the-gaps: minimum seconds for a qualifying gap
  noiseChangeThreshold: 5, // floor-the-noise: "small" means fewer changed properties than this
  noiseMaxSeconds: 1.5, // floor-the-noise: duration cap for small commits
  dwellMultiplier: 1.8, // dwell-on-structure: multiplier when a delta touches Bones or Frame
  // weight-by-change: an inserted/removed node is a whole element (Bones
  // through Life), not one property — it's weighted as roughly this many
  // single-property changes so a wholesale replacement isn't outweighed
  // by a broad but shallow property-only pass across many nodes.
  nodeEventWeight: 5,
};

function deltaSize(delta: Delta): number {
  const changedProps = delta.changed.reduce(
    (sum, c) => sum + Object.values(c.layers).reduce((s, bag) => s + Object.keys(bag ?? {}).length, 0),
    0,
  );
  const structuralEvents = (delta.inserted.length + delta.removed.length) * PACING_CONFIG.nodeEventWeight;
  return changedProps + structuralEvents;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.abs(new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24);
}

// [weight-by-change] Default rule: weight proportional to delta size.
export const weightByChange: PacingRule = {
  name: 'weight-by-change',
  weight(delta) {
    return 1 + deltaSize(delta);
  },
};

// [hold-the-gaps] Any wall-clock interval longer than the threshold gets
// a fixed minimum beat, regardless of delta size, so silence stays legible.
export const holdTheGaps: PacingRule = {
  name: 'hold-the-gaps',
  weight(_delta, meta, prev) {
    if (!prev) return null;
    if (daysBetween(prev.date, meta.date) <= PACING_CONFIG.gapThresholdDays) return null;
    return PACING_CONFIG.gapHoldSeconds;
  },
};

// [floor-the-noise] No commit's duration exceeds a cap when its delta is
// under the noise threshold.
export const floorTheNoise: PacingRule = {
  name: 'floor-the-noise',
  weight(delta) {
    if (deltaSize(delta) >= PACING_CONFIG.noiseChangeThreshold) return null;
    return PACING_CONFIG.noiseMaxSeconds;
  },
};

// [dwell-on-structure] Commits whose delta touches Bones (inserts/removes)
// or Frame get a multiplier on the base weight.
export const dwellOnStructure: PacingRule = {
  name: 'dwell-on-structure',
  weight(delta) {
    const touchesStructure =
      delta.inserted.length > 0 || delta.removed.length > 0 || delta.changed.some((c) => Boolean(c.layers.frame));
    return touchesStructure ? PACING_CONFIG.dwellMultiplier : null;
  },
};

export const DEFAULT_RULES: PacingRule[] = [weightByChange, holdTheGaps, floorTheNoise, dwellOnStructure];

// Minimal v1.2 compatibility fix: Delta gained required `stateId` and
// `otherStatesChanged` fields (checkpoint v1.2 §5). This file is
// otherwise read-only for that build — the genesis sentinel below just
// needs to satisfy the new shape, not participate in the state
// mechanism, so it borrows the state id of whatever it's standing in for.
function emptyDelta(toSha: string, stateId: string): Delta {
  return { from: '', to: toSha, stateId, inserted: [], removed: [], changed: [], lifeFileChanged: false, otherStatesChanged: [] };
}

export interface TimelineEntry {
  sha: string;
  startSec: number;
  durationSec: number;
  appliedRules: string[];
}

// Invariant 1: the commit set is never reduced. `metas` drives this loop
// directly and every commit gets exactly one timeline entry — pacing
// changes duration only, never which commits appear.
export function computeTimeline(
  deltas: Delta[],
  metas: CommitMeta[],
  rules: PacingRule[],
  totalSeconds: number,
): TimelineEntry[] {
  const genesisStateId = deltas[0]?.stateId ?? 'default';
  const perCommit = metas.map((meta, i) => {
    const prev = i > 0 ? metas[i - 1] : null;
    const delta = i > 0 ? deltas[i - 1] : emptyDelta(meta.sha, genesisStateId);

    let baseWeight = 0;
    let multiplier = 1;
    let holdSeconds: number | null = null;
    let capSeconds: number | null = null;
    const applied: string[] = [];

    for (const rule of rules) {
      const value = rule.weight(delta, meta, prev);
      if (value === null) continue;
      applied.push(rule.name);

      switch (rule.name) {
        case 'weight-by-change':
          baseWeight += value;
          break;
        case 'dwell-on-structure':
          multiplier *= value;
          break;
        case 'hold-the-gaps':
          holdSeconds = holdSeconds === null ? value : Math.max(holdSeconds, value);
          break;
        case 'floor-the-noise':
          capSeconds = capSeconds === null ? value : Math.min(capSeconds, value);
          break;
        default:
          // An unrecognized custom rule composes additively, so a
          // third-party rule stays usable without computeTimeline
          // knowing its name.
          baseWeight += value;
      }
    }

    return { meta, weight: Math.max(baseWeight, 0.0001) * multiplier, holdSeconds, capSeconds, applied };
  });

  const totalWeight = perCommit.reduce((sum, c) => sum + c.weight, 0);

  const durations = perCommit.map((c) => {
    let duration = totalWeight > 0 ? (c.weight / totalWeight) * totalSeconds : totalSeconds / perCommit.length;
    // Cap first, then floor: a qualifying gap must win over the noise
    // cap, not be swallowed by it.
    if (c.capSeconds !== null) duration = Math.min(duration, c.capSeconds);
    if (c.holdSeconds !== null) duration = Math.max(duration, c.holdSeconds);
    return Math.max(duration, 0.05); // never a literal zero-duration beat
  });

  const timeline: TimelineEntry[] = [];
  let cursor = 0;
  for (let i = 0; i < perCommit.length; i++) {
    timeline.push({ sha: perCommit[i].meta.sha, startSec: cursor, durationSec: durations[i], appliedRules: perCommit[i].applied });
    cursor += durations[i];
  }
  return timeline;
}
