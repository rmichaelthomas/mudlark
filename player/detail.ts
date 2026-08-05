import type { CommitMeta } from '../src/git/log';

// Bound to the playhead by a single caller (player/main.ts's entryAt),
// so the pane can never show a commit other than the one the frame is
// actually rendering — the record rule made operable (checkpoint §6).
export function renderDetail(el: HTMLElement, commit: CommitMeta): void {
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
}
