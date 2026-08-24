import type { Snapshot } from '../src/capture/types';
import type { Delta } from '../src/delta/types';
import type { CommitMeta } from '../src/git/log';
import { computeTimeline, DEFAULT_RULES, type TimelineEntry } from '../src/pacing/plane';
import { LAYER_ORDER, type LayerName } from '../src/layers/routing';
import { enterSegment, updateProgress, pageBackgroundAt, DEFAULT_LAYER_VISIBILITY, type LayerVisibility } from './render';
import { renderDetail } from './detail';
import { renderTimeline, formatClock, type TimelineHandle } from './timeline';

const FULL_FILM_SECONDS = 45;
const SECONDS_PER_CUT_TRANSITION = 6;

// The capture width every snapshot was taken at (src/capture/capture.ts).
const FILM_WIDTH = 1280;

// Used only when the subject declares no root background of its own, or
// when the Surface layer is toggled off.
const FRAME_FALLBACK_BACKGROUND = '#0f1608';

// The beat the film holds on its last frame before looping. The final
// commit -> first commit jump is the largest single change in the film
// (a wholesale replacement), so restarting the instant the last frame
// lands reads as a glitch rather than a loop. Divided by speed because a
// fixed 1.2s at 8x — where the whole film is under six seconds — reads
// as a stall rather than a beat.
const LOOP_HOLD_SECONDS = 1.2;
const LOOP_HOLD_MIN_SECONDS = 0.4;

// Playback is a three-state machine, not a boolean. `holding` is the
// end-of-film beat: the clock is running but film time is not.
type Phase = 'idle' | 'playing' | 'holding';
type ZoomMode = 'fit' | 'fit-width' | 'actual';

interface StateInfo {
  id: string;
  label: string;
}

// out/manifest.json, written by src/delta/build.ts's writeManifest.
// `subject` is optional so a manifest built before v1.3 still loads —
// the header simply shows no subject line.
interface Manifest {
  commits: CommitMeta[];
  states: StateInfo[];
  subject?: { repo: string; path: string; label: string };
}

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

// Invariant 7 (v1.2): zero-config capture is the single-element case of
// the general path. When the manifest lists one state, this renders
// nothing — not disabled, not a single-option dropdown. Absent.
function renderRegisterControl(
  wrap: HTMLElement,
  states: StateInfo[],
  currentStateId: string,
  onChange: (stateId: string) => void,
): void {
  wrap.innerHTML = '';
  if (states.length <= 1) return;

  const label = document.createElement('label');
  label.textContent = 'Register';
  label.htmlFor = 'register';

  const select = document.createElement('select');
  select.id = 'register';
  for (const state of states) {
    const option = document.createElement('option');
    option.value = state.id;
    option.textContent = state.label;
    option.selected = state.id === currentStateId;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));

  wrap.append(label, select);
}

async function boot(): Promise<void> {
  const manifest = await fetchJson<Manifest>('/manifest.json');
  const states = manifest.states;
  const stateLabels = new Map(states.map((s) => [s.id, s.label]));

  const subjectLabel = document.getElementById('subject-label') as HTMLElement;
  subjectLabel.textContent = manifest.subject?.label ?? '';

  const commits = applyRangeParam(manifest.commits);
  const isFullFilm = commits.length === manifest.commits.length;
  const totalSecondsTarget = isFullFilm ? FULL_FILM_SECONDS : Math.max(2, commits.length - 1) * SECONDS_PER_CUT_TRANSITION;

  const stage = document.getElementById('stage') as HTMLElement;
  const frame = document.getElementById('frame') as HTMLElement;
  const frameWrap = document.getElementById('frame-wrap') as HTMLElement;
  const viewport = document.getElementById('viewport') as HTMLElement;

  const registerWrap = document.getElementById('register-wrap') as HTMLElement;
  const detailEl = document.getElementById('detail') as HTMLElement;
  const timelineEl = document.getElementById('timeline') as HTMLElement;
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const prevBtn = document.getElementById('prev-commit') as HTMLButtonElement;
  const nextBtn = document.getElementById('next-commit') as HTMLButtonElement;
  const loopBtn = document.getElementById('loop') as HTMLButtonElement;
  const speedEl = document.getElementById('speed') as HTMLSelectElement;
  const zoomEl = document.getElementById('zoom') as HTMLSelectElement;
  const fullscreenBtn = document.getElementById('fullscreen') as HTMLButtonElement;
  const clockNowEl = document.getElementById('clock-now') as HTMLElement;
  const clockTotalEl = document.getElementById('clock-total') as HTMLElement;
  const commitCountEl = document.getElementById('commit-count') as HTMLElement;
  const toggleEls = Array.from(document.querySelectorAll<HTMLInputElement>('[data-layer-toggle]'));

  const visibility: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };
  for (const toggle of toggleEls) {
    const layer = toggle.dataset.layerToggle as LayerName;
    if (!LAYER_ORDER.includes(layer)) continue;
    toggle.checked = visibility[layer];
    toggle.addEventListener('change', () => {
      visibility[layer] = toggle.checked;
      updateProgress(currentLocalT, visibility);
      frame.style.background = pageBackgroundAt(currentLocalT, visibility) ?? FRAME_FALLBACK_BACKGROUND;
    });
  }

  let currentStateId = states[0].id;
  let snapshots = new Map<string, Snapshot>();
  let deltas: Delta[] = [];
  let timeline: TimelineEntry[] = [];
  let timelineHandle: TimelineHandle | null = null;
  let totalSec = 0;
  let frameHeight = 0;

  let currentSec = 0;
  let currentLocalT = 0;
  let currentIndex = -1;
  let phase: Phase = 'idle';
  let lastFrameTime: number | null = null;
  // One rAF loop at a time. Pausing and resuming inside a single frame
  // would otherwise leave the old callback queued alongside the new one,
  // and two live loops advance film time twice per frame.
  let rafId: number | null = null;
  let holdRemaining = 0;
  let speed = Number(speedEl.value) || 1;
  let loop = true;
  // Fit width by default: framing a 4000px page whole makes body text a
  // suggestion of text. Width-fit keeps it legible and costs vertical
  // scrolling, which Fit is one dropdown away from restoring.
  let zoom: ZoomMode = 'fit-width';

  // --- framing --------------------------------------------------------

  // A CSS transform doesn't occupy layout space, so the wrapper is sized
  // to the scaled dimensions — that's what centering and scrolling see.
  // Scaling the container means every absolutely-positioned node inside
  // scales with it, so render.ts's geometry math is untouched.
  function applyZoom(): void {
    if (frameHeight === 0) return;
    const style = getComputedStyle(viewport);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availableWidth = Math.max(1, viewport.clientWidth - padX);
    const availableHeight = Math.max(1, viewport.clientHeight - padY);

    let scale = 1;
    if (zoom === 'fit') scale = Math.min(availableWidth / FILM_WIDTH, availableHeight / frameHeight);
    else if (zoom === 'fit-width') scale = availableWidth / FILM_WIDTH;
    // Never upscale past the captured size — a short artifact blown up to
    // fill a large window is a worse frame, not a better one.
    scale = Math.min(scale, 1);

    frame.style.transform = `scale(${scale})`;
    frameWrap.style.width = `${FILM_WIDTH * scale}px`;
    frameWrap.style.height = `${frameHeight * scale}px`;
  }

  new ResizeObserver(() => applyZoom()).observe(viewport);

  zoomEl.addEventListener('change', () => {
    zoom = zoomEl.value as ZoomMode;
    applyZoom();
  });

  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  });

  // --- loading --------------------------------------------------------

  async function loadState(stateId: string): Promise<void> {
    const snapshotList = await Promise.all(commits.map((c) => fetchJson<Snapshot>(`/snapshots/${stateId}/${c.sha}.json`)));
    snapshots = new Map(snapshotList.map((s) => [s.sha, s]));

    deltas = [];
    for (let i = 0; i < commits.length - 1; i++) {
      deltas.push(await fetchJson<Delta>(`/deltas/${stateId}/${commits[i].sha}_${commits[i + 1].sha}.json`));
    }

    // Pacing runs per state (checkpoint v1.2 §6) — the same commit can
    // draw different screen time in different registers.
    timeline = computeTimeline(deltas, commits, DEFAULT_RULES, totalSecondsTarget);
    totalSec = timeline[timeline.length - 1].startSec + timeline[timeline.length - 1].durationSec;

    // Frame height computed once per state's own snapshots and never
    // touched again within that state — the camera never rescales per
    // commit (checkpoint §6, failure mode #5). Viewport width and
    // capture height are shared across every state by construction
    // (invariant 8); only the measured content height varies here.
    frameHeight = Math.max(...snapshotList.map((s) => s.docHeight));
    frame.style.width = `${FILM_WIDTH}px`;
    frame.style.height = `${frameHeight}px`;
    applyZoom();

    clockTotalEl.textContent = formatClock(totalSec);
    timelineHandle = renderTimeline(timelineEl, timeline, commits, {
      onSeek: (sec) => seek(sec),
      onScrubStart: () => setPhase('idle'),
    });
    currentIndex = -1; // force the next renderAt to rebuild the stage from this state's data
  }

  // --- playhead -------------------------------------------------------

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
      const incomingDelta = index > 0 ? deltas[index - 1] : null;
      renderDetail(detailEl, commits[index], incomingDelta, stateLabels, currentStateId);
    }

    currentLocalT = localT;
    updateProgress(localT, visibility);
    frame.style.background = pageBackgroundAt(localT, visibility) ?? FRAME_FALLBACK_BACKGROUND;
    timelineHandle?.update(sec, entry.sha, index);
    clockNowEl.textContent = formatClock(sec);
    commitCountEl.textContent = `${index + 1} / ${timeline.length}`;
  }

  function seek(sec: number): void {
    currentSec = Math.max(0, Math.min(sec, totalSec));
    renderAt(currentSec);
    updatePlayButton();
  }

  // --- transport ------------------------------------------------------

  function atEnd(): boolean {
    return totalSec > 0 && currentSec >= totalSec - 0.001;
  }

  function updatePlayButton(): void {
    const state = phase === 'idle' ? (atEnd() && !loop ? 'ended' : 'idle') : phase;
    playBtn.dataset.state = state;
    if (state === 'ended') {
      playBtn.textContent = '⟲';
      playBtn.setAttribute('aria-label', 'Replay');
      playBtn.title = 'Replay (Space)';
    } else if (state === 'idle') {
      playBtn.textContent = '⏵';
      playBtn.setAttribute('aria-label', 'Play');
      playBtn.title = 'Play (Space)';
    } else {
      playBtn.textContent = '⏸';
      playBtn.setAttribute('aria-label', 'Pause');
      playBtn.title = 'Pause (Space)';
    }
  }

  function startLoop(): void {
    if (rafId === null) rafId = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function setPhase(next: Phase): void {
    phase = next;
    lastFrameTime = null;
    updatePlayButton();
    if (phase === 'idle') stopLoop();
    else startLoop();
  }

  // Pressing play on the final frame restarts the film. Without this the
  // button looks alive and does nothing: the clock is already at the end,
  // so the next frame immediately re-clamps and stops.
  function togglePlay(): void {
    if (phase === 'idle') {
      if (atEnd()) seek(0);
      setPhase('playing');
    } else {
      setPhase('idle');
    }
  }

  function holdDuration(): number {
    return Math.max(LOOP_HOLD_MIN_SECONDS, LOOP_HOLD_SECONDS / speed);
  }

  function tick(now: number): void {
    rafId = null;
    if (phase === 'idle') return;

    if (lastFrameTime !== null) {
      const realDelta = (now - lastFrameTime) / 1000;

      if (phase === 'holding') {
        // Film time is frozen; only the beat's own clock runs.
        holdRemaining -= realDelta;
        if (holdRemaining <= 0) {
          seek(0);
          phase = 'playing';
          updatePlayButton();
        }
      } else {
        currentSec += realDelta * speed;
        if (currentSec >= totalSec) {
          currentSec = totalSec;
          renderAt(currentSec);
          if (loop) {
            phase = 'holding';
            holdRemaining = holdDuration();
            updatePlayButton();
          } else {
            setPhase('idle');
            return;
          }
        } else {
          renderAt(currentSec);
        }
      }
    }

    lastFrameTime = now;
    startLoop();
  }

  // Steps to the START of the adjacent timeline entry — the same unit
  // the segments and the commit counter use, so all three agree on what
  // "a commit" is.
  function stepCommit(direction: -1 | 1): void {
    const { index } = entryAt(currentSec);
    const next = Math.max(0, Math.min(index + direction, timeline.length - 1));
    setPhase('idle');
    seek(timeline[next].startSec);
  }

  playBtn.addEventListener('click', () => togglePlay());
  prevBtn.addEventListener('click', () => stepCommit(-1));
  nextBtn.addEventListener('click', () => stepCommit(1));

  loopBtn.addEventListener('click', () => {
    loop = !loop;
    loopBtn.setAttribute('aria-pressed', String(loop));
    // Leaving the hold with loop switched off would strand the playhead
    // mid-beat, so the beat resolves into a normal stop.
    if (!loop && phase === 'holding') setPhase('idle');
    updatePlayButton();
  });

  speedEl.addEventListener('change', () => {
    speed = Number(speedEl.value) || 1;
    lastFrameTime = null; // don't charge the new rate for time spent at the old one
  });

  // Bound to the document, not the transport, so the shortcuts work
  // wherever focus happens to be. Arrow keys are claimed from the
  // timeline deliberately: while watching a film, "next" means the next
  // commit, not the next hundredth of a second.
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable) return;

    // A focused dropdown (register, speed, zoom) keeps its own arrow keys
    // for cycling values. It does NOT keep Space. Picking a zoom or a
    // speed with the mouse leaves focus sitting on that dropdown, and the
    // very next thing anyone reaches for is Space to start the film —
    // having it reopen the dropdown instead is wrong every single time.
    // Opening a focused dropdown from the keyboard still works with Enter
    // or Alt+Down.
    const inDropdown = target?.tagName === 'SELECT';

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault(); // otherwise the page scrolls, and a focused button double-fires
      togglePlay();
    } else if (event.key === 'ArrowLeft') {
      if (inDropdown) return;
      event.preventDefault();
      stepCommit(-1);
    } else if (event.key === 'ArrowRight') {
      if (inDropdown) return;
      event.preventDefault();
      stepCommit(1);
    }
  });

  renderRegisterControl(registerWrap, states, currentStateId, async (nextStateId) => {
    currentStateId = nextStateId;
    const holdSec = currentSec; // switching state holds the playhead at its current film time
    setPhase('idle');
    await loadState(currentStateId);
    seek(Math.min(holdSec, totalSec));
  });

  await loadState(currentStateId);
  seek(0);
}

boot().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to load film: ${(err as Error).message}`;
});
