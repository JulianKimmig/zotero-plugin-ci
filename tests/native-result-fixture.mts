/** Sanitized representative schema-v2 native evidence used only as receipt admission input. */
export function nativeResult(currentSHA256: string, previousSHA256: string | null = null, version = '1.0.0'): Record<string, unknown> {
 const flags = { installedSHA256: currentSHA256, currentVersion: version, permanentInstall: true, nativeDisable: true, nativeReenable: true, nativeUninstall: true,
 nativeReinstall: true, exactAuthority: true, nativeDataPreserved: true, automaticStartup: true, nativeRestart: true, preferenceRegistrationCount: 1 };
 const journey = { initialize: { version: '10.0.7', report: { anonymous: true } }, roundtrip: { version: '10.0.7', report: { ...flags, previousVersion: null } }, restart: { version: '10.0.7', report: flags } };
 const completed = ['fresh:initialize', 'fresh:roundtrip', 'fresh:restart', ...(previousSHA256 ? ['migration:initialize', 'migration:seed', 'migration:upgrade', 'migration:restart'] : [])];
 return { nativeExit: Object.fromEntries(completed.map(phase => [phase, 0])), schemaVersion: 2, ok: true, artifacts: { current: { sha256: currentSHA256, version }, previous: previousSHA256 ? { sha256: previousSHA256, version: '0.9.0' } : null },
 completed: ['fresh:initialize', 'fresh:roundtrip', 'fresh:restart', ...(previousSHA256 ? ['migration:initialize', 'migration:seed', 'migration:upgrade', 'migration:restart'] : [])],
 runtime: { version: '10.0.7', platform: 'linux', arch: 'x64' }, fresh: journey,
 migration: previousSHA256 ? { ...journey, restart: { version: '10.0.7', report: { ...flags } }, previousRuntime: { version: '9.0.0', platform: 'linux', arch: 'x64' }, initialize: { version: '9.0.0', report: { anonymous: true } },
 seed: { version: '9.0.0', report: { installedSHA256: previousSHA256, seeded: true, permanentInstall: true, previousVersion: '0.9.0' } }, roundtrip: { version: '10.0.7', report: { ...flags, nativeUpgrade: true, upgrade: 'proved', previousVersion: '0.9.0' } } } : null };
}
