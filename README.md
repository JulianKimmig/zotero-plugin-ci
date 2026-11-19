# Zotero plugin CI

Reusable GitHub workflows for version preparation, validation and publication of
Zotero plugins. Node 22.17.0 runs the TypeScript entrypoints directly.

Provide a plugin adapter at `.github/zotero-plugin.json` with schema version 1,
plugin ID and slug, exact Node version, package/lock/manifest paths, declared npm
script names, and an HTTPS Linux runtime archive with its SHA256 and executable
path. The version files must agree. The manifest update URL must be
`https://github.com/OWNER/PLUGIN/releases/latest/download/updates.json`.

For example, a new plugin can use this complete adapter. Replace the example
plugin identity and repository URL in its manifest with your own; provide the
declared npm adapters and the three version files. The runtime pin below is the
complete Zotero 10.0.7 Linux x86_64 archive.

```json
{
  "schemaVersion": 1,
  "plugin": { "id": "reading-tools@example.org", "slug": "reading-tools" },
  "nodeVersion": "22.17.0",
  "versions": {
    "package": "package.json",
    "lock": "package-lock.json",
    "manifest": "manifest.json"
  },
  "scripts": {
    "validate": "ci:validate",
    "build": "ci:build",
    "native": "ci:native"
  },
  "runtime": {
    "version": "10.0.7",
    "platform": "linux-x64",
    "url": "https://download.zotero.org/client/release/10.0.7/Zotero-10.0.7_linux-x86_64.tar.xz",
    "sha256": "ddf43b50413f00ea9ba863c7913a4f1350288c1e81b45c2aaf192227b67d9549",
    "executable": "Zotero_linux-x86_64/zotero"
  }
}
```

Set the package version, both lockfile version locations and manifest version
to the same initial seed, for example `0.1.0`. Set `applications.zotero.id` in
the manifest to `reading-tools@example.org`, both compatibility limits to
`10.0.7`, and its update URL to
`https://github.com/example/reading-tools/releases/latest/download/updates.json`
for that example repository. This illustrates the configuration contract; it
is not a ready-made plugin implementation.

The npm adapters accept these contracts:

- `ci:validate`: validate the source and run its tests.
- `ci:build -- --output ABSOLUTE_XPI`: build exactly one production archive.
- `ci:native -- --xpi ABSOLUTE_XPI [--previous ABSOLUTE_XPI]`: validate those
  archive bytes in a dedicated native environment. `ZOTERO_BIN` identifies the
  verified runtime. Without `--previous`, validate a fresh installation.

The script names are configurable. Declare every selected script in the plugin
package. Native checks must use isolated profiles and must fail on failure.

To generate thin caller workflows, select the shared repository and a published,
reviewed 40-character commit. From this helper checkout run:

```sh
node --experimental-strip-types scripts/init-workflows.mts OWNER/SHARED COMMIT /absolute/plugin
```

The generator refuses existing caller files. The shared repository must be
available to GitHub Actions before these callers can run. Every shared revision
upgrade requires regenerating or updating the immutable pins.

Install a GitHub App on the plugin repository with contents write, checks write,
and pull requests read permissions. Configure `RELEASE_APP_ID` and
`RELEASE_APP_PRIVATE_KEY` as repository Actions secrets. Only the metadata-only
prepare job receives them; it never checks out or runs plugin pull-request code.
Require the validation workflow for source changes. After the first release,
require the App's `release-version` check for main promotions. Configure branch protection to permit the App's
version-only develop commits. Keep one develop-to-main promotion open at a time.

Preparation defaults to a patch bump. Use one of `release:minor`, `release:major`
or `release:patch` to select a bump. The App updates only the configured JSON
version files on develop and validates against the published main baseline.
A first migration can configure `bootstrap: {version, commit}` to identify an
immutable source baseline; validation builds it separately for upgrade checks.
That historical source needs an npm `build -- --output ABSOLUTE_XPI` adapter
and matching version files at the current configured paths. It does not need
CI configuration or `ci:*` adapters.
For initial adoption, main may lack CI config only when its exact SHA equals
the declared bootstrap commit, its version files agree with the declared
bootstrap version, and no published stable release exists. Open that first
promotion from the historical main commit. If that main commit has no caller
workflows, GitHub cannot run the new `pull_request_target` preparation workflow
for this first PR. Prepare the first version locally (for example `0.1.1` from
a `0.1.0` baseline), validate the PR head with the CI adapters, and require only
validation for that initial merge. After the first release publishes and its
public downloads verify, enable the App-backed `release-version` requirement.
This one-time onboarding needs no direct bot commit to main. Later promotions
require the normal main configuration, App check and published baseline.
For a new plugin with CI configuration already on main and no stable release
history or bootstrap, the agreed main version is the seed: `0.1.0` becomes
`0.1.1` with the default patch bump. No published baseline is required for
that first promotion. It receives fresh-install native checks. Once a stable
release exists, the published preceding-main baseline is mandatory.

Validation builds the release XPI once, verifies its identity and compatibility,
and passes the same bytes to native checks. Release publication uses a separate
job with contents write permission and no plugin execution. It verifies uploaded
asset bytes before publishing the draft as latest. Retries accept matching
existing tags and assets and reject conflicts. Publication then verifies
anonymous version-specific downloads and the stable latest feed. A readback
failure leaves the release published and fails the job explicitly; preparation
checks public baseline downloads again before permitting the next promotion.

The entrypoints are also available directly:

```sh
node --experimental-strip-types scripts/validate.mts /absolute/plugin /absolute/new-output-directory
node --experimental-strip-types scripts/publish.mts /absolute/accepted-directory
node --experimental-strip-types scripts/prepare.mts
```

Validation requires `GITHUB_REPOSITORY`, `GITHUB_SHA` and a read token in
`GITHUB_TOKEN`. Publication requires the matching repository and commit plus a
contents-write job token. Preparation requires `GITHUB_REPOSITORY`, `PR_NUMBER`,
`APP_ID` and `APP_PRIVATE_KEY`; its installation token is revoked on exit.
