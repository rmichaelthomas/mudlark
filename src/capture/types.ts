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
}
