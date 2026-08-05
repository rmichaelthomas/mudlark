import type { CommitMeta } from '../src/git/log';
import type { Delta } from '../src/delta/types';

// Bound to the playhead by a single caller (player/main.ts's entryAt),
// so the pane can never show a commit other than the one the frame is
// actually rendering — the record rule made operable (checkpoint §6).
//
// `incomingDelta` is the delta that produced this commit's frame (null
// for the film's first commit, which has no predecessor). When it is
// empty in the current register but non-empty in others
// (`otherStatesChanged`), the pane says so plainly — checkpoint v1.2
// §6: the frame holds, and the pane explains rather than hides that.
export function renderDetail(
  el: HTMLElement,
  commit: CommitMeta,
  incomingDelta: Delta | null,
  stateLabels: Map<string, string>,
  currentStateId: string,
): void {
  el.innerHTML = '';

  const meta = document.createElement('div');
  meta.className = 'detail-meta';

  const sha = document.createElement('span');
  sha.className = 'detail-sha';
  sha.textContent = commit.sha;

  const date = document.createElement('span');
  date.className = 'detail-date';
  date.textContent = new Date(commit.date).toLocaleString();

  const author = document.createElement('span');
  author.className = 'detail-author';
  author.textContent = commit.author;

  meta.append(sha, date, author);

  const message = document.createElement('p');
  message.className = 'detail-message';
  message.textContent = commit.message;

  el.append(meta, message);

  if (incomingDelta && incomingDelta.otherStatesChanged.length > 0) {
    const currentLabel = stateLabels.get(currentStateId) ?? currentStateId;
    const otherLabels = incomingDelta.otherStatesChanged.map((id) => stateLabels.get(id) ?? id);

    const note = document.createElement('p');
    note.className = 'detail-offregister';
    note.textContent = `No change in ${currentLabel} for this commit. It changed ${otherLabels.join(', ')}.`;
    el.append(note);
  }
}
