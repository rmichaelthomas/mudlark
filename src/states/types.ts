export interface DeclaredState {
  id: string; // filesystem-safe: [a-z0-9-]+
  label: string; // shown in the player's register control
  script: string | null; // JS evaluated in page context after settle, before walk
}

export interface SubjectConfig {
  name: string;
  repo: string; // absolute path to the subject repo
  path: string; // subject file, e.g. 'index.html'
  states: DeclaredState[];
}

export const DEFAULT_STATE: DeclaredState = { id: 'default', label: 'Default', script: null };
