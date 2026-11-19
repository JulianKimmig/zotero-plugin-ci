/** Admit schema-v2 native fresh lifecycle and predecessor migration observations. */
import assert from 'node:assert/strict';
import { assertPredecessor } from './versions.mts';
import { compareNative } from './native-versions.mts';
import type { PipelineCell, PipelinePlan } from './pipeline-receipts.mts';
/** Require native JSON object properties to be explicitly admitted. */
function object(value: unknown): Record<string, unknown> {
 assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Missing native proof object');
 return value as Record<string, unknown>;
}
/** Compare observed native host spelling numerically, admitting two-component release aliases. */
function hostVersion(value: unknown, expected: string): void {
 assert.ok(typeof value === 'string', 'Missing native runtime version');
 assert.equal(compareNative(value, expected), 0, 'Native runtime version mismatch');
}
/** Match observed host metadata to the frozen runtime version and platform. */
function runtime(value: unknown, version: string, platform: PipelineCell['platform']): void {
 const observed = object(value);
 hostVersion(observed.version, version);
 assert.equal(observed.platform, { 'linux-x64': 'linux', 'windows-x64': 'win32', 'macos-x64': 'darwin' }[platform]);
 assert.equal(observed.arch, 'x64');
}
/** Require one closed native invocation's actual version plus named report assertions. */
function phase(value: unknown, host: string, flags: readonly string[], version?: string, installedSHA256?: string): Record<string, unknown> {
 const invocation = object(value), report = object(invocation.report);
 hostVersion(invocation.version, host);
 for (const flag of flags) assert.equal(report[flag], true, `Missing native proof ${flag}`);
 if (installedSHA256) assert.equal(report.installedSHA256, installedSHA256, 'Installed archive digest mismatch');
 if (version) { assert.equal(report.currentVersion, version); }
 return report;
}
/** Validate full native result and return sanitized, ordered completed phase labels. */
export function nativeProof(plan: PipelinePlan, cell: PipelineCell, value: unknown): string[] {
 const result = object(value); assert.equal(result.schemaVersion, 2, 'Matrix requires schema-v2 native evidence'); assert.equal(result.ok, true);
 const artifacts = object(result.artifacts);
 assert.equal(object(artifacts.current).version, plan.version, 'Native current version mismatch');
 assert.equal(object(artifacts.current).sha256, plan.xpiSHA256, 'Native XPI digest mismatch');
 assert.equal(artifacts.previous ? object(artifacts.previous).sha256 : null, plan.previousSHA256, 'Native predecessor digest mismatch');
 runtime(result.runtime, cell.version, cell.platform);
 const lifecycle = ['permanentInstall', 'nativeDisable', 'nativeReenable', 'nativeUninstall', 'nativeReinstall', 'nativeDataPreserved'];
 const restart = ['permanentInstall', 'automaticStartup', 'nativeRestart', 'nativeDataPreserved'];
 const fresh = object(result.fresh);
 phase(fresh.initialize, cell.version, ['anonymous']);
 const installed = phase(fresh.roundtrip, cell.version, lifecycle, plan.version, plan.xpiSHA256); assert.equal(installed.previousVersion, null);
 phase(fresh.restart, cell.version, restart, plan.version, plan.xpiSHA256);
 const required = ['fresh:initialize', 'fresh:roundtrip', 'fresh:restart'];
 if (plan.previousSHA256) {
  assert.ok(cell.previousRuntime, 'Missing predecessor floor runtime pin');
  const migration = object(result.migration), oldVersion = cell.previousRuntime.version;
  const previousVersion = object(artifacts.previous).version; assert.equal(typeof previousVersion, 'string');
  assertPredecessor(previousVersion as string, plan.version);
  runtime(migration.previousRuntime, oldVersion, cell.platform);
  phase(migration.initialize, oldVersion, ['anonymous']); const seeded = phase(migration.seed, oldVersion, ['seeded', 'permanentInstall'], undefined, plan.previousSHA256); assert.equal(seeded.previousVersion, previousVersion);
  const upgraded = phase(migration.roundtrip, cell.version, [...lifecycle, 'nativeUpgrade'], plan.version, plan.xpiSHA256); assert.equal(upgraded.upgrade, 'proved'); assert.equal(upgraded.previousVersion, previousVersion);
  phase(migration.restart, cell.version, restart, plan.version, plan.xpiSHA256);
  required.push('migration:initialize', 'migration:seed', 'migration:upgrade', 'migration:restart');
 } else assert.equal(result.migration, null, 'Unexpected migration proof');
 const exits = object(result.nativeExit);
 for (const name of required) assert.equal(exits[name], 0, `Missing or failed native exit ${name}`);
 assert.ok(Object.values(exits).every(code => code === 0), 'Failed extra native exit');
 assert.ok(Array.isArray(result.completed), 'Missing native phases');
 assert.equal(new Set(result.completed).size, result.completed.length, 'Duplicate native phases');
 for (const name of required) assert.ok(result.completed.includes(name), `Missing native phase ${name}`);
 return required;
}
