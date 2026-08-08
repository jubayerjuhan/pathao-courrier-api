/**
 * Raised when Pathao answers with a non-2xx status.
 *
 * Pathao returns validation problems as `422` with an `errors` object keyed by
 * field name, and auth problems as `401`. Both are surfaced here so callers can
 * branch on `status` without re-parsing the body.
 */
export class PathaoApiError extends Error {
  readonly status: number;
  readonly code: string | number | undefined;
  readonly errors: Record<string, unknown> | undefined;
  readonly body: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | number;
      errors?: Record<string, unknown>;
      body?: unknown;
    },
  ) {
    super(message);
    this.name = 'PathaoApiError';
    this.status = options.status;
    this.code = options.code;
    this.errors = options.errors;
    this.body = options.body;
  }

  /** True when the access token was rejected and a re-auth is worth attempting. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

/** Raised when the request never produced an HTTP response (DNS, TLS, timeout). */
export class PathaoTransportError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'PathaoTransportError';
    this.cause = cause;
  }
}
