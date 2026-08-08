import type { IncomingMessage, ServerResponse } from 'node:http';
// The compiled output, not src/: `npm run build` runs before functions are
// bundled, and importing the emitted JavaScript keeps this file free of the
// project's NodeNext module resolution.
import { createApp } from '../dist/app.js';
import { buildContext } from '../dist/bootstrap.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Built once per warm instance rather than per request, so the libSQL client
 * and any cached Pathao token survive between invocations on the same
 * instance. A cold start pays for this again, which is unavoidable.
 */
let app: Promise<Handler> | null = null;

function getApp(): Promise<Handler> {
  // A failed boot must not be cached, or one bad cold start would poison the
  // instance for its whole life.
  app ??= buildContext()
    .then((ctx) => createApp(ctx) as unknown as Handler)
    .catch((error: unknown) => {
      app = null;
      throw error;
    });
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  (await getApp())(req, res);
}
