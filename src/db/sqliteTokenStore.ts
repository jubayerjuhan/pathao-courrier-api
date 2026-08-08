import type { Database } from './index.js';
import type { StoredToken, TokenStore } from '../pathao/tokenStore.js';

/**
 * Keeps the issued token in the database so restarts reuse it instead of
 * burning a fresh grant on every boot, as the Pathao docs recommend.
 *
 * This matters more on serverless than it did on a long-lived server: every
 * cold start is effectively a restart, so without a shared store each one
 * would issue its own token.
 */
export class SqliteTokenStore implements TokenStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async read(): Promise<StoredToken | null> {
    const row = await this.#db.get<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_at: number;
    }>('SELECT access_token, refresh_token, token_type, expires_at FROM oauth_tokens WHERE id = 1');

    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenType: row.token_type,
      expiresAt: Number(row.expires_at),
    };
  }

  async write(token: StoredToken): Promise<void> {
    await this.#db.run(
      `INSERT INTO oauth_tokens (id, access_token, refresh_token, token_type, expires_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           access_token  = excluded.access_token,
           refresh_token = excluded.refresh_token,
           token_type    = excluded.token_type,
           expires_at    = excluded.expires_at`,
      [token.accessToken, token.refreshToken, token.tokenType, token.expiresAt],
    );
  }

  async clear(): Promise<void> {
    await this.#db.run('DELETE FROM oauth_tokens WHERE id = 1');
  }
}
