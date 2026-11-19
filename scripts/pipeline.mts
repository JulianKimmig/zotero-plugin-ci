/** Read-only stage CLI: prepare, build, native and aggregate share only frozen files and receipts. */
import assert from 'node:assert/strict';
import { appendFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.mts';
import { installRuntime } from '../src/runtime.mts';
import { runScript } from '../src/runtime-adapter.mts';
import { prepareStage, type PreparedState } from '../src/pipeline-prepare.mts';
import { aggregateStage, buildStage, snapshotHash, type BuildState } from '../src/pipeline-stages.mts';
import { bindReceipt } from '../src/pipeline-receipts.mts';
import { hashFile, readJSON, readReceipts, writeJSON } from '../src/pipeline-io.mts';
const [stage, rootArg = '.', inputArg = '.ci-prepared', outputArg = '.ci-build', cellID, resolutionFlag, resolutionPath] = process.argv.slice(2);
const root = resolve(rootArg), input = resolve(inputArg), output = resolve(outputArg);
const { GITHUB_REPOSITORY: repo, GITHUB_SHA: commit, GITHUB_RUN_ID: runID, GITHUB_RUN_ATTEMPT: attempt } = process.env;
assert.ok(repo && commit && runID && attempt, 'Workflow source/run identity required');
assert.match(commit, /^[a-f0-9]{40}$/); assert.match(repo, /^[\w.-]+\/[\w.-]+$/);
const identity = { repo, commit, run: `${runID}:${attempt}` };
/** Admit transported state against this exact workflow source and current consumer configuration. */
async function state<T extends PreparedState | BuildState>(directory: string, name: string): Promise<T> {
 const value = await readJSON(join(directory, name)) as T;
 for (const key of ['repo', 'commit', 'run'] as const) assert.equal(value[key], identity[key], `Workflow ${key} mismatch`);
 assert.equal(snapshotHash(value.config), snapshotHash(await loadConfig(root)), 'Frozen configuration mismatch');
 return value;
}
if (stage === 'prepare') {
 if (cellID && cellID !== '--resolution') throw new Error('Expected --resolution PATH');
 const replay = cellID === '--resolution' ? resolve(resolutionFlag!) : resolutionFlag === '--resolution' ? resolve(resolutionPath!) : undefined;
 const prepared = await prepareStage(root, input, identity, replay);
 const matrix = { include: prepared.cells.map(cell => ({ id: cell.id, platform: cell.platform,
  runner: { 'linux-x64': 'ubuntu-24.04', 'windows-x64': 'windows-2022', 'macos-x64': 'macos-15-intel' }[cell.platform] })) };
 assert.ok(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT required');
 await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nnode_version=${prepared.config.nodeVersion}\n`);
} else if (stage === 'build') {
 const prepared = await state<PreparedState>(input, 'prepared.json');
 await mkdir(output, { recursive: false });
 if (prepared.previousSHA256) assert.equal(await hashFile(join(input, 'previous.xpi')), prepared.previousSHA256);
 const artifact = await buildStage(root, output, prepared.config, prepared.version, repo);
 const built: BuildState = { ...identity, metadataSHA256: snapshotHash(prepared), config: prepared.config, version: prepared.version, cells: prepared.cells,
  resolution: prepared.resolution, previousFeed: prepared.previousFeed, previousSHA256: prepared.previousSHA256, xpiSHA256: artifact.sha256, artifact,
  xpi: `${prepared.config.plugin.slug}-${prepared.version}.xpi` };
 await writeJSON(join(output, 'build.json'), built);
} else if (stage === 'native') {
 const prepared = await state<PreparedState>(input, 'prepared.json');
 const built = await state<BuildState>(output, 'build.json');
 assert.equal(built.metadataSHA256, snapshotHash(prepared), 'Prepared resolution metadata mismatch');
 assert.deepEqual(built.cells, prepared.cells, 'Prepared matrix mismatch');
 const cell = built.cells.find(item => item.id === cellID); assert.ok(cell, 'Unknown native cell');
 assert.equal(await hashFile(join(output, built.xpi)), built.xpiSHA256);
 if (built.previousSHA256) assert.equal(await hashFile(join(input, 'previous.xpi')), built.previousSHA256);
 const pin = prepared.runtimes[`${cell.version}-${cell.platform}`]; assert.ok(pin && pin.sha256 === cell.sha256);
 const scratch = resolve(process.env.RUNNER_TEMP ?? output, `native-${cell.id}`); await mkdir(scratch, { recursive: false });
 const executable = await installRuntime(pin, join(scratch, 'runtime'), join(input, 'runtimes', cell.platform, pin.archive));
 let previousExecutable: string | undefined;
 if (cell.previousRuntime) {
  const old = prepared.runtimes[`${cell.previousRuntime.version}-${cell.platform}`]; assert.ok(old && old.sha256 === cell.previousRuntime.sha256);
  previousExecutable = await installRuntime(old, join(scratch, 'previous-runtime'), join(input, 'runtimes', cell.platform, old.archive));
 }
 const result = join(scratch, 'result.json');
 const diagnostics = join(resolve(process.env.RUNNER_TEMP ?? output), 'diagnostics', `native-${cell.id}`);
 await mkdir(diagnostics, { recursive: true });
 await runScript(root, prepared.config.scripts.native, ['--xpi', join(output, built.xpi), ...(built.previousSHA256 ? ['--previous', join(input, 'previous.xpi')] : []), '--result', result,
  ...(previousExecutable ? ['--previous-runtime', previousExecutable] : [])], { ...process.env, ZOTERO_BIN: executable, ZOTERO_VERSION: cell.version, ZOTERO_CI_DIAGNOSTICS: diagnostics,
  ...(cell.previousRuntime ? { ZOTERO_PREVIOUS_VERSION: cell.previousRuntime.version } : {}) });
 assert.equal(await hashFile(join(output, built.xpi)), built.xpiSHA256, 'Native modified current XPI');
 if (built.previousSHA256) assert.equal(await hashFile(join(input, 'previous.xpi')), built.previousSHA256, 'Native modified predecessor XPI');
 await writeJSON(join(output, `${cell.id}.receipt.json`), bindReceipt(built, cell, await readJSON(result)));
} else if (stage === 'aggregate') {
 const built = await state<BuildState>(input, 'build.json');
 const receiptRoot = resolve(cellID ?? 'receipts');
 const receipts = await readReceipts(receiptRoot);
 await aggregateStage(built, input, receipts, output);
} else throw new Error('Expected stage prepare, build, native or aggregate');
