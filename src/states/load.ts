import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_STATE, type DeclaredState, type SubjectConfig } from './types';

// Invariant 7: called once at load. Every downstream consumer receives
// this list and therefore never branches on whether states were
// declared — there is exactly one path, and the single-state case is
// the list of length one.
export function normalizeStates(states: DeclaredState[] | undefined): DeclaredState[] {
  if (!states || states.length === 0) return [DEFAULT_STATE];
  return states;
}

interface RawSubjectConfig {
  name?: string;
  repo?: string;
  path?: string;
  states?: DeclaredState[];
}

// `nameOrPath` is either a bare subject name (resolved to
// subjects/<name>.json) or a path to a config file.
export async function loadSubjectConfig(nameOrPath: string): Promise<SubjectConfig> {
  const configPath = nameOrPath.endsWith('.json') ? path.resolve(nameOrPath) : path.resolve('subjects', `${nameOrPath}.json`);

  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as RawSubjectConfig;

  if (!parsed.name || !parsed.repo || !parsed.path) {
    throw new Error(`subject config ${configPath} is missing a required field (name, repo, or path)`);
  }

  return {
    name: parsed.name,
    repo: parsed.repo,
    path: parsed.path,
    states: normalizeStates(parsed.states),
  };
}
