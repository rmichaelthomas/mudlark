export interface NodeRecord {
  key: string; // assigned in Phase 3 (src/delta/build.ts); empty at capture time
  tag: string; // lowercased
  id: string | null;
  classes: string[];
  ordinal: number; // index among same-tag siblings
  parentPath: string; // DOM path of parent, for tree reconstruction
  text: string; // own text content only, not descendants', trimmed
  // Voice layer, media elements only (img/video/audio/source/iframe src,
  // a/link href), resolved to an absolute URL. Not a getComputedStyle
  // property, so it lives outside `computed` rather than inside it —
  // otherwise it would trip the routing-table hygiene check.
  src: string | null;
  geometry: { x: number; y: number; w: number; h: number };
  computed: Record<string, string>; // only the properties named in the routing table
}

export interface Snapshot {
  sha: string;
  date: string;
  author: string;
  message: string;
  viewportWidth: number; // 1280
  docHeight: number;
  nodes: NodeRecord[];
  // sha256 of the concatenated text of every <script> element at this
  // commit. <script> is excluded from the node walk itself, so this is
  // captured alongside it — the file-level Life signal src/delta/build.ts
  // compares to produce Delta.lifeFileChanged (checkpoint §24).
  scriptHash: string;
}

// A node's computed properties split by layer (src/layers/extract.ts).
// voice additionally carries `text` and, for media elements, `src` —
// neither is a getComputedStyle property, so neither lives in the
// routing-table-only `computed` bag on NodeRecord.
export interface LayerBag {
  frame: Record<string, string>;
  skin: Record<string, string>;
  voice: Record<string, string>;
  life: Record<string, string>;
}
