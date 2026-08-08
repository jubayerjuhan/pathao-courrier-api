import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { InvoiceRepository } from './db/invoiceRepository.js';
import { OrderRepository } from './db/orderRepository.js';
import { SqliteTokenStore } from './db/sqliteTokenStore.js';
import { PathaoClient } from './pathao/client.js';
import { OrderService } from './services/orderService.js';
import { SyncService } from './services/syncService.js';
import type { AppContext } from './context.js';

function buildContext(): AppContext {
  const config = loadConfig();
  const db = openDatabase(config.databaseFile);

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

function main(): void {
  const ctx = buildContext();
  const app = createApp(ctx);

  const server = app.listen(ctx.config.port, () => {
    console.log(`Invoice dashboard on http://localhost:${ctx.config.port}`);
    console.log(`Pathao base URL: ${ctx.config.pathao.baseUrl}`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => {
      ctx.db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
