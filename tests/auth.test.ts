import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TokenManager } from '../src/pathao/auth.js';
import { MemoryTokenStore } from '../src/pathao/tokenStore.js';
import { createFetchStub, testCredentials, tokenResponse } from './helpers.js';

const ISSUE = 'POST /aladdin/api/v1/issue-token';

function makeManager(
  routes: Parameters<typeof createFetchStub>[0],
  options: { now?: () => number; store?: MemoryTokenStore } = {},
) {
  const { fetchImpl, calls } = createFetchStub(routes);
  const store = options.store ?? new MemoryTokenStore();
  const manager = new TokenManager({
    credentials: testCredentials,
    store,
    fetchImpl,
    timeoutMs: 5000,
    leewaySeconds: 300,
    ...(options.now ? { now: options.now } : {}),
  });
  return { manager, calls, store };
}

describe('TokenManager', () => {
  it('issues a token with the password grant and caches it', async () => {
    const { manager, calls } = makeManager({ [ISSUE]: tokenResponse('access-1') });

    assert.equal(await manager.getAccessToken(), 'access-1');
    assert.equal(await manager.getAccessToken(), 'access-1');

    assert.equal(calls.length, 1, 'second call should be served from cache');
    assert.deepEqual(calls[0]!.body, {
      client_id: 'test-client',
      client_secret: 'test-secret',
      grant_type: 'password',
      username: 'test@pathao.com',
      password: 'lovePathao',
    });
  });

  it('persists the token with an absolute expiry', async () => {
    const now = () => 1_700_000_000_000;
    const { manager, store } = makeManager({ [ISSUE]: tokenResponse('access-1', 'refresh-1') }, { now });

    await manager.getAccessToken();

    assert.deepEqual(store.read(), {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      expiresAt: 1_700_000_000_000 + 432_000_000,
    });
  });

  it('uses the refresh_token grant when the cached token is near expiry', async () => {
    const store = new MemoryTokenStore();
    store.write({
      accessToken: 'stale',
      refreshToken: 'refresh-abc',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000, // inside the 300s leeway
    });

    const { manager, calls } = makeManager({ [ISSUE]: tokenResponse('access-2', 'refresh-2') }, { store });

    assert.equal(await manager.getAccessToken(), 'access-2');
    assert.deepEqual(calls[0]!.body, {
      client_id: 'test-client',
      client_secret: 'test-secret',
      grant_type: 'refresh_token',
      refresh_token: 'refresh-abc',
    });
  });

  it('falls back to the password grant when the refresh token is rejected', async () => {
    const store = new MemoryTokenStore();
    store.write({
      accessToken: 'stale',
      refreshToken: 'revoked',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1000,
    });

    const { manager, calls } = makeManager(
      {
        [ISSUE]: [
          { status: 401, body: { message: 'Unauthenticated.' } },
          tokenResponse('access-3'),
        ],
      },
      { store },
    );

    assert.equal(await manager.getAccessToken(), 'access-3');
    assert.equal(calls.length, 2);
    assert.equal((calls[0]!.body as { grant_type: string }).grant_type, 'refresh_token');
    assert.equal((calls[1]!.body as { grant_type: string }).grant_type, 'password');
  });

  it('collapses concurrent renewals into a single token request', async () => {
    const { manager, calls } = makeManager({ [ISSUE]: tokenResponse('access-1') });

    const tokens = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ]);

    assert.deepEqual(tokens, ['access-1', 'access-1', 'access-1']);
    assert.equal(calls.length, 1);
  });
});
