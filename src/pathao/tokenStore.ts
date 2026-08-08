export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  /** Absolute expiry as epoch milliseconds. */
  expiresAt: number;
}

/**
 * Persistence seam for the OAuth tokens.
 *
 * The Pathao docs ask that the issued token be kept in a persistent store and
 * reused rather than re-issued per request; `SqliteTokenStore` is the real
 * implementation and `MemoryTokenStore` keeps tests off disk.
 */
export interface TokenStore {
  read(): StoredToken | null;
  write(token: StoredToken): void;
  clear(): void;
}

export class MemoryTokenStore implements TokenStore {
  #token: StoredToken | null = null;

  read(): StoredToken | null {
    return this.#token;
  }

  write(token: StoredToken): void {
    this.#token = token;
  }

  clear(): void {
    this.#token = null;
  }
}
