import 'dotenv/config';
import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}".`);
  }
  return parsed;
}

export interface PathaoCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface AppConfig {
  port: number;
  database: { url: string; authToken?: string | undefined };
  /** How long before actual expiry we proactively refresh the access token, in seconds. */
  tokenRefreshLeewaySeconds: number;
  /** Request timeout for outbound Pathao calls, in milliseconds. */
  requestTimeoutMs: number;
  pathao: PathaoCredentials;
}

/**
 * Where the database lives.
 *
 * `TURSO_DATABASE_URL` is what deployments set — a hosted libSQL database, so
 * no disk is required. Without it the app falls back to a local SQLite file,
 * which is what `npm run dev` uses.
 */
function databaseSettings(): { url: string; authToken?: string | undefined } {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (url) {
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    if (!authToken && url.startsWith('libsql://')) {
      throw new Error('TURSO_DATABASE_URL is set but TURSO_AUTH_TOKEN is missing.');
    }
    return { url, authToken };
  }

  const file = process.env.DATABASE_FILE?.trim() || path.resolve(process.cwd(), 'data', 'pathao.sqlite');
  // libSQL wants a URL even for local files; ":memory:" is passed through.
  return { url: file === ':memory:' ? file : `file:${path.resolve(file)}` };
}

export function loadConfig(): AppConfig {
  return {
    port: optionalNumber('PORT', 3000),
    database: databaseSettings(),
    tokenRefreshLeewaySeconds: optionalNumber('TOKEN_REFRESH_LEEWAY_SECONDS', 300),
    requestTimeoutMs: optionalNumber('PATHAO_REQUEST_TIMEOUT_MS', 20_000),
    pathao: {
      baseUrl: (process.env.PATHAO_BASE_URL?.trim() || 'https://courier-api-sandbox.pathao.com')
        // A trailing slash would produce "//aladdin/..." paths.
        .replace(/\/+$/, ''),
      clientId: required('PATHAO_CLIENT_ID'),
      clientSecret: required('PATHAO_CLIENT_SECRET'),
      username: required('PATHAO_USERNAME'),
      password: required('PATHAO_PASSWORD'),
    },
  };
}
