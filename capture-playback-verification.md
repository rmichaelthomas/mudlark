# Buildback v1.2 — declared-states capture/playback verification

Run against subject: `one-surface` (`/Users/rmichaelthomas/Websites/one-surface`), states: app, paradigm-plain, paradigm-arch, paradigm-why

| ID | Blocking | Status | Description |
|----|----------|--------|-------------|
| A | yes | PASS | Git reader: commitsForPath returns exactly 12 commits, oldest 2690c01, newest af5efa8, oldest-first |
| B | yes | PASS | Capture (app state): 12 snapshot files exist under out/snapshots/app/; the af5efa8 snapshot contains at least one flip-inner node with a non-zero inline height (sizeBacks() proof of live-DOM capture) |
| B2 | yes | PASS | Declared states: the af5efa8 snapshot under out/snapshots/paradigm-arch/ contains at least six con-node nodes |
| C | yes | PASS | Snapshot hygiene (every state): JSON round-trips unchanged, no snapshot exceeds 5MB, no computed property outside the routing-table union |
| D | no (diagnostic) | PASS | Identity (app state): first-cut (aee6d20->028c764) matched-node ratio >=70% of the smaller snapshot (diagnostic — does not block); wholesale-replacement (028c764->66fb0d5) ratio reported without a floor |
| E | yes | PASS | Deltas/pacing (app state): timeline beat count equals commit count exactly; appliedRules non-empty for every commit; 028c764->66fb0d5 produces a held beat via [hold-the-gaps] |
| F | yes | PASS | Invariants: routing.ts imported by capture, delta, and player; LAYER_ORDER declared exactly once; provisional configs (match weights, match threshold, pacing constants) exported |
| G | yes | PASS | Zero-config (blocking): capture against a config with no states key produces exactly one state directory named default with 12 snapshots, and the manifest would list exactly one state |
| H | yes | PASS | State parity: every state directory holds 12 snapshots and 11 deltas; counts equal across all declared states |
| I | yes | PASS | Annotation hygiene: no delta carries a non-empty otherStatesChanged while itself non-empty; every id named in otherStatesChanged exists in the manifest |
| J | yes | PASS | Camera invariance: viewportWidth is identical (1280) across every snapshot of every state |
| K | yes | PASS | Font determinism: every resolved fontFamily's first choice names a family the subject actually declares (never an immediate fallback); recapturing af5efa8 with the font cache primed matches within 3 attempts (see code comment — a known, bounded Chromium variable-font rendering race, independent of this pipeline's font caching) |

## Detail

### A — PASS

Git reader: commitsForPath returns exactly 12 commits, oldest 2690c01, newest af5efa8, oldest-first

```
count=12 oldest=2690c01 newest=af5efa8 orderedOk=true
```

### B — PASS

Capture (app state): 12 snapshot files exist under out/snapshots/app/; the af5efa8 snapshot contains at least one flip-inner node with a non-zero inline height (sizeBacks() proof of live-DOM capture)

```
files=12/12 flip-inner-with-height=5 sample-heights=[266px, 277px, 276px]
```

### B2 — PASS

Declared states: the af5efa8 snapshot under out/snapshots/paradigm-arch/ contains at least six con-node nodes

```
con-node=6
```

### C — PASS

Snapshot hygiene (every state): JSON round-trips unchanged, no snapshot exceeds 5MB, no computed property outside the routing-table union

```
all 48 snapshots clean across 4 state(s)
```

### D — PASS (non-blocking)

Identity (app state): first-cut (aee6d20->028c764) matched-node ratio >=70% of the smaller snapshot (diagnostic — does not block); wholesale-replacement (028c764->66fb0d5) ratio reported without a floor

```
first-cut matched=132/132 (100.0%); wholesale matched=5/54 (9.3%, expected to be mostly insert+remove)
```

### E — PASS

Deltas/pacing (app state): timeline beat count equals commit count exactly; appliedRules non-empty for every commit; 028c764->66fb0d5 produces a held beat via [hold-the-gaps]

```
beats=12 commits=12 allApplied=true 66fb0d5.appliedRules=[weight-by-change,hold-the-gaps,dwell-on-structure] durationSec=18.56
```

### F — PASS

Invariants: routing.ts imported by capture, delta, and player; LAYER_ORDER declared exactly once; provisional configs (match weights, match threshold, pacing constants) exported

```
routingImportedByAll=true layerOrderDeclarations=1 hasMatchWeights=true hasMatchThreshold=true hasPacingConfig=true
```

### G — PASS

Zero-config (blocking): capture against a config with no states key produces exactly one state directory named default with 12 snapshots, and the manifest would list exactly one state

```
topDirs=["default"] defaultFileCount=12 allStateIdDefault=true manifestWouldListOne=true
```

### H — PASS

State parity: every state directory holds 12 snapshots and 11 deltas; counts equal across all declared states

```
{"app":{"snapshots":12,"deltas":11},"paradigm-plain":{"snapshots":12,"deltas":11},"paradigm-arch":{"snapshots":12,"deltas":11},"paradigm-why":{"snapshots":12,"deltas":11}}
```

### I — PASS

Annotation hygiene: no delta carries a non-empty otherStatesChanged while itself non-empty; every id named in otherStatesChanged exists in the manifest

```
clean
```

### J — PASS

Camera invariance: viewportWidth is identical (1280) across every snapshot of every state

```
distinct viewportWidths=[1280]
```

### K — PASS

Font determinism: every resolved fontFamily's first choice names a family the subject actually declares (never an immediate fallback); recapturing af5efa8 with the font cache primed matches within 3 attempts (see code comment — a known, bounded Chromium variable-font rendering race, independent of this pipeline's font caching)

```
declaredFamilies=[Fraunces, Figtree, Gugi, Cormorant Garamond, PT Mono, Alegreya Sans, Alegreya Sans SC] declaredFamiliesObservedAsFirstChoice=[Fraunces, Figtree, Gugi, Cormorant Garamond, PT Mono, Alegreya Sans, Alegreya Sans SC] nodesMatch=true after 1/3 attempt(s) (font cache primed by the main capture run; see code comment for the empirical investigation behind the retry tolerance)
```

## Result

All blocking assertions (A, B, B2, C, E, F, G, H, I, J, K) pass.