# grammar/

Machine-readable descriptions of Mudlark — its input format, output data, and
project structure. Named after the convention in the
[Planes](https://github.com/rmichaelthomas/planes) language repo, where
`grammar/` holds the vocabulary and rules files that both agents and the
codebase consume.

| File | What it describes |
|---|---|
| `mudlark.json` | The project itself — commands, scope, prerequisites |
| `subject.schema.json` | The subject config format (JSON Schema draft 2020-12) |
| `output.json` | Output artifacts — snapshots, deltas, layers, pacing, identity |

## These files describe the code; they do not drive it

The TypeScript sources are the runtime authority. Nothing in the pipeline reads
this directory — these files exist so an agent can understand Mudlark without
reading the source. Where a grammar file and the code disagree, the code is
right and the grammar file is a bug.

`npm run verify:grammar` keeps that honest where it can be checked
mechanically: it asserts the layer order and every per-layer property list in
`output.json` match `src/layers/routing.ts` exactly, and that every config in
`subjects/` validates against `subject.schema.json`.
