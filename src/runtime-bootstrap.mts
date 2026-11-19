/** Build a configured historical source baseline in an isolated local clone. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PluginConfig } from './contracts.mts';
import { readVersion } from './versions.mts';
import { inspectArtifact } from './artifact.mts';
import { runScript } from './runtime-adapter.mts';
const exec = promisify(execFile);
/** Clone local source at baseline.commit, validate baseline.version using current config paths, and run historical npm build into output. */
export async function buildBootstrap(root: string, baseline: { commit: string; version: string }, output: string, config: PluginConfig): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(baseline.commit)) throw new Error('Invalid bootstrap commit');
  const temporary = await mkdtemp(join(tmpdir(), 'zotero-bootstrap-'));
  const checkout = join(temporary, 'source');
  await exec('git', ['clone', '--no-hardlinks', '--no-checkout', '--', root, checkout]);
  await exec('git', ['-C', checkout, 'checkout', '--detach', baseline.commit]);
  if (await readVersion(checkout, config) !== baseline.version) throw new Error('Bootstrap source version mismatch');
  await exec('npm', ['ci'], { cwd: checkout, maxBuffer: 8 * 1024 * 1024 });
  await runScript(checkout, 'build', ['--output', output]);
  await inspectArtifact(output, config, baseline.version);
}
