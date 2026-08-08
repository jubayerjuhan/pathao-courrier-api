import type { PathaoCredentials } from '../config.js';
import { PathaoApiError } from './errors.js';
import { pathaoRequest, type FetchLike } from './http.js';
import type { StoredToken, TokenStore } from './tokenStore.js';
import type { IssueTokenResponse } from './types.js';

const ISSUE_TOKEN_PATH = '/aladdin/api/v1/issue-token';

export interface TokenManagerOptions {
  credentials: PathaoCredentials;
  store: TokenStore;
  fetchImpl: FetchLike;
  timeoutMs: number;
  /** Refresh this many seconds before the real expiry so calls never race it. */
  leewaySeconds: number;
  now?: () => number;
}

/**
 * Issues, caches and refreshes the merchant access token.
 *
 * The token is read from the store on every call, so a token issued by one
 * process is picked up by the next one instead of burning a fresh grant.
 */
export class TokenManager {
  readonly #credentials: PathaoCredentials;
  readonly #store: TokenStore;
  readonly #fetchImpl: FetchLike;
  readonly #timeoutMs: number;
  readonly #leewayMs: number;
  readonly #now: () => number;

  /** Shared by concurrent callers so a burst of requests issues one token. */
  #inFlight: Promise<StoredToken> | null = null;

  constructor(options: TokenManagerOptions) {
    this.#credentials = options.credentials;
    this.#store = options.store;
    this.#fetchImpl = options.fetchImpl;
    this.#timeoutMs = options.timeoutMs;
    this.#leewayMs = options.leewaySeconds * 1000;
    this.#now = options.now ?? Date.now;
  }

  /** Returns a token that is valid now, issuing or refreshing one if needed. */
  async getAccessToken(): Promise<string> {
    const cached = this.#store.read();
    if (cached && cached.expiresAt - this.#leewayMs > this.#now()) {
      return cached.accessToken;
    }
    const token = await this.#renew(cached);
    return token.accessToken;
  }

  /** Discards the cached token and issues a new one. Used after a 401. */
  async forceRenew(): Promise<string> {
    const previous = this.#store.read();
    this.#store.clear();
    const token = await this.#renew(previous);
    return token.accessToken;
  }

  #renew(previous: StoredToken | null): Promise<StoredToken> {
    // Collapse parallel renewals: whoever gets here first does the work.
    if (this.#inFlight) return this.#inFlight;

    const run = (async () => {
      if (previous?.refreshToken) {
        try {
          return await this.#issueFromRefreshToken(previous.refreshToken);
        } catch (error) {
          // An expired or revoked refresh token is recoverable — fall back to
          // the password grant. Anything else (network, 5xx) is not.
          if (!(error instanceof PathaoApiError) || error.status >= 500) throw error;
        }
      }
      return await this.#issueFromPassword();
    })();

    this.#inFlight = run;
    return run.finally(() => {
      this.#inFlight = null;
    });
  }

  async #issueFromPassword(): Promise<StoredToken> {
    const response = await pathaoRequest<IssueTokenResponse>({
      method: 'POST',
      path: ISSUE_TOKEN_PATH,
      baseUrl: this.#credentials.baseUrl,
      timeoutMs: this.#timeoutMs,
      fetchImpl: this.#fetchImpl,
      body: {
        client_id: this.#credentials.clientId,
        client_secret: this.#credentials.clientSecret,
        grant_type: 'password',
        username: this.#credentials.username,
        password: this.#credentials.password,
      },
    });
    return this.#persist(response);
  }

  async #issueFromRefreshToken(refreshToken: string): Promise<StoredToken> {
    const response = await pathaoRequest<IssueTokenResponse>({
      method: 'POST',
      path: ISSUE_TOKEN_PATH,
      baseUrl: this.#credentials.baseUrl,
      timeoutMs: this.#timeoutMs,
      fetchImpl: this.#fetchImpl,
      body: {
        client_id: this.#credentials.clientId,
        client_secret: this.#credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    });
    return this.#persist(response);
  }

  #persist(response: IssueTokenResponse): StoredToken {
    if (!response?.access_token) {
      throw new Error('Pathao issue-token response did not contain an access_token.');
    }
    const token: StoredToken = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type ?? 'Bearer',
      expiresAt: this.#now() + (response.expires_in ?? 0) * 1000,
    };
    this.#store.write(token);
    return token;
  }
}
