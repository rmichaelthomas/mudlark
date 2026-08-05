import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommitMeta {
  sha: string;
  date: string; // ISO 8601
  author: string;
  message: string;
}

// Unit/record separators, not delimiter characters that could plausibly
// appear in a commit subject or author name.
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

// Returns commits touching `path`, oldest-first. `sha` is the abbreviated
// form (git's default %h), matching the file naming used throughout the
// pipeline (out/snapshots/<sha>.json, out/deltas/<from>_<to>.json).
export async function commitsForPath(repoDir: string, path: string): Promise<CommitMeta[]> {
  const format = `%h${FIELD_SEP}%aI${FIELD_SEP}%an${FIELD_SEP}%s${RECORD_SEP}`;
  const { stdout } = await execFileAsync(
    'git',
    ['log', '--reverse', '--follow', `--format=${format}`, '--', path],
    { cwd: repoDir, maxBuffer: 1024 * 1024 * 32 },
  );

  return stdout
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, date, author, message] = record.split(FIELD_SEP);
      return { sha, date, author, message };
    });
}
