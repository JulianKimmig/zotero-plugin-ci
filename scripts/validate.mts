/** Backwards-compatible local validation CLI executes split read-only stages sequentially. */
import { loadConfig } from '../src/config.mts';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJSON } from '../src/pipeline-io.mts';
import type { PreparedState } from '../src/pipeline-prepare.mts';
const root = resolve(process.argv[2] ?? '.'), output = resolve(process.argv[3] ?? join(root, '.ci-accepted'));
const config = await loadConfig(root);
const hostPlatform = { linux: 'linux-x64', win32: 'windows-x64', darwin: 'macos-x64' }[process.platform as 'linux' | 'win32' | 'darwin'];
if (config.schemaVersion === 2 && config.platforms.some(platform => platform !== hostPlatform)) throw new Error('Local validation requires a host matching every cell; use the reusable matrix workflow for multiple platforms');
if (config.schemaVersion === 1) {
 await import('./validate-legacy.mts');
} else {
const work = await mkdtemp(join(tmpdir(), 'zotero-validation-')), prepared = join(work, 'prepared'), built = join(work, 'built');
const receipts = join(work, 'receipts'); await mkdir(receipts);
const entry = fileURLToPath(new URL('./pipeline.mts', import.meta.url));
/** Invoke a phase with explicit local run identity when outside GitHub Actions. */
async function stage(args: string[]): Promise<void> {
 await new Promise<void>((done, fail) => {
  const child = spawn(process.execPath, ['--experimental-strip-types', entry, ...args], { stdio: 'inherit', env: {
   ...process.env, GITHUB_RUN_ID: process.env.GITHUB_RUN_ID ?? 'local', GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT ?? '1', GITHUB_OUTPUT: join(work, 'outputs') } });
  child.on('error', fail); child.on('exit', code => code === 0 ? done() : fail(new Error(`Validation ${args[0]} failed: ${code}`)));
 });
}
const replay = process.argv.slice(4);
if (replay.length && (replay.length !== 2 || replay[0] !== '--resolution')) throw new Error('Expected --resolution PATH');
await stage(['prepare', root, prepared, built, ...replay]);
const state = await readJSON(join(prepared, 'prepared.json')) as PreparedState;
const platform = { linux: 'linux-x64', win32: 'windows-x64', darwin: 'macos-x64' }[process.platform as 'linux' | 'win32' | 'darwin'];
if (state.cells.some(cell => cell.platform !== platform)) throw new Error('Local validation requires a host matching every cell; use the reusable matrix workflow for multiple platforms');
await stage(['build', root, prepared, built]);
for (const cell of state.cells) await stage(['native', root, prepared, built, cell.id]);
for (const name of (await readdir(built)).filter(name => name.endsWith('.receipt.json'))) await copyFile(join(built, name), join(receipts, name));
await stage(['aggregate', root, built, output, receipts]);

}
