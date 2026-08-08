import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { InvoiceRepository } from './db/invoiceRepository.js';
import { OrderRepository } from './db/orderRepository.js';
import { SqliteTokenStore } from './db/sqliteTokenStore.js';
import { PathaoClient } from './pathao/client.js';
import { OrderService } from './services/orderService.js';
import { SyncService } from './services/syncService.js';
import type { AppContext } from './context.js';

/**
 * Wires the application together.
 *
 * Shared by the long-running server and the serverless entrypoint, which is
 * why it is separate from `index.ts` — the latter also opens a port, which a
 * serverless function must not do.
 */
export async function buildContext(): Promise<AppContext> {
  const config = loadConfig();
  const db = await openDatabase(config.database);

  const client = new PathaoClient({
    credentials: config.pathao,
    tokenStore: new SqliteTokenStore(db),
    timeoutMs: config.requestTimeoutMs,
    tokenLeewaySeconds: config.tokenRefreshLeewaySeconds,
  });

  const orders = new OrderRepository(db);
  const invoices = new InvoiceRepository(db);

  return {
    config,
    db,
    client,
    orders,
    invoices,
    orderService: new OrderService(client, orders),
    syncService: new SyncService(client, orders),
  };
}
