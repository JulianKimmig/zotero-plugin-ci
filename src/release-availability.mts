/** Capture public platform publication caps and scoped official release-history availability. */
import assert from 'node:assert/strict';
import { fields, text } from './validation.mts';
import { platform } from './config.mts';
import { compareNative, nativeParts } from './native-versions.mts';
import type { ChangelogSnapshot, Platform, PlatformVersion } from './contracts.mts';

/** Official Markdown histories, linked from the rendered Zotero documentation. */
const HISTORY_ROOT = 'https://raw.githubusercontent.com/zotero/zotero-docs/main/content/';
/** A release heading and its optional explicit platform-only notice. */
interface ReleaseNotice { version: string; only?: Platform }

/** Derive the official release-channel publication endpoint. @param os Supported platform. @returns Credential-free official URL. */
export function platformVersionURL(os: Platform): string {
  const names: Record<Platform, string> = { 'linux-x64': 'linux-x86_64', 'windows-x64': 'win-x64', 'macos-x64': 'mac' };
  return `https://www.zotero.org/download/client/version?channel=release&platform=${names[os]}`;
}

/** Parse only level-two release headings and standalone first-paragraph platform restrictions. @param content Official Markdown snapshot. @returns Scoped notices. */
function releases(content: string): ReleaseNotice[] {
  const result: ReleaseNotice[] = [];
  for (const section of content.split(/^## /m).slice(1)) {
    const heading = section.match(/^Changes in (\d+\.\d+(?:\.\d+)?)(?: \([^\r\n]+\))?[ \t]*(?:\r?\n|$)/);
    if (!heading) continue;
    const version = heading[1]; nativeParts(version);
    const body = section.slice(heading[0].length), first = body.trimStart().split(/\r?\n/)[0];
    const notice = first.match(/^\*Zotero for (Mac|Windows|Linux) only\*$/);
    const anyNotice = body.match(/^.*Zotero for .* only.*$/gm) ?? [];
    assert.ok(anyNotice.length === 0 || (notice && anyNotice.length === 1 && anyNotice[0].trim() === first), `Unrecognized platform notice in ${version}`);
    const names: Record<string, Platform> = { Mac: 'macos-x64', Windows: 'windows-x64', Linux: 'linux-x64' };
    result.push(notice ? { version, only: names[notice[1]] } : { version });
  }
  assert.ok(result.length > 0, 'Official changelog has no recognized release headings');
  return result;
}

/** Follow a single explicitly linked historical changelog without accepting arbitrary paths. @param content Official Markdown. @returns Official historical URL or undefined. */
function olderHistory(content: string): string | undefined {
  const links = [...content.matchAll(/^\[View the (\d+\.\d+) changelog\]\((\d+\.\d+)_changelog\)\s*$/gm)];
  assert.ok(links.length <= 1, 'Ambiguous older changelog link');
  if (!links.length) return undefined;
  assert.equal(links[0][1], links[0][2]);
  return `${HISTORY_ROOT}${links[0][1]}_changelog.md`;
}

/** Capture platform caps and the complete linked history through every minor of the minimum requested major. @param request Public HTTP transport. @param platforms Requested platforms. @param majors Requested native major numbers. @returns Persistable availability evidence. */
export async function captureAvailability(request: typeof fetch, platforms: Platform[], majors: number[]): Promise<{ platformVersions: PlatformVersion[]; changelogs: ChangelogSnapshot[] }> {
  const platformVersions: PlatformVersion[] = [];
  for (const os of platforms) {
    const url = platformVersionURL(os), response = await request(url, { redirect: 'error' });
    assert.ok(response.ok, `Platform publication metadata HTTP ${response.status} for ${os}`);
    const version = (await response.text()).trim(); nativeParts(version);
    platformVersions.push({ platform: os, url, version });
  }
  const changelogs: ChangelogSnapshot[] = [], covered = new Set<number>(), seen = new Set<string>();
  const minimumMajor = Math.min(...majors);
  let url: string | undefined = `${HISTORY_ROOT}changelog.md`;
  while (url) {
    assert.ok(!seen.has(url), 'Repeated official changelog'); seen.add(url);
    const response: Response = await request(url, { redirect: 'error' });
    assert.ok(response.ok, `Official changelog HTTP ${response.status}: ${url}`);
    const content = await response.text();
    for (const release of releases(content)) covered.add(nativeParts(release.version)[0]);
    changelogs.push({ url, content });
    const next = olderHistory(content);
    url = next && Number(next.match(/\/(\d+)\.\d+_changelog\.md$/)?.[1]) >= minimumMajor ? next : undefined;
  }
  assert.ok(majors.every(major => covered.has(major)), 'Official history does not cover requested native majors');
  return { platformVersions, changelogs };
}

/** Validate detached availability snapshots and their fixed official source identities. @param caps External platform observations. @param histories External Markdown histories. @param platforms Configured platform list. @returns Admitted evidence. */
export function availabilitySnapshot(caps: unknown, histories: unknown, platforms: Platform[]): { platformVersions: PlatformVersion[]; changelogs: ChangelogSnapshot[] } {
  assert.ok(Array.isArray(caps) && caps.length === platforms.length, 'Missing platform publication metadata');
  const platformVersions = caps.map(value => {
    const raw = fields(value, ['platform', 'url', 'version']), os = platform(raw.platform);
    const url = text(raw.url), version = text(raw.version); nativeParts(version);
    assert.ok(platforms.includes(os)); assert.equal(url, platformVersionURL(os));
    return { platform: os, url, version };
  });
  assert.equal(new Set(platformVersions.map(cap => cap.platform)).size, platforms.length);
  assert.ok(Array.isArray(histories) && histories.length > 0, 'Missing official release histories');
  let expected: string | undefined = `${HISTORY_ROOT}changelog.md`;
  const changelogs = histories.map(value => {
    const raw = fields(value, ['url', 'content']), url = text(raw.url), content = text(raw.content);
    assert.equal(url, expected, 'Unexpected official changelog source'); releases(content); expected = olderHistory(content);
    return { url, content };
  });
  return { platformVersions, changelogs };
}

/** Require captured publication and history evidence before probing a platform archive. @param version Candidate spelling. @param os Requested platform. @param evidence Persisted caps/history. @returns False only for an explicit cap or platform-only notice. */
export function platformEligible(version: string, os: Platform, evidence: { platformVersions: PlatformVersion[]; changelogs: ChangelogSnapshot[] }): boolean {
  const cap = evidence.platformVersions.find(item => item.platform === os); assert.ok(cap, `Missing publication cap for ${os}`);
  if (compareNative(version, cap.version) > 0) return false;
  const notices = evidence.changelogs.flatMap(item => releases(item.content)).filter(item => compareNative(item.version, version) === 0);
  assert.ok(notices.length > 0, `No official release-history evidence for ${version}/${os}; inspect the captured changelog before retrying`);
  assert.ok(notices.every(notice => notice.only === notices[0].only), `Conflicting platform metadata for ${version}`);
  return !notices[0].only || notices[0].only === os;
}

/** Choose published download spelling before probing an admitted release's archive. @param version Numerically matched tag. @param os Requested platform. @param evidence Captured official caps/history. @returns Matching platform-cap spelling, otherwise the historical release heading spelling. */
export function releaseSpelling(version: string, os: Platform, evidence: { platformVersions: PlatformVersion[]; changelogs: ChangelogSnapshot[] }): string {
  const cap = evidence.platformVersions.find(item => item.platform === os); assert.ok(cap, `Missing publication cap for ${os}`);
  if (compareNative(version, cap.version) === 0) return cap.version;
  const release = evidence.changelogs.flatMap(item => releases(item.content)).find(item => compareNative(item.version, version) === 0);
  assert.ok(release, `Missing official release spelling for ${version}/${os}`);
  return release.version;
}
