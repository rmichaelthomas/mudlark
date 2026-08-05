import type { TimelineEntry } from '../src/pacing/plane';

function totalOf(timeline: TimelineEntry[]): number {
  if (timeline.length === 0) return 1;
  const last = timeline[timeline.length - 1];
  return last.startSec + last.durationSec;
}

// One mark per commit, positioned and sized by film time (not by index)
// — a held beat from [hold-the-gaps] reads as a wide mark, a
// [floor-the-noise]-capped commit as a thin one. The gap stays visibly
// present rather than collapsed.
export function renderRail(container: HTMLElement, timeline: TimelineEntry[], onSeek: (sec: number) => void): void {
  container.innerHTML = '';
  const total = totalOf(timeline);

  const track = document.createElement('div');
  track.className = 'rail-track';

  for (const entry of timeline) {
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'rail-mark';
    mark.style.left = `${(entry.startSec / total) * 100}%`;
    mark.style.width = `${Math.max((entry.durationSec / total) * 100, 0.4)}%`;
    mark.title = `${entry.sha} — ${entry.durationSec.toFixed(2)}s — ${entry.appliedRules.join(', ')}`;
    mark.dataset.sha = entry.sha;
    mark.addEventListener('click', () => onSeek(entry.startSec));
    track.appendChild(mark);
  }

  const playhead = document.createElement('div');
  playhead.className = 'rail-playhead';
  track.appendChild(playhead);

  container.appendChild(track);
}

export function updateRailPlayhead(container: HTMLElement, timeline: TimelineEntry[], currentSec: number, activeSha: string): void {
  const total = totalOf(timeline);
  const playhead = container.querySelector<HTMLDivElement>('.rail-playhead');
  if (playhead) playhead.style.left = `${(currentSec / total) * 100}%`;

  container.querySelectorAll<HTMLElement>('.rail-mark').forEach((mark) => {
    mark.classList.toggle('active', mark.dataset.sha === activeSha);
  });
}
