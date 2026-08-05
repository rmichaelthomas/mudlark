import type { NodeRecord } from '../capture/types';

// A per-parent fingerprint: two nodes with the same signature under the
// same matched parent are almost certainly "the same" element even
// without an id. Not globally unique — a `div` at ordinal 0 with no
// classes can collide with an unrelated `div` at ordinal 0 elsewhere in
// the tree, which is why pass one only trusts a signature match when it
// is unique among siblings on *both* sides (src/identity/match.ts).
export function signature(n: NodeRecord): string {
  return `${n.tag}|${[...n.classes].sort().join('.')}|${n.ordinal}`;
}

// A node's own path, reconstructed the same way walk.ts derives it for
// children (parentPath + tag + ordinal). Unique within a single
// snapshot's flat node list, since `ordinal` is scoped to same-tag
// siblings under the same parent. Used as NodeRecord.key: capture
// leaves `key` empty (checkpoint §4), and this function is the single
// place that derives it — both src/delta/build.ts (labelling Delta
// entries) and player/render.ts (looking up the DOM element it built
// for a given snapshot node) call this same function rather than each
// growing their own notion of node identity.
export function nodeKey(n: NodeRecord): string {
  return `${n.parentPath}/${n.tag}:${n.ordinal}`;
}
