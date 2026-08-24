# Mudlark

*from bones to build*

Mudlark replays how a built artifact came to be, reconstructed from git commits.
It captures each commit as a visual snapshot, extracts five layers
(Structure, Layout, Surface, Content, Behavior), and plays them back as a
continuous, scrubbable film — elements accreting rather than cutting between states.

The camera stays locked on the rendered artifact. Not the file tree, not the
commit graph. The building, not the crane.

## Quick start

```bash
git clone https://github.com/rmichaelthomas/mudlark.git
cd mudlark
npm install
npx playwright install chromium
```

### Watch your first replay

Point Mudlark at any HTML file inside a git repo:

```bash
npm run mudlark -- ~/my-project/index.html
```

That's it. Mudlark finds the repo, captures every commit, builds the film, and
opens the player at `http://localhost:5173`.

### Step-by-step (for declared states and advanced config)

For multi-state subjects or custom configuration, use the three-step pipeline:

```bash
npm run capture    # snapshot every commit × every declared state
npm run delta      # build per-state deltas and cross-state annotation
npm run dev        # open the player
```

See [Declared states](#declared-states) and [Using your own repo](#using-your-own-repo) below.

## Using your own repo

The fastest way — point Mudlark at your file:

```bash
npm run mudlark -- /path/to/your/repo/index.html
```

For more control, create a JSON config in `subjects/`:

```json
{
  "name": "my-project",
  "repo": "/path/to/your/local/repo",
  "path": "index.html",
  "states": []
}
```

Run with:

```bash
MUDLARK_SUBJECT=my-project npm run capture
MUDLARK_SUBJECT=my-project npm run delta
npm run dev
```

An empty `states` array captures the page as-is — one default state, no
register control in the player.

## The five layers

Every commit is decomposed into five layers, each meaningless without the one
before it:

| Layer | What it captures |
|---|---|
| **Structure** | Element existence and nesting — nodes entering or leaving the tree |
| **Layout** | Box geometry — position, dimensions, spacing, flex/grid |
| **Surface** | Color, background, border, shadow, radius, opacity |
| **Content** | Typography, text, images, media |
| **Behavior** | Scripts, event handlers, transitions, animations |

Toggle any layer on or off in the player to watch the artifact build through
that lens alone.

The record rule governs all of it: smoothing is permitted in presentation and
forbidden in the record. Compress a dead fortnight; do not erase it. Never
drop, reorder, or silently merge commits.

## Declared states

If your page has multiple views or registers (tabs, audience toggles, theme
switches), declare them in your subject config:

```json
{
  "states": [
    { "id": "default", "label": "Default", "script": null },
    { "id": "dark-mode", "label": "Dark mode", "script": "document.body.classList.add('dark');" }
  ]
}
```

Each state is captured independently. The player shows a register control to
switch between them. A commit that changed only an unseen state holds the
frame and explains what changed in the detail pane.

## Player controls

| Control | Action |
|---|---|
| **Play / Pause** | Start or stop playback. Space works from anywhere, including a focused dropdown |
| **⏮ ⏭** | Step to the previous / next commit (or press ← →) |
| **Timeline** | Click or drag anywhere to seek. Each segment is one commit, sized by how long it holds the screen; hover one for its message and date |
| **Loop** | On: the film holds a beat on the last frame, then runs again. Off: it stops, and the button becomes Replay |
| **Speed** | 0.5×, 1×, 2×, 4×, 8× |
| **Zoom** | Fit width (default — the artifact legible at full width), Fit (the whole thing in frame at once), or 100% |
| **Fullscreen** | Expand the player to fill the screen |
| **Layer toggles** | Show or hide individual layers |
| **Register** | Switch between declared states (if any) |

## Pipeline

```
src/cli.ts     one-command wrapper: resolve repo -> capture -> delta -> serve
src/git/       clone + extract trees at a SHA, read commit metadata
src/states/    declared-state config and zero-config-safe loader
src/capture/   headless-browser capture: serve → load → settle → state script → walk → snapshot
src/layers/    property routing table + per-layer extraction
src/identity/  two-pass node matching across snapshots
src/delta/     per-state deltas + cross-state annotation
src/pacing/    named pacing rules over the unaltered commit surface
player/        Vite player: DOM reconstruction, interpolation, framing, transport, timeline
subjects/      subject configs (one JSON file per subject)
```

Two verification suites, both driving the real thing rather than mocks:

```bash
npm run verify          # the record: git reader, capture, deltas, pacing, invariants
npm run verify:player   # the watching: framing, timeline, speeds, looping
```

## Current scope

Mudlark v1 captures anything a browser can render from a static file tree —
any HTML file, standalone SVGs, or any page that works by opening the file
directly. Point it at `index.html`, `about.html`, `docs/guide.html`, an SVG
diagram — if Chromium can display it without a server or build step, Mudlark
can replay its history.

It does not yet handle:

- Repos requiring compilation, bundling, or a dev server to render (React,
  Vue, Svelte, etc. — the source files aren't renderable without a build)
- Tailwind or utility-class resolution
- Video/image export
- Multi-file capture in a single beat
- Per-element provenance tracking

Build-step support (a "build adapter" that runs a command before each capture)
is the primary v2 boundary.

## Attribution

Built by [R. Michael Thomas](https://onesurface.org).

The name comes from the Victorian practice of mudlarking — scavenging the
Thames riverbed at low tide for coins, pottery shards, and bones. Mudlark
does the same thing with git history: finds each layer of the built artifact
as it accumulated, commit by commit, and holds it up to the light.
