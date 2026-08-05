# Buildback

Buildback replays how a built artifact came to be, reconstructed from git commits. Locked camera on the rendered artifact — not the file tree, not the commit graph. Elements accrete between commits rather than cutting. The result is scrubbable, and pausing on any frame truthfully answers which commit is on screen.

## v1 — capture and playback

The v1 proof captures `rmichaelthomas/one-surface`'s `index.html` across its twelve-commit history (`2690c01` → `af5efa8`) and plays it back through five layers, in dependency order: **Bones** (element existence and nesting), **Frame** (box geometry), **Skin** (surface), **Voice** (typography, text, media), **Life** (behavior and motion).

The record rule: smoothing is permitted in presentation and forbidden in the record. Compress a dead fortnight; do not erase it. Never drop, reorder, or silently merge commits.

## v1.2 — declared states

A subject can present the same content in more than one register — a view switch, an audience toggle — selected by JS the page already ships. Capture used to see only whichever register loaded by default; a commit that changed only an unseen register produced a beat where visibly nothing happened, silently smoothing a real change out of existence.

A subject now declares its states in `subjects/<name>.json`: an id, a label, and an optional script run after settle and before the walk (`src/states/`). Every state is captured, delta'd, and paced independently. When a delta is empty but another state's delta over the same commit pair isn't, the empty delta is annotated (`otherStatesChanged`) rather than left to read as nothing happened — the player's detail pane surfaces that explanation and holds the frame.

**The hard constraint:** a subject that declares nothing captures exactly as it did in v1 — one implicit `default` state, no config required, no register control in the player. `normalizeStates` is called once at load; nothing downstream branches on whether states were declared.

## Pipeline

```
src/git/       clone + extract trees at a SHA, read commit metadata
src/states/    declared-state config (types + zero-config-safe loader)
src/capture/   headless-browser capture: serve → load → settle → state script → walk → snapshot
src/layers/    the property routing table (frame/skin/voice/life) + per-layer extraction
src/identity/  two-pass node matching across snapshots
src/delta/     per-state deltas + cross-state annotation (two-pass build)
src/pacing/    named pacing rules over the (unaltered) commit surface, run per state
player/        Vite-based player: DOM reconstruction, interpolation, transport, commit rail, register control
subjects/      declared-state configs, one JSON file per subject
```

## Running it

```bash
npm install
npx playwright install chromium
npm run capture   # extract, capture, and snapshot every declared state x commit -> out/snapshots/<stateId>/
npm run delta     # build per-state deltas + cross-state annotation -> out/deltas/<stateId>/
npm run dev        # start the player
npm run verify     # run scripts/verify-capture-playback.ts
```

`BUILDBACK_SUBJECT` selects which `subjects/<name>.json` config to use (default `one-surface`).

Not in scope: video encoding/export, Tailwind utility-class resolution, multi-view capture in a single beat, per-node Life, provenance-on-element, Ptah records, theme/breakpoint/locale states (declare none), or any repo that doesn't render from a static tree.
