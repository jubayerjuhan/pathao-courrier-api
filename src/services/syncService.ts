import type { OrderRepository } from '../db/orderRepository.js';
import type { PathaoClient } from '../pathao/client.js';
import { PathaoApiError } from '../pathao/errors.js';

export interface SyncOptions {
  /** Cap on how many consignments to refresh in one pass. */
  limit?: number;
  /** Skip orders that already carry an invoice id. */
  onlyUninvoiced?: boolean;
  /** Parallel in-flight requests to Pathao. */
  concurrency?: number;
}

export interface SyncFailure {
  consignmentId: string;
  message: string;
  status?: number;
}

export interface SyncReport {
  checked: number;
  updated: number;
  /** Orders that gained an `invoice_id` they did not have before this pass. */
  newlyInvoiced: number;
  failures: SyncFailure[];
  startedAt: string;
  finishedAt: string;
}

/**
 * Refreshes locally tracked orders from `GET /orders/{id}/info`.
 *
 * This is what makes the invoice view possible: Pathao only reveals an order's
 * `invoice_id` through that endpoint, so invoices materialise as orders are
 * re-checked.
 */
export class SyncService {
  readonly #client: PathaoClient;
  readonly #orders: OrderRepository;

  constructor(client: PathaoClient, orders: OrderRepository) {
    this.#client = client;
    this.#orders = orders;
  }

  async syncOrders(options: SyncOptions = {}): Promise<SyncReport> {
    const { limit = 200, onlyUninvoiced = false, concurrency = 4 } = options;
    const startedAt = new Date().toISOString();

    const ids = await this.#orders.idsForSync({ limit, includeInvoiced: !onlyUninvoiced });
    const failures: SyncFailure[] = [];
    let updated = 0;
    let newlyInvoiced = 0;

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        if (id === undefined) return;

        const before = await this.#orders.findById(id);
        try {
          const info = await this.#client.getOrderInfo(id);
          await this.#orders.applySync({
            consignmentId: id,
            merchantOrderId: info.merchant_order_id ?? null,
            orderStatus: info.order_status ?? null,
            orderStatusSlug: info.order_status_slug ?? null,
            invoiceId: info.invoice_id ?? null,
            pathaoUpdatedAt: info.updated_at ?? null,
          });
          updated += 1;
          if (!before?.invoice_id && info.invoice_id) newlyInvoiced += 1;
        } catch (error) {
          failures.push({
            consignmentId: id,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof PathaoApiError ? { status: error.status } : {}),
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, ids.length || 1)) }, worker),
    );

    return {
      checked: ids.length,
      updated,
      newlyInvoiced,
      failures,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}
