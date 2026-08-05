export interface Delta {
  from: string; // sha
  to: string; // sha
  stateId: string; // the declared state this delta was computed within
  inserted: string[]; // node keys
  removed: string[]; // node keys
  changed: Array<{
    key: string;
    layers: Partial<
      Record<'frame' | 'skin' | 'voice' | 'life', Record<string, [string, string]>>
    >; // property -> [before, after]
  }>;
  lifeFileChanged: boolean; // did the <script> block change between these commits
  // Populated only when this delta's own inserted/removed/changed are
  // all empty (checkpoint v1.2 invariant 10): the ids of every other
  // declared state whose delta over this same commit pair was
  // non-empty. Annotation only — never alters pacing, never suppresses
  // a beat.
  otherStatesChanged: string[];
}
