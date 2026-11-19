/** Generate thin callers with an operator-selected, immutable shared workflow revision. */
/** Return three workflow texts for a concrete repository and verified commit SHA. */
export function callers(repository: string, commit: string): Record<string, string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Shared repository and immutable 40-character commit required');
  const input = `    with:\n      helper_repository: ${repository}\n      helper_commit: ${commit}\n`;
  return {
    'validate.yml': `# Validate plugin pull requests and develop pushes.\nname: Validate\non:\n  pull_request:\n  push:\n    branches: [develop]\npermissions:\n  contents: read\njobs:\n  validate:\n    uses: ${repository}/.github/workflows/validate.yml@${commit}\n${input}`,
    'prepare.yml': `# Privileged metadata-only promotion preparation.\nname: Prepare version\non:\n  pull_request_target:\n    branches: [main]\n    types: [opened, reopened, synchronize, labeled, unlabeled]\npermissions:\n  contents: read\njobs:\n  prepare:\n    if: github.event.pull_request.head.ref == 'develop' && github.event.pull_request.head.repo.full_name == github.repository\n    uses: ${repository}/.github/workflows/prepare.yml@${commit}\n${input}      pr_number: \${{ github.event.pull_request.number }}\n    secrets:\n      APP_ID: \${{ secrets.RELEASE_APP_ID }}\n      APP_PRIVATE_KEY: \${{ secrets.RELEASE_APP_PRIVATE_KEY }}\n`,
    'release.yml': `# Release the exact main commit after validation.\nname: Release\non:\n  push:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  release:\n    permissions:\n      contents: write\n    uses: ${repository}/.github/workflows/release.yml@${commit}\n${input}`,
  };
}
