/** Numeric Zotero release ordering, selectors and independent manifest compatibility. */
import assert from 'node:assert/strict';
import { fields, text } from './validation.mts';
import type { Compatibility } from './contracts.mts';

/** Parse stable two/three-component native versions without rewriting names. @param value Release spelling. @returns Normalized numeric comparison tuple. */
export function nativeParts(value: string): number[] {
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/, 'Expected stable native version');
  const parts = value.split('.').map(Number);
  assert.ok(parts.every(Number.isSafeInteger), 'Unsafe native version');
  return parts.length === 2 ? [...parts, 0] : parts;
}

/** Compare native releases numerically. @param left First spelling. @param right Second spelling. @returns Signed ordering. */
export function compareNative(left: string, right: string): number {
  const a = nativeParts(left), b = nativeParts(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Validate exact or major/minor latest selectors. @param value External selector. @returns Original admitted selector. */
export function targetSelector(value: unknown): string {
  const selector = text(value);
  if (/^(0|[1-9]\d*)\.(?:(0|[1-9]\d*)\.latest|latest\.latest)$/.test(selector)) {
    assert.ok(selector.split('.').filter(part => part !== 'latest').map(Number).every(Number.isSafeInteger));
  } else nativeParts(selector);
  return selector;
}

/** Determine whether an admitted selector can select a release. @param selector Exact or latest selector. @param version Stable native version. @returns Matching status. */
export function matchesSelector(selector: string, version: string): boolean {
  targetSelector(selector);
  if (!selector.includes('latest')) return compareNative(selector, version) === 0;
  const parts = selector.split('.'), actual = nativeParts(version);
  return Number(parts[0]) === actual[0] && (parts[1] === 'latest' || Number(parts[1]) === actual[1]);
}

/** Parse manifest compatibility including trailing max wildcards. @param value Bounds object. @returns Detached validated bounds. */
export function parseCompatibility(value: unknown): Compatibility {
  const raw = fields(value, ['min', 'max']), min = text(raw.min), max = text(raw.max), lower = nativeParts(min);
  let upper: number[];
  if (max.includes('*')) {
    assert.match(max, /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?\.\*$/, 'Invalid compatibility maximum');
    const prefix = max.split('.').slice(0, -1).map(Number);
    assert.ok(prefix.every(Number.isSafeInteger), 'Unsafe compatibility component');
    upper = [...prefix, ...Array<number>(3 - prefix.length).fill(Infinity)];
  } else upper = nativeParts(max);
  const index = lower.findIndex((part, i) => part !== upper[i]);
  assert.ok(index < 0 || lower[index] < upper[index], 'Reversed compatibility bounds');
  return { min, max };
}
