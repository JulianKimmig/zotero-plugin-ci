/** Public configuration and release metadata shared by workflow orchestration and plugin adapters. */
export type Platform = 'linux-x64' | 'windows-x64' | 'macos-x64';
/** Exact downloaded native runtime identity, independent of plugin compatibility. */
export interface RuntimePin { version: string; platform: Platform; url: string; sha256: string; executable: string }
/** Native manifest compatibility bounds, preserving Zotero wildcard syntax. */
export interface Compatibility { min: string; max: string }
/** Stable fields shared by both configuration generations. */
export interface CommonPluginConfig {
  plugin: { id: string; slug: string };
  nodeVersion: string;
  versions: { package: string; lock: string; manifest: string };
  scripts: { validate: string; build: string; native: string };
  bootstrap?: { version: string; commit: string };
}
/** Original exact runtime configuration remains supported without migration. */
export interface LegacyPluginConfig extends CommonPluginConfig { schemaVersion: 1; runtime: RuntimePin & { platform: 'linux-x64' } }
/** Matrix selectors and plugin compatibility are deliberately independent. */
export interface MatrixPluginConfig extends CommonPluginConfig {
  schemaVersion: 2; compatibility: Compatibility; targets: string[]; platforms: Platform[];
}
/** Supported adapter generations, narrowed by schemaVersion. */
export type PluginConfig = LegacyPluginConfig | MatrixPluginConfig;
/** One unique native version/platform, with all selectors that resolved to it. */
export interface ResolvedTarget {
  id: string; selectors: string[]; version: string; platform: Platform; url: string; executable: string; sha256?: string;
}
/** Catalogue capture identity binds replay to the exact observed official tag pages. */
export interface ResolutionSource {
  kind: 'zotero-tags' | 'legacy-pin'; url: string; sha256: string; catalogue?: CataloguePage[];
  platformVersions?: PlatformVersion[]; changelogs?: ChangelogSnapshot[];
}
/** Official current release publication cap for one platform. */
export interface PlatformVersion { platform: Platform; url: string; version: string }
/** Official Markdown history captured verbatim to replay scoped platform notices. */
export interface ChangelogSnapshot { url: string; content: string }
/** Ordered public tag page snapshot with the immutable commit behind each tag. */
export interface CataloguePage { url: string; tags: { name: string; commit: string }[] }
/** Replayable resolution; archive hashes may be attached after download and freezing. */
export interface Resolution { schemaVersion: 1; resolvedAt: string; source: ResolutionSource; targets: ResolvedTarget[] }
/** Complete immutable archive observation; entries map paths to extracted SHA-256 values. */
export interface ArtifactInfo { sha256: string; version: string; files: string[]; entries: Record<string, string>; id: string; compatibility: Compatibility }
/** Zotero update entry carries only actual version-specific downloads and tested compatibility. */
export interface UpdateEntry {
  version: string; update_link: string; update_hash: string;
  applications: { zotero: { strict_min_version: string; strict_max_version: string } };
}
/** A single plugin's cumulative compatible-version history. */
export interface UpdateFeed { addons: Record<string, { updates: UpdateEntry[] }> }
