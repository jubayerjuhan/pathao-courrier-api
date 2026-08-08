import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { PathaoApiError, PathaoTransportError } from '../pathao/errors.js';

/** Maps validation, upstream and transport failures onto sensible HTTP codes. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        message: 'Request validation failed.',
        issues: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (err instanceof PathaoApiError) {
    // 4xx from Pathao is passed through; 5xx becomes 502 since the fault is upstream.
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    res.status(status).json({
      error: {
        message: err.message,
        source: 'pathao',
        pathao_status: err.status,
        ...(err.errors ? { fields: err.errors } : {}),
      },
    });
    return;
  }

  if (err instanceof PathaoTransportError) {
    res.status(504).json({ error: { message: err.message, source: 'pathao' } });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  res.status(500).json({ error: { message } });
};
