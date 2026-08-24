// Grammar verification: the grammar/ files describe the code, so anything
// in them that can be checked against the code mechanically, is.
//
// Two things are checkable. The layer order and per-layer property lists in
// grammar/output.json are duplicated from src/layers/routing.ts, so they can
// drift; this asserts they match element for element and in order. And every
// config in subjects/ must validate against grammar/subject.schema.json — if
// a real config fails, the schema is wrong, not the config.
//
// The prose in the grammar files is not checkable here. It is kept honest by
// reading the source, which is what the authority note in each file says.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';

import { ROUTING, LAYER_ORDER, type LayerName } from '../src/layers/routing';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Check {
  id: string;
  description: string;
  pass: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(id: string, description: string, pass: boolean, detail: string): void {
  checks.push({ id, description, pass, detail });
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Reports the first point of divergence rather than dumping both lists —
// on a 28-property layer that is the difference between a usable failure
// and a wall of text.
function describeDivergence(code: readonly string[], grammar: readonly string[]): string {
  const limit = Math.max(code.length, grammar.length);
  for (let i = 0; i < limit; i++) {
    if (code[i] !== grammar[i]) {
      return `index ${i}: code has ${code[i] === undefined ? '<end>' : `'${code[i]}'`}, grammar has ${
        grammar[i] === undefined ? '<end>' : `'${grammar[i]}'`
      } (code=${code.length} entries, grammar=${grammar.length})`;
    }
  }
  return 'identical';
}

interface OutputGrammar {
  layers: {
    order: string[];
    definitions: Record<string, { properties: string[] }>;
  };
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(PACKAGE_ROOT, relativePath), 'utf8')) as T;
}

async function main(): Promise<void> {
  // --- every grammar file parses -------------------------------------
  const grammarFiles = ['grammar/mudlark.json', 'grammar/output.json', 'grammar/subject.schema.json'];
  const parseFailures: string[] = [];
  for (const file of grammarFiles) {
    try {
      await readJson(file);
    } catch (err) {
      parseFailures.push(`${file}: ${(err as Error).message}`);
    }
  }
  check(
    'G1',
    'Every grammar file is valid JSON',
    parseFailures.length === 0,
    parseFailures.length === 0 ? grammarFiles.join(', ') : parseFailures.join('; '),
  );
  if (parseFailures.length > 0) {
    report();
    return;
  }

  const output = await readJson<OutputGrammar>('grammar/output.json');

  // --- layer order ----------------------------------------------------
  check(
    'G2',
    'grammar/output.json layers.order matches LAYER_ORDER in src/layers/routing.ts',
    sameSequence(LAYER_ORDER, output.layers.order),
    sameSequence(LAYER_ORDER, output.layers.order)
      ? `[${LAYER_ORDER.join(', ')}]`
      : describeDivergence(LAYER_ORDER, output.layers.order),
  );

  // --- every layer is defined -----------------------------------------
  const missing = LAYER_ORDER.filter((layer) => output.layers.definitions[layer] === undefined);
  const extra = Object.keys(output.layers.definitions).filter(
    (name) => !(LAYER_ORDER as readonly string[]).includes(name),
  );
  check(
    'G3',
    'grammar/output.json defines exactly the layers the code declares — no missing, no invented',
    missing.length === 0 && extra.length === 0,
    missing.length === 0 && extra.length === 0
      ? `${LAYER_ORDER.length} layers defined`
      : `missing: [${missing.join(', ')}] extra: [${extra.join(', ')}]`,
  );

  // --- per-layer property lists ---------------------------------------
  // Structure is the deliberate exception: it routes no properties at all,
  // so the code has no ROUTING entry for it and the grammar must say [].
  const propertyFailures: string[] = [];
  for (const layer of LAYER_ORDER) {
    const grammarProps = output.layers.definitions[layer]?.properties ?? [];
    const codeProps: readonly string[] =
      layer === 'structure' ? [] : ROUTING[layer as Exclude<LayerName, 'structure'>];
    if (!sameSequence(codeProps, grammarProps)) {
      propertyFailures.push(`${layer}: ${describeDivergence(codeProps, grammarProps)}`);
    }
  }
  const totalProps = LAYER_ORDER.reduce(
    (sum, layer) => sum + (layer === 'structure' ? 0 : ROUTING[layer as Exclude<LayerName, 'structure'>].length),
    0,
  );
  check(
    'G4',
    'Every per-layer property list in grammar/output.json matches ROUTING exactly, same elements in the same order',
    propertyFailures.length === 0,
    propertyFailures.length === 0
      ? `${totalProps} properties across ${LAYER_ORDER.length} layers`
      : propertyFailures.join(' | '),
  );

  // --- subject configs validate ----------------------------------------
  const schema = await readJson<object>('grammar/subject.schema.json');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  const subjectsDir = path.join(PACKAGE_ROOT, 'subjects');
  const subjectFiles = (await readdir(subjectsDir))
    .filter((name) => name.endsWith('.json'))
    // _quick is the CLI's ephemeral, gitignored config — it may not exist,
    // and it is regenerated on every run, so it is not part of the contract.
    .filter((name) => name !== '_quick.json');

  const invalid: string[] = [];
  for (const file of subjectFiles) {
    const config = JSON.parse(await readFile(path.join(subjectsDir, file), 'utf8')) as unknown;
    if (!validate(config)) {
      const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      invalid.push(`${file}: ${errors}`);
    }
  }
  check(
    'G5',
    'Every config in subjects/ validates against grammar/subject.schema.json',
    subjectFiles.length > 0 && invalid.length === 0,
    subjectFiles.length === 0
      ? 'no subject configs found to validate'
      : invalid.length === 0
        ? `${subjectFiles.length} valid: ${subjectFiles.join(', ')}`
        : invalid.join(' | '),
  );

  report();
}

function report(): void {
  const width = Math.max(...checks.map((c) => c.id.length), 2);
  console.log('');
  console.log(`${'ID'.padEnd(width)}  STATUS  DESCRIPTION`);
  for (const c of checks) {
    console.log(`${c.id.padEnd(width)}  ${c.pass ? 'PASS' : 'FAIL'}    ${c.description}`);
    console.log(`${''.padEnd(width)}  ${c.detail}`);
  }
  const failures = checks.filter((c) => !c.pass);
  console.log('');
  if (failures.length === 0) {
    console.log(`RESULT: all grammar checks (${checks.map((c) => c.id).join(', ')}) pass.`);
  } else {
    console.log(`RESULT: ${failures.length} grammar check(s) FAILED: ${failures.map((c) => c.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
