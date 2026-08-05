# Buildback

Buildback replays how a built artifact came to be, reconstructed from git commits. Locked camera on the rendered artifact — not the file tree, not the commit graph. Elements accrete between commits rather than cutting. The result is scrubbable, and pausing on any frame truthfully answers which commit is on screen.

## v1 — capture and playback

The v1 proof captures `rmichaelthomas/one-surface`'s `index.html` across its twelve-commit history (`2690c01` → `af5efa8`) and plays it back through five layers, in dependency order: **Bones** (element existence and nesting), **Frame** (box geometry), **Skin** (surface), **Voice** (typography, text, media), **Life** (behavior and motion).

The record rule: smoothing is permitted in presentation and forbidden in the record. Compress a dead fortnight; do not erase it. Never drop, reorder, or silently merge commits.

## Pipeline

```
src/git/       clone + extract trees at a SHA, read commit metadata
src/capture/   headless-browser capture: serve → load → settle → walk → snapshot
src/layers/    the property routing table (frame/skin/voice/life) + per-layer extraction
src/identity/  two-pass node matching across snapshots
src/delta/     snapshot pair → Delta
src/pacing/    named pacing rules over the (unaltered) commit surface
player/        Vite-based player: DOM reconstruction, interpolation, transport, commit rail
```

## Running it

```bash
npm install
npx playwright install chromium
npm run capture   # extract, capture, and snapshot all 12 commits -> out/snapshots/
npm run delta     # build deltas for every adjacent commit pair -> out/deltas/
npm run dev        # start the player
npm run verify     # run scripts/verify-capture-playback.ts
```

Not in scope for v1: video encoding/export, Tailwind utility-class resolution, multi-view capture, per-node Life, provenance-on-element, Ptah records, or any repo that doesn't render from a static tree.
