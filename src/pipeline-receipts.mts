/** Strict native evidence admission and complete source/runtime/archive-bound matrix aggregation. */
import assert from 'node:assert/strict';
import { nativeProof } from './pipeline-native-proof.mts';
/** One frozen runtime cell; predecessor pin is required only for a cross-host migration. */
export interface PipelineCell { id: string; version: string; platform: 'linux-x64' | 'windows-x64' | 'macos-x64'; sha256: string; previousRuntime?: { version: string; sha256: string } }
/** Immutable facts transported from the Ubuntu build to every native and aggregate job. */
export interface PipelinePlan { repo: string; commit: string; run: string; metadataSHA256: string; version: string; xpiSHA256: string; previousSHA256: string | null; cells: PipelineCell[] }
/** Accepted evidence envelope; native detail is retained without filesystem/profile paths. */
export interface PipelineReceipt { repo: string; commit: string; run: string; metadataSHA256: string; version: string; xpiSHA256: string; previousSHA256: string | null; cell: PipelineCell; phases: string[]; ok: true }
/** Require a JSON object, returning its unknown-valued properties for explicit admission. */
function object(value: unknown): Record<string, unknown> {
 assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected receipt object');
 return value as Record<string, unknown>;
}
/** Admit native result JSON and return a sanitized envelope bound to all immutable inputs. */
export function bindReceipt(plan: PipelinePlan, cell: PipelineCell, value: unknown): PipelineReceipt {
 const phases = nativeProof(plan, cell, value);
 const { repo, commit, run, metadataSHA256, version, xpiSHA256, previousSHA256 } = plan;
 return { repo, commit, run, metadataSHA256, version, xpiSHA256, previousSHA256, cell, phases, ok: true };
}
/** Reject absent, duplicate, foreign, failed or substituted receipts; return them in plan order. */
export function aggregateReceipts(plan: PipelinePlan, values: readonly unknown[]): PipelineReceipt[] {
 assert.ok(plan.cells.length > 0, 'Empty planned matrix');
 const receipts = new Map<string, PipelineReceipt>();
 for (const value of values) {
  const receipt = object(value), cell = object(receipt.cell);
  assert.equal(typeof cell.id, 'string', 'Receipt cell identity missing');
  const expected = plan.cells.find(candidate => candidate.id === cell.id);
  assert.ok(expected, 'Unexpected receipt cell');
  assert.ok(!receipts.has(expected.id), 'Duplicate receipt cell');
  assert.deepEqual(cell, expected, 'Runtime pin mismatch');
  for (const key of ['repo', 'commit', 'run', 'metadataSHA256', 'version', 'xpiSHA256', 'previousSHA256'] as const) assert.equal(receipt[key], plan[key], `Receipt ${key} mismatch`);
  assert.equal(receipt.ok, true, 'Skipped or failed receipt');
  assert.ok(Array.isArray(receipt.phases) && receipt.phases.length > 0 && receipt.phases.every(phase => typeof phase === 'string' && phase.length > 0), 'Missing receipt phases');
  const phases = ['fresh:initialize', 'fresh:roundtrip', 'fresh:restart', ...(plan.previousSHA256 ? ['migration:initialize', 'migration:seed', 'migration:upgrade', 'migration:restart'] : [])];
  assert.deepEqual(receipt.phases, phases, 'Skipped, duplicate or mismatched native phases');
  receipts.set(expected.id, receipt as unknown as PipelineReceipt);
 }
 assert.equal(new Set(plan.cells.map(cell => cell.id)).size, plan.cells.length, 'Duplicate planned cells');
 return plan.cells.map(cell => { const receipt = receipts.get(cell.id); assert.ok(receipt, `Missing receipt ${cell.id}`); return receipt; });
}
