import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// `remote` may be a local path (a working repo, or a bare/non-bare clone
// already on disk) or a URL — git clone accepts both. If cacheDir already
// holds a git repo, it is reused as-is rather than re-cloned.
export async function ensureClone(remote: string, cacheDir: string): Promise<string> {
  if (existsSync(path.join(cacheDir, '.git'))) {
    return cacheDir;
  }
  await mkdir(path.dirname(cacheDir), { recursive: true });
  await execFileAsync('git', ['clone', '--quiet', remote, cacheDir]);
  return cacheDir;
}

// Materializes the tree at `sha` into `destDir` via `git archive | tar -x`,
// without `git checkout` or `git worktree` — both mutate shared working
// state and are slow to repeat per-commit.
export async function extractTree(repoDir: string, sha: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const archive = spawn('git', ['archive', sha], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const untar = spawn('tar', ['-x', '-C', destDir], { stdio: ['pipe', 'ignore', 'pipe'] });

    let archiveErr = '';
    let untarErr = '';
    archive.stderr.on('data', (chunk) => { archiveErr += chunk.toString(); });
    untar.stderr.on('data', (chunk) => { untarErr += chunk.toString(); });

    archive.stdout.pipe(untar.stdin);

    let archiveExit: number | null = null;
    let untarExit: number | null = null;
    let settled = false;

    const maybeFinish = () => {
      if (settled || archiveExit === null || untarExit === null) return;
      settled = true;
      if (archiveExit !== 0) {
        reject(new Error(`git archive ${sha} failed (exit ${archiveExit}): ${archiveErr}`));
      } else if (untarExit !== 0) {
        reject(new Error(`tar extract of ${sha} failed (exit ${untarExit}): ${untarErr}`));
      } else {
        resolve();
      }
    };

    archive.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
    untar.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
    archive.on('close', (code) => { archiveExit = code; maybeFinish(); });
    untar.on('close', (code) => { untarExit = code; maybeFinish(); });
  });
}
