import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// root is player/ (the shell lives there); publicDir is out/ so the
// player can fetch /manifest.json, /snapshots/<sha>.json, and
// /deltas/<from>_<to>.json as plain static files, no server code needed.
export default defineConfig({
  root: path.resolve(__dirname, 'player'),
  publicDir: path.resolve(__dirname, 'out'),
  server: { port: 5173 },
});
