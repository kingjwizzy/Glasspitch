// Builds and serves a SECOND copy of the site whose homepage renders the
// honest structural EMPTY state (W4): `PREVIEW_HOMEPAGE=empty` returns the
// EMPTY sentinel from src/lib/queries/homepage.ts (no DB read at all), so
// e2e can assert the young-ledger surfaces — the ghost-chip proof rail, the
// lock→whistle→scored pipeline, the "record opens after the first final
// whistle" copy — which the main webServer (PREVIEW_HOMEPAGE=1, populated)
// can never render.
//
// WHY a separate build: the homepage is fully static/ISR (`revalidate = 600`,
// byte-identical for every visitor), so its data state is baked in by the env
// at BUILD time. One `next build` can only ever produce one homepage state,
// and rebuilding the shared `.next` under the running main server would
// corrupt it — so the empty variant gets its own throwaway workspace (repo
// sources copied to a temp dir, node_modules symlinked) and its own build.
//
// Every OTHER flag matches the main webServer exactly (all PREVIEW_* hatches
// on, same Stripe test-mode dummies), so the two builds differ ONLY in the
// homepage's data state. Spawned by playwright.config.ts's second webServer
// entry; Playwright kills the process tree when the run ends.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKDIR = path.join(os.tmpdir(), 'glasspitch-e2e-empty-home');
const PORT = process.env.EMPTY_HOME_PORT ?? '3001';
const MAIN_PORT = process.env.PORT ?? '3000';

// Everything `next build` needs, and nothing else (jobs/, e2e/, docs/ stay
// behind). node_modules is symlinked — same lockfile, no reinstall.
const COPY = ['package.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'src', 'public'];

function log(msg) {
  console.log(`[empty-home-server] ${msg}`);
}

/** Wait (bounded) for the MAIN webServer's port to accept connections, so the
 *  two `next build`s run in sequence instead of competing for CPU/RAM (CI
 *  runners are small). If the main server never comes up the whole run is
 *  failing anyway — proceed after the cap rather than deadlock. */
async function waitForMainServer(
  capMs = Number(process.env.EMPTY_HOME_WAIT_MS ?? 240_000),
) {
  const started = Date.now();
  while (Date.now() - started < capMs) {
    const up = await new Promise((resolve) => {
      const sock = net.connect({ port: Number(MAIN_PORT), host: '127.0.0.1' }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(1000, () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (up) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  log(`main server on :${MAIN_PORT} not up after ${capMs}ms — building anyway`);
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });
}

const env = {
  ...process.env,
  // The one divergence from the main webServer: the homepage renders EMPTY.
  ALLOW_PREVIEW: '1',
  PREVIEW_HOMEPAGE: 'empty',
  // Everything else mirrors playwright.config.ts's main webServer env so the
  // rest of the build behaves identically (and never needs a live DB).
  PREVIEW_LEDGER: '1',
  PREVIEW_MATCH: '1',
  PREVIEW_TEAM: '1',
  PREVIEW_LEAGUE: '1',
  PREVIEW_MATCHES: '1',
  STRIPE_SECRET_KEY: 'sk_test_e2e_dummy_00000000000000000000000000',
  STRIPE_PRICE_ID_MONTHLY: 'price_test_e2e_monthly',
  STRIPE_PRICE_ID_ANNUAL: 'price_test_e2e_annual',
};

await waitForMainServer();

log(`preparing workspace at ${WORKDIR}`);
fs.rmSync(WORKDIR, { recursive: true, force: true });
fs.mkdirSync(WORKDIR, { recursive: true, mode: 0o700 });
for (const entry of COPY) {
  fs.cpSync(path.join(ROOT, entry), path.join(WORKDIR, entry), { recursive: true });
}
// Local dev: reuse .env.local (read-only Supabase keys) exactly like the main
// build; in CI it doesn't exist and the job env provides the dummy values.
const envLocal = path.join(ROOT, '.env.local');
if (fs.existsSync(envLocal)) {
  fs.copyFileSync(envLocal, path.join(WORKDIR, '.env.local'));
  fs.chmodSync(path.join(WORKDIR, '.env.local'), 0o600);
}
linkNodeModules();

/** Turbopack refuses a node_modules SYMLINK that points outside its project
 *  root, so materialise a cheap real directory instead: APFS copy-on-write
 *  clones on macOS (`cp -c`), recursive hardlinks on Linux (`cp -al`), and a
 *  plain copy as the last resort. All read-only for a build, so sharing
 *  inodes/blocks with the repo's node_modules is safe. */
function linkNodeModules() {
  const src = path.join(ROOT, 'node_modules');
  const dest = path.join(WORKDIR, 'node_modules');
  const attempts =
    process.platform === 'darwin'
      ? [['cp', ['-Rc', src, dest]]]
      : [['cp', ['-al', src, dest]]];
  for (const [cmd, args] of attempts) {
    const res = spawnSync(cmd, args, { stdio: 'ignore' });
    if (res.status === 0) return;
    fs.rmSync(dest, { recursive: true, force: true });
  }
  log('cheap node_modules link failed — falling back to a full copy');
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
}

const nextBin = path.join(WORKDIR, 'node_modules', '.bin', 'next');
log('building the empty-homepage variant (PREVIEW_HOMEPAGE=empty)');
await run(nextBin, ['build'], { cwd: WORKDIR, env });
log(`serving on :${PORT}`);
await run(nextBin, ['start', '-p', PORT], { cwd: WORKDIR, env });
