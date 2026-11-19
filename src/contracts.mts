/** Public configuration and release metadata shared by workflow orchestration and plugin adapters. */
export interface PluginConfig {
  schemaVersion: 1;
  plugin: { id: string; slug: string };
  nodeVersion: string;
  versions: { package: string; lock: string; manifest: string };
  scripts: { validate: string; build: string; native: string };
  runtime: { version: string; platform: 'linux-x64'; url: string; sha256: string; executable: string };
  bootstrap?: { version: string; commit: string };
}
/** Complete immutable archive observation; entries map paths to extracted SHA-256 values. */
export interface ArtifactInfo { sha256: string; version: string; files: string[]; entries: Record<string, string>; id: string }
/** Zotero update entry carries only actual version-specific downloads and tested compatibility. */
export interface UpdateEntry {
  version: string; update_link: string; update_hash: string;
  applications: { zotero: { strict_min_version: string; strict_max_version: string } };
}
/** A single plugin's cumulative compatible-version history. */
export interface UpdateFeed { addons: Record<string, { updates: UpdateEntry[] }> }
