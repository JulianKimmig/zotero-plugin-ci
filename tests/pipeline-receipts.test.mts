/** Behavioral receipt admission tests for complete, byte-bound runtime matrices. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateReceipts, bindReceipt, type PipelinePlan } from '../src/pipeline-receipts.mts';
import { nativeResult } from './native-result-fixture.mts';
const digest = 'a'.repeat(64);
const plan: PipelinePlan = { repo: 'owner/plugin', commit: 'b'.repeat(40), run: '123:1', metadataSHA256: 'f'.repeat(64), version: '1.0.0', xpiSHA256: digest,
  previousSHA256: null, cells: [{ id: 'stable-linux-x64', version: '10.0.7', platform: 'linux-x64', sha256: digest }] };
/** Return actual adapter-shaped evidence for a completed Linux native invocation. */
function evidence(): Record<string, unknown> { return nativeResult(digest); }
test('binds native evidence and accepts exactly the complete planned matrix', () => {
 const receipt = bindReceipt(plan, plan.cells[0]!, evidence());
 assert.deepEqual(aggregateReceipts(plan, [receipt]), [receipt]);
});
test('missing and duplicate receipts fail closed', () => {
 const receipt = bindReceipt(plan, plan.cells[0]!, evidence());
 assert.throws(() => aggregateReceipts(plan, []), /Missing/);
 assert.throws(() => aggregateReceipts(plan, [receipt, receipt]), /Duplicate/);
});
test('skipped, wrong runtime and failed native exits never become accepted receipts', () => {
 for (const change of [{ ok: false }, { runtime: { version: '10.0.8', platform: 'linux', arch: 'x64' } }, { completed: [] }, { fresh: null }, { artifacts: { current: { sha256: 'c'.repeat(64) } } }]) {
  assert.throws(() => bindReceipt(plan, plan.cells[0]!, { ...evidence(), ...change }));
 }
});
test('source, runtime pin, predecessor and archive substitutions are rejected on aggregation', () => {
 const receipt = bindReceipt(plan, plan.cells[0]!, evidence());
 for (const change of [{ commit: 'c'.repeat(40) }, { run: '123:2' }, { xpiSHA256: 'c'.repeat(64) }, { previousSHA256: digest }, { cell: { ...receipt.cell, sha256: 'c'.repeat(64) } }, { cell: { ...receipt.cell, id: 'unknown' } }]) {
  assert.throws(() => aggregateReceipts(plan, [{ ...receipt, ...change }]));
 }
});
test('predecessor migration requires its expected runtime observation', () => {
 const migration: PipelinePlan = { ...plan, previousSHA256: digest, cells: [{ ...plan.cells[0]!, previousRuntime: { version: '9.0.0', sha256: 'd'.repeat(64) } }] };
 assert.throws(() => bindReceipt(migration, migration.cells[0]!, evidence()));
 assert.doesNotThrow(() => bindReceipt(migration, migration.cells[0]!, nativeResult(digest, digest)));
});
test('a receipt from a different resolution snapshot cannot be reused', () => {
 const bound = { ...plan, metadataSHA256: 'd'.repeat(64) };
 const receipt = bindReceipt(bound, bound.cells[0]!, evidence());
 assert.throws(() => aggregateReceipts({ ...bound, metadataSHA256: 'e'.repeat(64) }, [receipt]));
});
test('fresh lifecycle cannot omit disable or automatic restart proof', () => {
 for (const key of ['nativeDisable', 'nativeReenable', 'nativeUninstall', 'nativeReinstall', 'nativeDataPreserved']) {
  const result = evidence(); const fresh = result.fresh as { roundtrip: { report: Record<string, unknown> } };
  fresh.roundtrip.report[key] = false; assert.throws(() => bindReceipt(plan, plan.cells[0]!, result));
 }
 const result = evidence(); const fresh = result.fresh as { restart: { report: Record<string, unknown> } };
 fresh.restart.report.automaticStartup = false; assert.throws(() => bindReceipt(plan, plan.cells[0]!, result));
});
test('receipt envelopes omit unrelated build/config fields and reject skipped phase substitution', () => {
 const receipt = bindReceipt({ ...plan, privatePath: '/private/work' } as PipelinePlan, plan.cells[0]!, evidence());
 assert.equal(Reflect.get(receipt, 'privatePath'), undefined);
 assert.throws(() => aggregateReceipts(plan, [{ ...receipt, phases: ['skipped'] }]));
});
test('every required native exit must be present and zero, including extra reported exits', () => {
 for (const nativeExit of [undefined, {}, { 'fresh:initialize': 1 }, { 'fresh:initialize': 0 }]) {
  assert.throws(() => bindReceipt(plan, plan.cells[0]!, { ...evidence(), nativeExit }));
 }
 const valid = evidence();
 assert.throws(() => bindReceipt(plan, plan.cells[0]!, { ...valid, nativeExit: { ...(valid.nativeExit as object), unexpected: 1 } }));
});
test('migration rejects same-version predecessors and phase results from the wrong host', () => {
 const migration: PipelinePlan = { ...plan, previousSHA256: digest, cells: [{ ...plan.cells[0]!, previousRuntime: { version: '9.0.0', sha256: 'd'.repeat(64) } }] };
 const equal = nativeResult(digest, digest);
 (equal.artifacts as { previous: { version: string } }).previous.version = plan.version;
 assert.throws(() => bindReceipt(migration, migration.cells[0]!, equal));
 const wrong = nativeResult(digest, digest);
 (wrong.migration as { seed: { version: string } }).seed.version = '10.0.7';
 assert.throws(() => bindReceipt(migration, migration.cells[0]!, wrong));
});
test('equivalent two- and three-component host versions are accepted throughout both journeys', () => {
 const matrix: PipelinePlan = { ...plan, previousSHA256: digest, cells: [{ ...plan.cells[0]!, version: '10.1', previousRuntime: { version: '9.0', sha256: 'd'.repeat(64) } }] };
 const result = nativeResult(digest, digest);
 const observed = result as { runtime: { version: string }; fresh: Record<string, { version: string }>; migration: Record<string, { version: string }> };
 observed.runtime.version = '10.1.0';
 for (const step of Object.values(observed.fresh)) step.version = '10.1.0';
 for (const name of ['roundtrip', 'restart']) observed.migration[name].version = '10.1.0';
 assert.doesNotThrow(() => bindReceipt(matrix, matrix.cells[0]!, result));
 observed.fresh.restart.version = '10.1.1';
 assert.throws(() => bindReceipt(matrix, matrix.cells[0]!, result));
});
test('all installed archive observations require exact current or predecessor digests', () => {
 const previous = 'b'.repeat(64);
 const matrix: PipelinePlan = { ...plan, previousSHA256: previous, cells: [{ ...plan.cells[0]!, previousRuntime: { version: '9.0.0', sha256: 'd'.repeat(64) } }] };
 for (const [journey, name] of [['fresh', 'roundtrip'], ['fresh', 'restart'], ['migration', 'seed'], ['migration', 'roundtrip'], ['migration', 'restart']]) {
  for (const invalid of [undefined, 'c'.repeat(64), journey === 'migration' && name === 'seed' ? digest : previous]) {
   const result = nativeResult(digest, previous);
   const report = (result[journey] as Record<string, { report: Record<string, unknown> }>)[name].report;
   report.installedSHA256 = invalid;
   assert.throws(() => bindReceipt(matrix, matrix.cells[0]!, result), `${journey}.${name} admitted an invalid installed archive`);
  }
 }
 assert.doesNotThrow(() => bindReceipt(matrix, matrix.cells[0]!, nativeResult(digest, previous)));
});
test('a second plugin needs no preference pane or graph authority assertions', () => {
 const second: PipelinePlan = { ...plan, repo: 'example/citation-lantern', previousSHA256: 'b'.repeat(64), cells: [{ ...plan.cells[0]!, previousRuntime: { version: '9.0.0', sha256: 'd'.repeat(64) } }] };
 const result = nativeResult(digest, second.previousSHA256);
 for (const name of ['fresh', 'migration']) {
  for (const invocation of Object.values(result[name] as Record<string, unknown>)) {
   if (invocation && typeof invocation === 'object' && Reflect.get(invocation, 'report')) {
    const report = Reflect.get(invocation, 'report') as Record<string, unknown>;
    delete report.preferenceRegistrationCount; delete report.exactAuthority;
   }
  }
 }
 assert.doesNotThrow(() => bindReceipt(second, second.cells[0]!, result));
 const fresh = result.fresh as { restart: { report: Record<string, unknown> } };
 fresh.restart.report.installedSHA256 = 'c'.repeat(64);
 assert.throws(() => bindReceipt(second, second.cells[0]!, result), /Installed archive digest mismatch/);
});
