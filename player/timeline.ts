import type { TimelineEntry } from '../src/pacing/plane';
import type { CommitMeta } from '../src/git/log';

// One control, not two. The old player stacked a rail of commit marks
// on top of a plain range slider — two widgets doing one job, and the
// one that looked like the timeline wasn't the one you dragged. Here
// the commit segments ARE the scrub track: click or drag anywhere to
// seek to that exact moment, and the segment boundaries stay visible so
// you can still aim at a commit.
//
// Commit-to-commit jumping moved to the transport's prev/next buttons
// and the arrow keys, which is how a video player with chapters works.

export interface TimelineHandle {
  update(currentSec: number, activeSha: string, commitIndex: number): void;
}

export interface TimelineCallbacks {
  onSeek(sec: number): void;
  onScrubStart(): void;
}

function totalOf(timeline: TimelineEntry[]): number {
  if (timeline.length === 0) return 1;
  const last = timeline[timeline.length - 1];
  return last.startSec + last.durationSec;
}

export function formatClock(sec: number): string {
  const whole = Math.max(0, Math.round(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Both the base strip and the played strip are the same geometry; the
// played one is revealed by clip-path, so progress and commit structure
// read at once without either obscuring the other.
function buildStrip(timeline: TimelineEntry[], total: number, className: string): HTMLDivElement {
  const strip = document.createElement('div');
  strip.className = `tl-segs ${className}`;
  for (const entry of timeline) {
    const seg = document.createElement('div');
    seg.className = 'tl-seg';
    seg.style.left = `${(entry.startSec / total) * 100}%`;
    seg.style.width = `${Math.max((entry.durationSec / total) * 100, 0.4)}%`;
    seg.dataset.sha = entry.sha;
    strip.appendChild(seg);
  }
  return strip;
}

export function renderTimeline(
  container: HTMLElement,
  timeline: TimelineEntry[],
  commits: CommitMeta[],
  callbacks: TimelineCallbacks,
): TimelineHandle {
  container.innerHTML = '';
  const total = totalOf(timeline);
  const bySha = new Map(commits.map((c) => [c.sha, c]));

  const track = document.createElement('div');
  track.className = 'tl-track';

  const base = buildStrip(timeline, total, 'tl-segs--base');
  const fill = buildStrip(timeline, total, 'tl-segs--fill');

  const playhead = document.createElement('div');
  playhead.className = 'tl-playhead';

  track.append(base, fill, playhead);

  const tip = document.createElement('div');
  tip.className = 'tl-tip';
  tip.setAttribute('aria-hidden', 'true');
  const tipMessage = document.createElement('span');
  tipMessage.className = 'tl-tip-msg';
  const tipMeta = document.createElement('span');
  tipMeta.className = 'tl-tip-meta';
  tip.append(tipMessage, tipMeta);

  container.append(track, tip);

  container.setAttribute('role', 'slider');
  container.setAttribute('tabindex', '0');
  container.setAttribute('aria-label', 'Film position');
  container.setAttribute('aria-valuemin', '0');
  container.setAttribute('aria-valuemax', total.toFixed(3));

  // --- geometry -------------------------------------------------------

  function fractionAt(clientX: number): number {
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function entryAtFraction(fraction: number): TimelineEntry {
    const sec = fraction * total;
    const found = timeline.find((e) => sec >= e.startSec && sec < e.startSec + e.durationSec);
    return found ?? timeline[timeline.length - 1];
  }

  // --- hover tooltip --------------------------------------------------

  function showTip(clientX: number): void {
    const fraction = fractionAt(clientX);
    const entry = entryAtFraction(fraction);
    const commit = bySha.get(entry.sha);

    tipMessage.textContent = commit ? commit.message : entry.sha;
    tipMeta.textContent = commit
      ? `${shortDate(commit.date)} · ${commit.sha} · ${formatClock(entry.startSec)}`
      : `${formatClock(entry.startSec)}`;

    tip.classList.add('is-visible');

    // Clamp so the tip never hangs off either end of the track.
    const containerRect = container.getBoundingClientRect();
    const tipWidth = tip.offsetWidth;
    const raw = clientX - containerRect.left;
    const clamped = Math.max(tipWidth / 2, Math.min(containerRect.width - tipWidth / 2, raw));
    tip.style.left = `${clamped}px`;
  }

  function hideTip(): void {
    tip.classList.remove('is-visible');
  }

  // --- pointer ---------------------------------------------------------

  let dragging = false;

  container.addEventListener('pointerdown', (event) => {
    dragging = true;
    container.setPointerCapture(event.pointerId);
    callbacks.onScrubStart();
    callbacks.onSeek(fractionAt(event.clientX) * total);
    showTip(event.clientX);
    event.preventDefault();
  });

  container.addEventListener('pointermove', (event) => {
    if (dragging) callbacks.onSeek(fractionAt(event.clientX) * total);
    showTip(event.clientX);
  });

  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
  };
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);
  container.addEventListener('pointerleave', () => {
    if (!dragging) hideTip();
  });

  // --- playhead --------------------------------------------------------

  return {
    update(currentSec: number, activeSha: string, commitIndex: number): void {
      const pct = total > 0 ? Math.max(0, Math.min(1, currentSec / total)) * 100 : 0;
      playhead.style.left = `${pct}%`;
      fill.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;

      base.querySelectorAll<HTMLElement>('.tl-seg').forEach((seg) => {
        seg.classList.toggle('is-active', seg.dataset.sha === activeSha);
      });

      const commit = bySha.get(activeSha);
      container.setAttribute('aria-valuenow', currentSec.toFixed(3));
      container.setAttribute(
        'aria-valuetext',
        `${formatClock(currentSec)} of ${formatClock(total)} — commit ${commitIndex + 1} of ${timeline.length}${
          commit ? `, ${commit.message}` : ''
        }`,
      );
    },
  };
}
