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
  /** Forward consignments that reached a final outcome — delivered or returned. */
  settled_count: number;
  settled_delivered_count: number;
  /** Of `settled_count`, the ones that came back. */
  settled_returned_count: number;
  /** `settled_returned_count / settled_count` as a percentage; null with nothing settled. */
  return_rate: number | null;
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
  /** Return rate across every tracked order, invoiced or not. */
  settled_count: number;
  settled_returned_count: number;
  settled_delivered_count: number;
  return_rate: number | null;
}

/**
 * Predicates behind the return rate.
 *
 * The rate answers "of the parcels that finished their journey, how many came
 * back?", so it deliberately narrows the population twice:
 *
 * - `forward` drops return and exchange legs. Pathao books the trip back to the
 *   merchant as its own consignment sharing the invoice, so counting those as
 *   returns would tally the same parcel twice and inflate the rate.
 * - `settledDelivered` / `settledReturned` keep only final outcomes. Parcels
 *   still moving have no verdict yet, and pickup failures or cancellations
 *   never entered the network, so both would distort the ratio.
 */
const RETURN_RATE_SQL = (status: string) => ({
  forward: "LOWER(COALESCE(order_type, 'delivery')) NOT IN ('return', 'exchange')",
  // "At Delivery Hub" and "On the Way To Delivery Hub" contain "deliver" but are
  // still in flight, so hub and en-route wording is excluded here.
  settledDelivered: `(${status} LIKE '%deliver%' AND ${status} NOT LIKE '%fail%'
                      AND ${status} NOT LIKE '%hub%' AND ${status} NOT LIKE '%way%')`,
  settledReturned: `${status} LIKE '%return%'`,
});

/** Percentage of settled forward parcels that came back, to one decimal. */
function returnRate(delivered: number, returned: number): number | null {
  const settled = delivered + returned;
  if (settled === 0) return null;
  return Math.round((returned / settled) * 1000) / 10;
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
      .all(...params, limit, offset)
      .map((row) => this.#withReturnRate(row as unknown as InvoiceSummary));
  }

  findById(invoiceId: string): InvoiceSummary | null {
    const row = this.#db
      .prepare(
        `${this.#selectAggregate()}
         WHERE invoice_id = ?
         GROUP BY invoice_id`,
      )
      .get(invoiceId) as InvoiceSummary | undefined;
    return row ? this.#withReturnRate(row) : null;
  }

  /** SQL sums the two settled buckets; the ratio is derived here. */
  #withReturnRate(row: InvoiceSummary): InvoiceSummary {
    const delivered = Number(row.settled_delivered_count ?? 0);
    const returned = Number(row.settled_returned_count ?? 0);
    return {
      ...row,
      settled_delivered_count: delivered,
      settled_returned_count: returned,
      settled_count: delivered + returned,
      return_rate: returnRate(delivered, returned),
    };
  }

  totals(): PortfolioTotals {
    const status = "LOWER(COALESCE(order_status_slug, order_status, ''))";
    const { forward, settledDelivered, settledReturned } = RETURN_RATE_SQL(status);

    const row = this.#db
      .prepare(
        `SELECT
           COUNT(DISTINCT invoice_id)                                          AS invoice_count,
           COALESCE(SUM(CASE WHEN ${forward} AND ${settledDelivered} THEN 1 ELSE 0 END), 0) AS settled_delivered_count,
           COALESCE(SUM(CASE WHEN ${forward} AND ${settledReturned}  THEN 1 ELSE 0 END), 0) AS settled_returned_count,
           COALESCE(SUM(CASE WHEN invoice_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS invoiced_order_count,
           COALESCE(SUM(CASE WHEN invoice_id IS NULL     THEN 1 ELSE 0 END), 0) AS uninvoiced_order_count,
           COALESCE(SUM(CASE WHEN invoice_id IS NOT NULL THEN amount_to_collect ELSE 0 END), 0) AS total_collected,
           COALESCE(SUM(CASE WHEN invoice_id IS NOT NULL THEN delivery_fee      ELSE 0 END), 0) AS total_delivery_fee
         FROM orders`,
      )
      .get() as Omit<PortfolioTotals, 'net_payable' | 'settled_count' | 'return_rate'>;

    const settledDeliveredCount = Number(row.settled_delivered_count);
    const settledReturnedCount = Number(row.settled_returned_count);

    return {
      invoice_count: Number(row.invoice_count),
      invoiced_order_count: Number(row.invoiced_order_count),
      uninvoiced_order_count: Number(row.uninvoiced_order_count),
      total_collected: Number(row.total_collected),
      total_delivery_fee: Number(row.total_delivery_fee),
      net_payable: Number(row.total_collected) - Number(row.total_delivery_fee),
      settled_delivered_count: settledDeliveredCount,
      settled_returned_count: settledReturnedCount,
      settled_count: settledDeliveredCount + settledReturnedCount,
      return_rate: returnRate(settledDeliveredCount, settledReturnedCount),
    };
  }

  /**
   * Status buckets use the slug where Pathao supplied one, falling back to the
   * display status. Matching is substring-based because Pathao spells the same
   * state several ways ("Delivered", "Partial_Delivery", "Delivery_Failed").
   */
  #selectAggregate(): string {
    const status = "LOWER(COALESCE(order_status_slug, order_status, ''))";
    const { forward, settledDelivered, settledReturned } = RETURN_RATE_SQL(status);
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
        SUM(CASE WHEN ${forward} AND ${settledDelivered} THEN 1 ELSE 0 END) AS settled_delivered_count,
        SUM(CASE WHEN ${forward} AND ${settledReturned}  THEN 1 ELSE 0 END) AS settled_returned_count,
        MIN(created_at)                           AS first_order_at,
        MAX(COALESCE(pathao_updated_at, last_synced_at, created_at)) AS last_updated_at
      FROM orders`;
  }
}
