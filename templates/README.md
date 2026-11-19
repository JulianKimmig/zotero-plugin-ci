# Pinned caller templates

Run `scripts/init-workflows.mts OWNER/SHARED COMMIT PLUGIN_ROOT` from the helper
checkout to materialize validate, prepare and release callers. The renderer in
`src/github-callers.mts` requires a full immutable commit and produces complete
YAML with explicit permissions and named App secret mappings. This avoids
shipping callable workflows with invented repository names or commit pins.
