/** App authentication tests use ephemeral generated keys and fake external HTTP. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { appJwt } from '../src/github-app.mts';
test('JWT is signed and short-lived', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = appJwt('123', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 1000);
  const [header, payload, signature] = jwt.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature!, 'base64url')), true);
  assert.deepEqual(JSON.parse(Buffer.from(payload!, 'base64url').toString()), { iat: 940, exp: 1540, iss: '123' });
});
