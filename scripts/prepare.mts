/** Metadata-only App entrypoint. Never executes plugin checkout contents. */
import { GitHub } from '../src/github.mts';
import { installationToken } from '../src/github-app.mts';
import { preparePromotion } from '../src/prepare-metadata.mts';
const { GITHUB_REPOSITORY: repo, PR_NUMBER: number, APP_ID: id, APP_PRIVATE_KEY: key } = process.env;
if (!repo || !number || !/^\d+$/.test(number) || !id || !key) throw new Error('Repository, PR number and App credentials required');
const token = await installationToken(id, key, repo);
const api = new GitHub(token);
try { await preparePromotion(api, repo, Number(number)); }
finally { await api.request('DELETE', '/installation/token'); }
