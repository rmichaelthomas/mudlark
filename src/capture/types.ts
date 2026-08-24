export interface NodeRecord {
  key: string; // assigned in Phase 3 (src/delta/build.ts); empty at capture time
  tag: string; // lowercased
  id: string | null;
  classes: string[];
  ordinal: number; // index among same-tag siblings
  parentPath: string; // DOM path of parent, for tree reconstruction
  text: string; // own text content only, not descendants', trimmed
  // Content layer, media elements only (img/video/audio/source/iframe src,
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
  stateId: string; // the declared state this snapshot was captured under
  viewportWidth: number; // 1280
  docHeight: number;
  nodes: NodeRecord[];
  // sha256 of the concatenated text of every <script> element at this
  // commit. <script> is excluded from the node walk itself, so this is
  // captured alongside it — the file-level Behavior signal
  // src/delta/build.ts compares to produce Delta.behaviorFileChanged
  // (checkpoint §24).
  scriptHash: string;
}

// A node's computed properties split by layer (src/layers/extract.ts).
// content additionally carries `text` and, for media elements, `src` —
// neither is a getComputedStyle property, so neither lives in the
// routing-table-only `computed` bag on NodeRecord.
export interface LayerBag {
  layout: Record<string, string>;
  surface: Record<string, string>;
  content: Record<string, string>;
  behavior: Record<string, string>;
}
