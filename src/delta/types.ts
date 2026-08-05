export interface Delta {
  from: string; // sha
  to: string; // sha
  inserted: string[]; // node keys
  removed: string[]; // node keys
  changed: Array<{
    key: string;
    layers: Partial<
      Record<'frame' | 'skin' | 'voice' | 'life', Record<string, [string, string]>>
    >; // property -> [before, after]
  }>;
  lifeFileChanged: boolean; // did the <script> block change between these commits
}
