import type { Snapshot } from '../src/capture/types';
import type { Delta } from '../src/delta/types';
import type { CommitMeta } from '../src/git/log';
import { computeTimeline, DEFAULT_RULES, type TimelineEntry } from '../src/pacing/plane';
import { LAYER_ORDER, type LayerName } from '../src/layers/routing';
import { enterSegment, updateProgress, DEFAULT_LAYER_VISIBILITY, type LayerVisibility } from './render';
import { renderDetail } from './detail';
import { renderRail, updateRailPlayhead } from './rail';

const FULL_FILM_SECONDS = 45;
const SECONDS_PER_CUT_TRANSITION = 6;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

// Optional ?from=<sha>&to=<sha> trims the film to an inclusive commit
// range — e.g. the first cut, aee6d20..028c764 — so it can be watched
// repeatedly (checkpoint §10.3) without scrubbing past it each time.
// This is an explicit, user-requested view of a subset; it does not
// touch invariant 1, which governs silent internal drops.
function applyRangeParam(commits: CommitMeta[]): CommitMeta[] {
  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to) return commits;
  const fromIndex = commits.findIndex((c) => c.sha === from);
  const toIndex = commits.findIndex((c) => c.sha === to);
  if (fromIndex === -1 || toIndex === -1 || fromIndex > toIndex) return commits;
  return commits.slice(fromIndex, toIndex + 1);
}

async function boot(): Promise<void> {
  const manifest = await fetchJson<{ commits: CommitMeta[] }>('/manifest.json');
  const commits = applyRangeParam(manifest.commits);
  const isFullFilm = commits.length === manifest.commits.length;
  const totalSecondsTarget = isFullFilm ? FULL_FILM_SECONDS : Math.max(2, (commits.length - 1)) * SECONDS_PER_CUT_TRANSITION;

  const snapshotList = await Promise.all(commits.map((c) => fetchJson<Snapshot>(`/snapshots/${c.sha}.json`)));
  const snapshots = new Map<string, Snapshot>(snapshotList.map((s) => [s.sha, s]));

  const deltas: Delta[] = [];
  for (let i = 0; i < commits.length - 1; i++) {
    deltas.push(await fetchJson<Delta>(`/deltas/${commits[i].sha}_${commits[i + 1].sha}.json`));
  }

  const timeline = computeTimeline(deltas, commits, DEFAULT_RULES, totalSecondsTarget);
  const totalSec = timeline[timeline.length - 1].startSec + timeline[timeline.length - 1].durationSec;

  // Frame height computed once from the max docHeight across every
  // snapshot in the film, and never touched again — the camera never
  // rescales per commit (checkpoint §6, failure mode #5).
  const frameHeight = Math.max(...snapshotList.map((s) => s.docHeight));

  const stage = document.getElementById('stage') as HTMLElement;
  const frame = document.getElementById('frame') as HTMLElement;
  frame.style.width = '1280px';
  frame.style.height = `${frameHeight}px`;

  const detailEl = document.getElementById('detail') as HTMLElement;
  const railEl = document.getElementById('rail') as HTMLElement;
  const scrubEl = document.getElementById('scrub') as HTMLInputElement;
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const toggleEls = Array.from(document.querySelectorAll<HTMLInputElement>('[data-layer-toggle]'));

  scrubEl.min = '0';
  scrubEl.max = String(totalSec);
  scrubEl.step = '0.01';

  renderRail(railEl, timeline, (sec) => seek(sec));

  const visibility: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };
  for (const toggle of toggleEls) {
    const layer = toggle.dataset.layerToggle as LayerName;
    if (!LAYER_ORDER.includes(layer)) continue;
    toggle.checked = visibility[layer];
    toggle.addEventListener('change', () => {
      visibility[layer] = toggle.checked;
      updateProgress(currentLocalT, visibility);
    });
  }

  let currentSec = 0;
  let currentLocalT = 0;
  let currentIndex = -1;
  let playing = false;
  let lastFrameTime: number | null = null;

  // The single function that decides "which commit is the playhead on."
  // Rendering and the detail pane both read its result — invariant 6:
  // no second code path sets the commit the detail pane shows.
  function entryAt(sec: number): { index: number; entry: TimelineEntry } {
    const clamped = Math.max(0, Math.min(sec, totalSec - 0.0001));
    let index = timeline.findIndex((e) => clamped >= e.startSec && clamped < e.startSec + e.durationSec);
    if (index === -1) index = timeline.length - 1;
    return { index, entry: timeline[index] };
  }

  function renderAt(sec: number): void {
    const { index, entry } = entryAt(sec);
    const localT = entry.durationSec > 0 ? (sec - entry.startSec) / entry.durationSec : 1;

    if (index !== currentIndex) {
      currentIndex = index;
      const toSnapshot = snapshots.get(entry.sha)!;
      const fromSnapshot = index > 0 ? (snapshots.get(timeline[index - 1].sha) ?? null) : null;
      enterSegment(stage, fromSnapshot, toSnapshot);
      renderDetail(detailEl, commits[index]);
    }

    currentLocalT = localT;
    updateProgress(localT, visibility);
    updateRailPlayhead(railEl, timeline, sec, entry.sha);
    scrubEl.value = String(sec);
  }

  function seek(sec: number): void {
    currentSec = Math.max(0, Math.min(sec, totalSec));
    renderAt(currentSec);
  }

  scrubEl.addEventListener('input', () => {
    playing = false;
    playBtn.textContent = 'Play';
    seek(Number(scrubEl.value));
  });

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
    lastFrameTime = null;
    if (playing) requestAnimationFrame(tick);
  });

  function tick(now: number): void {
    if (!playing) return;
    if (lastFrameTime !== null) {
      const deltaSec = (now - lastFrameTime) / 1000;
      currentSec += deltaSec;
      if (currentSec >= totalSec) {
        currentSec = totalSec;
        playing = false;
        playBtn.textContent = 'Play';
      }
      renderAt(currentSec);
    }
    lastFrameTime = now;
    if (playing) requestAnimationFrame(tick);
  }

  renderAt(0);
}

boot().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to load film: ${(err as Error).message}`;
});
