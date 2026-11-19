/** Informational matrix comparison is deliberately separate from receipt acceptance. */
/** Render every planned cell, reported journey completion, diagnostics links and job outcomes. */
export function matrixSummary(cells: readonly { id: string; version: string; platform: string; selectors: string[] }[], receipts: readonly unknown[], outcomes: Record<string, string>, diagnosticsURL?: string): string {
 /** Escape untrusted labels before inclusion in a Markdown table. */
 const safe = (value: string): string => value.replace(/[|\r\n<>`]/g, ' ');
 const rows = ['# Native runtime comparison', '', ...Object.entries(outcomes).map(([job, result]) => `${safe(job)}: ${safe(result)}`), '',
 'Receipt phase reports are informational; aggregate determines acceptance.', '',
 '| Selectors | Runtime | Platform | Evidence | Fresh lifecycle | Migration | Diagnostics |', '| --- | --- | --- | --- | --- | --- | --- |'];
 for (const cell of cells) {
  const matches = receipts.filter(value => value && typeof value === 'object' && Reflect.get(value, 'cell') && Reflect.get(Reflect.get(value, 'cell') as object, 'id') === cell.id);
  const status = matches.length > 1 ? 'Duplicate receipts' : matches.length === 1 ? 'Received; aggregate determines acceptance' : 'Missing / failed / skipped';
  const receipt = matches.length === 1 ? matches[0] as Record<string, unknown> : undefined;
  const phases: unknown[] = receipt?.ok === true && Array.isArray(receipt.phases) ? receipt.phases : [];
  const fresh = ['fresh:initialize', 'fresh:roundtrip', 'fresh:restart'].every(phase => phases.includes(phase)) ? 'Reported complete' : 'Unavailable';
  const migration = ['migration:initialize', 'migration:seed', 'migration:upgrade', 'migration:restart'].every(phase => phases.includes(phase)) ? 'Reported complete' : 'Unavailable';
  const diagnostics = diagnosticsURL ? `[${safe(`diagnostics-${cell.id}`)}](${diagnosticsURL})` : 'Unavailable';
  rows.push(`| ${safe(cell.selectors.join(', '))} | ${safe(cell.version)} | ${safe(cell.platform)} | ${status} | ${fresh} | ${migration} | ${diagnostics} |`);
 }
 if (!cells.length) rows.push('', 'No matrix was prepared. Schema-v1 runs retain legacy validation semantics.');
 return rows.join('\n') + '\n';
}
