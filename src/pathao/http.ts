import { PathaoApiError, PathaoTransportError } from './errors.js';

/** Injectable fetch so tests can drive the client without a network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  accessToken?: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  baseUrl: string;
}

function extractErrors(body: unknown): Record<string, unknown> | undefined {
  if (body && typeof body === 'object' && 'errors' in body) {
    const errors = (body as { errors: unknown }).errors;
    if (errors && typeof errors === 'object') return errors as Record<string, unknown>;
  }
  return undefined;
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return fallback;
}

/**
 * Performs one Pathao HTTP call and unwraps the JSON body.
 *
 * Non-2xx responses become `PathaoApiError`; anything that prevents a response
 * (timeout, DNS, TLS) becomes `PathaoTransportError`.
 */
export async function pathaoRequest<T>(options: RequestOptions): Promise<T> {
  const { method, path, body, accessToken, timeoutMs, fetchImpl, baseUrl } = options;
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    const reason =
      cause instanceof Error && cause.name === 'AbortError'
        ? `Request to ${method} ${path} timed out after ${timeoutMs}ms`
        : `Request to ${method} ${path} failed`;
    throw new PathaoTransportError(reason, cause);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.trim() !== '') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Pathao occasionally returns an HTML error page (gateway/maintenance).
      parsed = { message: raw.slice(0, 500) };
    }
  }

  if (!response.ok) {
    throw new PathaoApiError(
      extractMessage(parsed, `Pathao responded ${response.status} for ${method} ${path}`),
      {
        status: response.status,
        code:
          parsed && typeof parsed === 'object' && 'code' in parsed
            ? ((parsed as { code: string | number }).code ?? undefined)
            : undefined,
        errors: extractErrors(parsed),
        body: parsed,
      },
    );
  }

  return parsed as T;
}
