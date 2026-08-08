import type { Database } from './index.js';

export interface OrderRow {
  consignment_id: string;
  merchant_order_id: string | null;
  store_id: number | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  item_description: string | null;
  item_quantity: number | null;
  item_weight: number | null;
  amount_to_collect: number;
  delivery_fee: number;
  order_status: string | null;
  order_status_slug: string | null;
  invoice_id: string | null;
  pathao_updated_at: string | null;
  created_at: string;
  last_synced_at: string | null;
}

/** Fields written when an order is first created or imported. */
export interface OrderSeed {
  consignmentId: string;
  merchantOrderId?: string | null;
  storeId?: number | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientAddress?: string | null;
  itemDescription?: string | null;
  itemQuantity?: number | null;
  itemWeight?: number | null;
  amountToCollect?: number | null;
  deliveryFee?: number | null;
  orderStatus?: string | null;
}

/** Fields refreshed from `GET /orders/{id}/info` on every sync. */
export interface OrderSyncPatch {
  consignmentId: string;
  merchantOrderId: string | null;
  orderStatus: string | null;
  orderStatusSlug: string | null;
  invoiceId: string | null;
  pathaoUpdatedAt: string | null;
}

export interface OrderFilters {
  invoiceId?: string;
  status?: string;
  storeId?: number;
  /** `true` → only invoiced orders, `false` → only un-invoiced ones. */
  invoiced?: boolean;
  search?: string;
}

export class OrderRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Inserts an order, or fills in details for one that sync already discovered.
   *
   * Seed values never clobber an existing non-null column: a later `upsertSeed`
   * for a row that sync has already enriched keeps the synced values.
   */
  upsertSeed(seed: OrderSeed): void {
    this.#db
      .prepare(
        `INSERT INTO orders (
           consignment_id, merchant_order_id, store_id, recipient_name, recipient_phone,
           recipient_address, item_description, item_quantity, item_weight,
           amount_to_collect, delivery_fee, order_status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, 0), ?, ?)
         ON CONFLICT(consignment_id) DO UPDATE SET
           merchant_order_id = COALESCE(excluded.merchant_order_id, orders.merchant_order_id),
           store_id          = COALESCE(excluded.store_id,          orders.store_id),
           recipient_name    = COALESCE(excluded.recipient_name,    orders.recipient_name),
           recipient_phone   = COALESCE(excluded.recipient_phone,   orders.recipient_phone),
           recipient_address = COALESCE(excluded.recipient_address, orders.recipient_address),
           item_description  = COALESCE(excluded.item_description,  orders.item_description),
           item_quantity     = COALESCE(excluded.item_quantity,     orders.item_quantity),
           item_weight       = COALESCE(excluded.item_weight,       orders.item_weight),
           order_status      = COALESCE(excluded.order_status,      orders.order_status),
           -- These two re-bind the raw seed values rather than reading them off
           -- \`excluded\`, whose columns already went through COALESCE(?, 0) above:
           -- an unset amount would otherwise arrive here as 0 and wipe the row.
           amount_to_collect = COALESCE(?, orders.amount_to_collect),
           delivery_fee      = COALESCE(?, orders.delivery_fee)`,
      )
      .run(
        seed.consignmentId,
        seed.merchantOrderId ?? null,
        seed.storeId ?? null,
        seed.recipientName ?? null,
        seed.recipientPhone ?? null,
        seed.recipientAddress ?? null,
        seed.itemDescription ?? null,
        seed.itemQuantity ?? null,
        seed.itemWeight ?? null,
        seed.amountToCollect ?? null,
        seed.deliveryFee ?? null,
        seed.orderStatus ?? null,
        new Date().toISOString(),
        // Bound again for the DO UPDATE clause.
        seed.amountToCollect ?? null,
        seed.deliveryFee ?? null,
      );
  }

  /** Applies the latest short-info payload to a tracked order. */
  applySync(patch: OrderSyncPatch): void {
    this.#db
      .prepare(
        `UPDATE orders SET
           merchant_order_id = COALESCE(?, merchant_order_id),
           order_status      = COALESCE(?, order_status),
           order_status_slug = COALESCE(?, order_status_slug),
           invoice_id        = ?,
           pathao_updated_at = COALESCE(?, pathao_updated_at),
           last_synced_at    = ?
         WHERE consignment_id = ?`,
      )
      .run(
        patch.merchantOrderId,
        patch.orderStatus,
        patch.orderStatusSlug,
        patch.invoiceId,
        patch.pathaoUpdatedAt,
        new Date().toISOString(),
        patch.consignmentId,
      );
  }

  findById(consignmentId: string): OrderRow | null {
    const row = this.#db
      .prepare('SELECT * FROM orders WHERE consignment_id = ?')
      .get(consignmentId) as OrderRow | undefined;
    return row ?? null;
  }

  list(filters: OrderFilters = {}): OrderRow[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (filters.invoiceId !== undefined) {
      clauses.push('invoice_id = ?');
      params.push(filters.invoiceId);
    }
    if (filters.status !== undefined) {
      clauses.push('LOWER(COALESCE(order_status_slug, order_status)) = LOWER(?)');
      params.push(filters.status);
    }
    if (filters.storeId !== undefined) {
      clauses.push('store_id = ?');
      params.push(filters.storeId);
    }
    if (filters.invoiced !== undefined) {
      clauses.push(filters.invoiced ? 'invoice_id IS NOT NULL' : 'invoice_id IS NULL');
    }
    if (filters.search) {
      clauses.push(
        '(consignment_id LIKE ? OR COALESCE(merchant_order_id, \'\') LIKE ? OR COALESCE(recipient_name, \'\') LIKE ? OR COALESCE(recipient_phone, \'\') LIKE ?)',
      );
      const needle = `%${filters.search}%`;
      params.push(needle, needle, needle, needle);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.#db
      .prepare(
        `SELECT * FROM orders ${where}
         ORDER BY COALESCE(pathao_updated_at, created_at) DESC, consignment_id DESC`,
      )
      .all(...params) as unknown as OrderRow[];
  }

  /** Consignment ids worth re-checking, oldest sync first. */
  idsForSync(options: { limit?: number; includeInvoiced?: boolean } = {}): string[] {
    const { limit = 200, includeInvoiced = true } = options;
    const where = includeInvoiced ? '' : 'WHERE invoice_id IS NULL';
    const rows = this.#db
      .prepare(
        `SELECT consignment_id FROM orders ${where}
         ORDER BY last_synced_at IS NOT NULL, last_synced_at ASC
         LIMIT ?`,
      )
      .all(limit) as { consignment_id: string }[];
    return rows.map((row) => row.consignment_id);
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
    return Number(row.n);
  }
}
