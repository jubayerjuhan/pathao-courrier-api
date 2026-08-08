import type { Database } from './index.js';
import type { StoredToken, TokenStore } from '../pathao/tokenStore.js';

/**
 * Keeps the issued token in SQLite so restarts reuse it instead of burning a
 * fresh grant on every boot, as the Pathao docs recommend.
 */
export class SqliteTokenStore implements TokenStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  read(): StoredToken | null {
    const row = this.#db
      .prepare(
        'SELECT access_token, refresh_token, token_type, expires_at FROM oauth_tokens WHERE id = 1',
      )
      .get() as
      | { access_token: string; refresh_token: string; token_type: string; expires_at: number }
      | undefined;

    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenType: row.token_type,
      expiresAt: Number(row.expires_at),
    };
  }

  write(token: StoredToken): void {
    this.#db
      .prepare(
        `INSERT INTO oauth_tokens (id, access_token, refresh_token, token_type, expires_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           access_token  = excluded.access_token,
           refresh_token = excluded.refresh_token,
           token_type    = excluded.token_type,
           expires_at    = excluded.expires_at`,
      )
      .run(token.accessToken, token.refreshToken, token.tokenType, token.expiresAt);
  }

  clear(): void {
    this.#db.prepare('DELETE FROM oauth_tokens WHERE id = 1').run();
  }
}
