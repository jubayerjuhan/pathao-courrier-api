import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import type { InvoiceRepository } from './db/invoiceRepository.js';
import type { OrderRepository } from './db/orderRepository.js';
import type { PathaoClient } from './pathao/client.js';
import type { OrderService } from './services/orderService.js';
import type { SyncService } from './services/syncService.js';

/** Everything the route handlers need, wired once at boot. */
export interface AppContext {
  config: AppConfig;
  db: Database;
  client: PathaoClient;
  orders: OrderRepository;
  invoices: InvoiceRepository;
  orderService: OrderService;
  syncService: SyncService;
}
