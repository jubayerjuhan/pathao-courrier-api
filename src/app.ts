import express, { type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppContext } from './context.js';
import { catalogRoutes } from './routes/catalog.js';
import { errorHandler } from './routes/errorHandler.js';
import { invoiceRoutes } from './routes/invoices.js';
import { orderRoutes } from './routes/orders.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolves to <repo>/public from both src/ (tsx) and dist/ (compiled).
const publicDir = path.resolve(here, '..', 'public');

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      base_url: ctx.config.pathao.baseUrl,
      tracked_orders: ctx.orders.count(),
    });
  });

  app.use('/api/invoices', invoiceRoutes(ctx));
  app.use('/api/orders', orderRoutes(ctx));
  app.use('/api', catalogRoutes(ctx));

  app.use(express.static(publicDir));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'Unknown API route.' } });
  });

  app.use(errorHandler);
  return app;
}
