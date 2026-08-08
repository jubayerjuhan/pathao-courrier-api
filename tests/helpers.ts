import type { PathaoCredentials } from '../src/config.js';
import type { FetchLike } from '../src/pathao/http.js';

export const testCredentials: PathaoCredentials = {
  baseUrl: 'https://courier-api-sandbox.pathao.com',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  username: 'test@pathao.com',
  password: 'lovePathao',
};

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubRoute {
  status?: number;
  body: unknown;
}

/**
 * A `fetch` stand-in driven by a routing table keyed on "METHOD /path".
 *
 * A route may be a single response or an array consumed one call at a time, so
 * a test can make the same endpoint answer differently on retry.
 */
export function createFetchStub(routes: Record<string, StubRoute | StubRoute[]>): {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, StubRoute[]>(
    Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]),
  );

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;

    calls.push({
      url: input,
      method,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const queue = queues.get(key);
    if (!queue || queue.length === 0) {
      return new Response(JSON.stringify({ message: `No stub for ${key}` }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Keep the last entry so repeated calls stay served once the queue drains.
    const route = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { fetchImpl, calls };
}

export function tokenResponse(accessToken: string, refreshToken = 'refresh-1'): StubRoute {
  return {
    body: {
      token_type: 'Bearer',
      expires_in: 432000,
      access_token: accessToken,
      refresh_token: refreshToken,
    },
  };
}

export function envelope(data: unknown, code = 200): StubRoute {
  return { status: code, body: { message: 'ok', type: 'success', code, data } };
}
