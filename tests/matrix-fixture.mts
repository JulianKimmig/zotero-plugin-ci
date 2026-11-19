/** Real configuration fixture for matrix admission and artifact compatibility tests. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './core-fixture.mts';
import { loadConfig } from '../src/config.mts';
import type { MatrixPluginConfig } from '../src/contracts.mts';

/** Write a v2 configuration over a real plugin. @param changes Configuration overrides. @returns Root and admitted matrix configuration. */
export async function matrixFixture(changes: Record<string, unknown> = {}): Promise<{root: string; config: MatrixPluginConfig}> {
  const root = await fixture(), path = join(root, '.github/zotero-plugin.json');
  const { runtime: _runtime, ...base } = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...base, schemaVersion: 2, compatibility: { min: '10.0', max: '10.*' },
    targets: ['10.latest.latest'], platforms: ['linux-x64', 'windows-x64', 'macos-x64'], ...changes }));
  const config = await loadConfig(root);
  if (config.schemaVersion !== 2) throw new Error('Expected matrix config');
  return { root, config };
}
