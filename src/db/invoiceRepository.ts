import type { Database } from './index.js';

export interface InvoiceSummary {
  invoice_id: string;
  order_count: number;
  /** Sum of `amount_to_collect` across the invoice's consignments (COD collected). */
  total_collected: number;
  /** Sum of `delivery_fee` charged by Pathao on those consignments. */
  total_delivery_fee: number;
  /** What the merchant nets: collected minus delivery fees. */
  net_payable: number;
  delivered_count: number;
  returned_count: number;
  in_transit_count: number;
  first_order_at: string | null;
  last_updated_at: string | null;
}

export interface InvoiceFilters {
  search?: string;
  storeId?: number;
  limit?: number;
  offset?: number;
}

export interface PortfolioTotals {
  invoice_count: number;
  invoiced_order_count: number;
  uninvoiced_order_count: number;
  total_collected: number;
  total_delivery_fee: number;
  net_payable: number;
}

/**
 * The merchant API exposes no invoice-list endpoint — the only invoice signal
 * is the `invoice_id` on each order's short-info payload. Invoices are
 * therefore derived here by grouping the locally tracked orders on that id.
 */
export class InvoiceRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  list(filters: InvoiceFilters = {}): InvoiceSummary[] {
    const clauses = ['invoice_id IS NOT NULL'];
    const params: (string | number)[] = [];

    if (filters.storeId !== undefined) {
      clauses.push('store_id = ?');
      params.push(filters.storeId);
    }
    if (filters.search) {
      clauses.push(
        "(invoice_id LIKE ? OR consignment_id LIKE ? OR COALESCE(merchant_order_id, '') LIKE ?)",
      );
      const needle = `%${filters.search}%`;
      params.push(needle, needle, needle);
    }

    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    return this.#db
      .prepare(
        `${this.#selectAggregate()}
         WHERE ${clauses.join(' AND ')}
         GROUP BY invoice_id
         ORDER BY last_updated_at DESC, invoice_id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as unknown as InvoiceSummary[];
  }

  findById(invoiceId: string): InvoiceSummary | null {
    const row = this.#db
      .prepare(
        `${this.#selectAggregate()}
         WHERE invoice_id = ?
         GROUP BY invoice_id`,
      )
      .get(invoiceId) as InvoiceSummary | undefined;
    return row ?? null;
  }

  totals(): PortfolioTotals {
    const row = this.#db
      .prepare(
        `SELECT
           COUNT(DISTINCT invoice_id)                                          AS invoice_count,
           COALESCE(SUM(CASE WHEN invoice_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS invoiced_order_count,
           COALESCE(SUM(CASE WHEN invoice_id IS NULL     THEN 1 ELSE 0 END), 0) AS uninvoiced_order_count,
           COALESCE(SUM(CASE WHEN invoice_id IS NOT NULL THEN amount_to_collect ELSE 0 END), 0) AS total_collected,
           COALESCE(SUM(CASE WHEN invoice_id IS NOT NULL THEN delivery_fee      ELSE 0 END), 0) AS total_delivery_fee
         FROM orders`,
      )
      .get() as Omit<PortfolioTotals, 'net_payable'>;

    return {
      invoice_count: Number(row.invoice_count),
      invoiced_order_count: Number(row.invoiced_order_count),
      uninvoiced_order_count: Number(row.uninvoiced_order_count),
      total_collected: Number(row.total_collected),
      total_delivery_fee: Number(row.total_delivery_fee),
      net_payable: Number(row.total_collected) - Number(row.total_delivery_fee),
    };
  }

  /**
   * Status buckets use the slug where Pathao supplied one, falling back to the
   * display status. Matching is substring-based because Pathao spells the same
   * state several ways ("Delivered", "Partial_Delivery", "Delivery_Failed").
   */
  #selectAggregate(): string {
    const status = "LOWER(COALESCE(order_status_slug, order_status, ''))";
    return `
      SELECT
        invoice_id,
        COUNT(*)                                  AS order_count,
        COALESCE(SUM(amount_to_collect), 0)       AS total_collected,
        COALESCE(SUM(delivery_fee), 0)            AS total_delivery_fee,
        COALESCE(SUM(amount_to_collect), 0) - COALESCE(SUM(delivery_fee), 0) AS net_payable,
        SUM(CASE WHEN ${status} LIKE '%deliver%' AND ${status} NOT LIKE '%fail%' THEN 1 ELSE 0 END) AS delivered_count,
        SUM(CASE WHEN ${status} LIKE '%return%' OR  ${status} LIKE '%fail%'      THEN 1 ELSE 0 END) AS returned_count,
        SUM(CASE WHEN ${status} LIKE '%transit%' OR ${status} LIKE '%pending%'
                   OR ${status} LIKE '%pickup%'  OR ${status} LIKE '%hub%'       THEN 1 ELSE 0 END) AS in_transit_count,
        MIN(created_at)                           AS first_order_at,
        MAX(COALESCE(pathao_updated_at, last_synced_at, created_at)) AS last_updated_at
      FROM orders`;
  }
}
