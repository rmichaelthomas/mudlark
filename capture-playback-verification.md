# Buildback v1 — capture/playback verification

Run against subject repo: `/Users/rmichaelthomas/Websites/one-surface`

| ID | Blocking | Status | Description |
|----|----------|--------|-------------|
| A | yes | PASS | Git reader: commitsForPath returns exactly 12 commits, oldest 2690c01, newest af5efa8, oldest-first |
| B | yes | FAIL | 12 snapshot files exist; af5efa8 has ids view-app/con-grid/detail-panel and >=6 con-node nodes; recapturing af5efa8 is deterministic |
| C | yes | PASS | Snapshot hygiene: JSON round-trips unchanged, no snapshot exceeds 5MB, no computed property outside the routing-table union |
| D | no (diagnostic) | PASS | Identity: first-cut (aee6d20->028c764) matched-node ratio >=70% of the smaller snapshot (diagnostic — does not block); wholesale-replacement (028c764->66fb0d5) ratio reported without a floor |
| E | yes | PASS | Deltas/pacing: timeline beat count equals commit count exactly; appliedRules non-empty for every commit; 028c764->66fb0d5 produces a held beat via [hold-the-gaps] |
| F | yes | PASS | Invariants: routing.ts imported by capture, delta, and player; LAYER_ORDER declared exactly once; provisional configs (match weights, match threshold, pacing constants) exported |

## Detail

### A — PASS

Git reader: commitsForPath returns exactly 12 commits, oldest 2690c01, newest af5efa8, oldest-first

```
count=12 oldest=2690c01 newest=af5efa8 orderedOk=true
```

### B — FAIL

12 snapshot files exist; af5efa8 has ids view-app/con-grid/detail-panel and >=6 con-node nodes; recapturing af5efa8 is deterministic

```
files=12/12 ids=[view-app] con-node=0 deterministic=true (nodesMatch=true docHeightMatch=true scriptHashMatch=true (no timing field exists in this schema, so this is a strict equality check)) con-grid/con-node/detail-panel render only via switchView("paradigm") on the live default-view ("app") load; the settle protocol explicitly forbids calling switchView and multi-view capture is out of scope (checkpoint §1). This sub-check cannot pass against the current one-surface content without violating those constraints — flagging as a spec/reality mismatch, not a capture bug.
```

### C — PASS

Snapshot hygiene: JSON round-trips unchanged, no snapshot exceeds 5MB, no computed property outside the routing-table union

```
all 12 snapshots clean
```

### D — PASS (non-blocking)

Identity: first-cut (aee6d20->028c764) matched-node ratio >=70% of the smaller snapshot (diagnostic — does not block); wholesale-replacement (028c764->66fb0d5) ratio reported without a floor

```
first-cut matched=132/132 (100.0%); wholesale matched=5/54 (9.3%, expected to be mostly insert+remove)
```

### E — PASS

Deltas/pacing: timeline beat count equals commit count exactly; appliedRules non-empty for every commit; 028c764->66fb0d5 produces a held beat via [hold-the-gaps]

```
beats=12 commits=12 allApplied=true 66fb0d5.appliedRules=[weight-by-change,hold-the-gaps,dwell-on-structure] durationSec=16.50
```

### F — PASS

Invariants: routing.ts imported by capture, delta, and player; LAYER_ORDER declared exactly once; provisional configs (match weights, match threshold, pacing constants) exported

```
routingImportedByAll=true layerOrderDeclarations=1 hasMatchWeights=true hasMatchThreshold=true hasPacingConfig=true
```

## Result

Blocking failure in: B.