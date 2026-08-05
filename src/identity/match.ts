import type { NodeRecord } from '../capture/types';
import type { Snapshot } from '../capture/types';
import { signature, nodeKey } from './signature';

export interface MatchResult {
  matched: Array<[NodeRecord, NodeRecord]>; // [from, to]
  inserted: NodeRecord[]; // present only in `to`
  removed: NodeRecord[]; // present only in `from`
}

// Provisional, tuned against the first cut (aee6d20 -> 028c764) by Rob —
// not chosen here. Class-set overlap carries the most weight because
// the subject's redesign leans on descriptive class names; text
// similarity is a solid tiebreaker for leaf/text-bearing nodes; index
// proximity is the weakest signal, used only to break remaining ties.
export const MATCH_CONFIG = {
  weights: {
    classJaccard: 0.5,
    textSimilarity: 0.3,
    indexProximity: 0.2,
  },
  threshold: 0.45,
};

interface SnapshotIndex {
  childrenByParentPath: Map<string, NodeRecord[]>;
  root: NodeRecord | undefined;
}

function buildIndex(snapshot: Snapshot): SnapshotIndex {
  const childrenByParentPath = new Map<string, NodeRecord[]>();
  for (const node of snapshot.nodes) {
    const list = childrenByParentPath.get(node.parentPath) ?? [];
    list.push(node);
    childrenByParentPath.set(node.parentPath, list);
  }
  return {
    childrenByParentPath,
    root: snapshot.nodes.find((node) => node.parentPath === ''),
  };
}

function countBySignature(nodes: NodeRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const sig = signature(node);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  return counts;
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function textSimilarity(a: string, b: string): number {
  if (a === '' && b === '') return 1;
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

function pairScore(from: NodeRecord, to: NodeRecord, fromIndex: number, toIndex: number, siblingSpan: number): number {
  if (from.tag !== to.tag) return 0; // hard requirement
  const { weights } = MATCH_CONFIG;
  const classScore = jaccard(from.classes, to.classes);
  const textScore = textSimilarity(from.text, to.text);
  const indexScore = siblingSpan <= 1 ? 1 : 1 - Math.abs(fromIndex - toIndex) / siblingSpan;
  return classScore * weights.classJaccard + textScore * weights.textSimilarity + indexScore * weights.indexProximity;
}

// Two-pass matcher (checkpoint §21). Pass one matches by id, then by a
// per-parent-unique signature. Pass two scores what's left and takes
// the best pairings greedily above MATCH_CONFIG.threshold; below
// threshold, both sides are a genuine insert/delete. Recurses into
// every newly matched parent pair via a work queue (not direct
// recursion) so each parent pair is only ever processed once.
export function matchTrees(from: Snapshot, to: Snapshot): MatchResult {
  const fromIdx = buildIndex(from);
  const toIdx = buildIndex(to);

  const matched: Array<[NodeRecord, NodeRecord]> = [];
  const matchedFrom = new Set<NodeRecord>();
  const matchedTo = new Set<NodeRecord>();

  const queue: Array<[string, string]> = [];

  if (fromIdx.root && toIdx.root) {
    matched.push([fromIdx.root, toIdx.root]);
    matchedFrom.add(fromIdx.root);
    matchedTo.add(toIdx.root);
    queue.push([nodeKey(fromIdx.root), nodeKey(toIdx.root)]);
  }

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const [fromParentPath, toParentPath] = next;

    const fromChildren = fromIdx.childrenByParentPath.get(fromParentPath) ?? [];
    const toChildren = toIdx.childrenByParentPath.get(toParentPath) ?? [];

    const localMatchedFrom = new Set<NodeRecord>();
    const localMatchedTo = new Set<NodeRecord>();

    const pairUp = (f: NodeRecord, t: NodeRecord) => {
      matched.push([f, t]);
      matchedFrom.add(f);
      matchedTo.add(t);
      localMatchedFrom.add(f);
      localMatchedTo.add(t);
      queue.push([nodeKey(f), nodeKey(t)]);
    };

    // Pass one, part A: id match.
    for (const f of fromChildren) {
      if (!f.id) continue;
      const t = toChildren.find((c) => c.id === f.id && !localMatchedTo.has(c));
      if (t) pairUp(f, t);
    }

    // Pass one, part B: signature unique among remaining siblings on both sides.
    const remFrom1 = fromChildren.filter((c) => !localMatchedFrom.has(c));
    const remTo1 = toChildren.filter((c) => !localMatchedTo.has(c));
    const fromSigCounts = countBySignature(remFrom1);
    const toSigCounts = countBySignature(remTo1);
    for (const f of remFrom1) {
      const sig = signature(f);
      if (fromSigCounts.get(sig) !== 1 || toSigCounts.get(sig) !== 1) continue;
      const t = remTo1.find((c) => !localMatchedTo.has(c) && signature(c) === sig);
      if (t) pairUp(f, t);
    }

    // Pass two: scored greedy matching among what's left.
    const remFrom2 = fromChildren.filter((c) => !localMatchedFrom.has(c));
    const remTo2 = toChildren.filter((c) => !localMatchedTo.has(c));
    const siblingSpan = Math.max(remFrom2.length, remTo2.length);

    const candidates: Array<{ f: NodeRecord; t: NodeRecord; s: number }> = [];
    remFrom2.forEach((f, fi) => {
      remTo2.forEach((t, ti) => {
        const s = pairScore(f, t, fi, ti, siblingSpan);
        if (s > 0) candidates.push({ f, t, s });
      });
    });
    candidates.sort((a, b) => b.s - a.s);

    for (const candidate of candidates) {
      if (localMatchedFrom.has(candidate.f) || localMatchedTo.has(candidate.t)) continue;
      if (candidate.s < MATCH_CONFIG.threshold) continue;
      pairUp(candidate.f, candidate.t);
    }
  }

  return {
    matched,
    inserted: to.nodes.filter((n) => !matchedTo.has(n)),
    removed: from.nodes.filter((n) => !matchedFrom.has(n)),
  };
}
