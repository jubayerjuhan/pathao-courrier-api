import type { OrderRepository } from '../db/orderRepository.js';
import type { PathaoClient } from '../pathao/client.js';
import type {
  CreateOrderInput,
  CreateOrderResponse,
  MerchantOrder,
  OrderShortInfo,
} from '../pathao/types.js';

export interface ImportAllReport {
  /** Orders read from Pathao across every page. */
  fetched: number;
  /** Pages walked, and how many Pathao said there were. */
  pages: number;
  totalReported: number;
  /** Of those fetched, how many already carried an invoice id. */
  invoiced: number;
  startedAt: string;
  finishedAt: string;
}

/** Merchant-supplied fields for an order being brought under local tracking. */
export interface ImportDetails {
  consignment_id: string;
  store_id?: number;
  recipient_name?: string;
  recipient_phone?: string;
  recipient_address?: string;
  item_description?: string;
  amount_to_collect?: number;
  delivery_fee?: number;
}

/**
 * Creates orders through Pathao and records them locally.
 *
 * Orders reach local tracking three ways: created here, imported by
 * consignment id, or pulled wholesale from `GET /orders/all`.
 */
export class OrderService {
  readonly #client: PathaoClient;
  readonly #orders: OrderRepository;

  constructor(client: PathaoClient, orders: OrderRepository) {
    this.#client = client;
    this.#orders = orders;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
    const created = await this.#client.createOrder(input);

    this.#orders.upsertSeed({
      consignmentId: created.consignment_id,
      merchantOrderId: created.merchant_order_id ?? input.merchant_order_id ?? null,
      storeId: input.store_id,
      recipientName: input.recipient_name,
      recipientPhone: input.recipient_phone,
      recipientAddress: input.recipient_address,
      itemDescription: input.item_description ?? null,
      itemQuantity: input.item_quantity,
      itemWeight: Number(input.item_weight),
      amountToCollect: input.amount_to_collect,
      deliveryFee: created.delivery_fee,
      orderStatus: created.order_status,
    });

    return created;
  }

  /**
   * Adds an order created outside this app (dashboard, bulk upload, another
   * system) to local tracking by pulling its short info first.
   *
   * Short info carries no `amount_to_collect` or `delivery_fee`, so those may
   * be passed in; without them the consignment appears on its invoice with a
   * zero value.
   */
  async importByConsignmentId(entry: string | ImportDetails): Promise<OrderShortInfo> {
    const details: ImportDetails = typeof entry === 'string' ? { consignment_id: entry } : entry;
    const consignmentId = details.consignment_id;
    const info = await this.#client.getOrderInfo(consignmentId);

    this.#orders.upsertSeed({
      consignmentId: info.consignment_id ?? consignmentId,
      merchantOrderId: info.merchant_order_id ?? null,
      orderStatus: info.order_status ?? null,
      storeId: details.store_id ?? null,
      recipientName: details.recipient_name ?? null,
      recipientPhone: details.recipient_phone ?? null,
      recipientAddress: details.recipient_address ?? null,
      itemDescription: details.item_description ?? null,
      amountToCollect: details.amount_to_collect ?? null,
      deliveryFee: details.delivery_fee ?? null,
    });
    this.#orders.applySync({
      consignmentId: info.consignment_id ?? consignmentId,
      merchantOrderId: info.merchant_order_id ?? null,
      orderStatus: info.order_status ?? null,
      orderStatusSlug: info.order_status_slug ?? null,
      invoiceId: info.invoice_id ?? null,
      pathaoUpdatedAt: info.updated_at ?? null,
    });

    return info;
  }

  /**
   * Pulls the merchant's whole order history from `GET /orders/all` into local
   * tracking, one page at a time.
   *
   * Unlike `importByConsignmentId` this needs no ids up front and carries the
   * money fields, so consignments land on their invoices already valued.
   */
  async importAllFromPathao(options: { maxPages?: number } = {}): Promise<ImportAllReport> {
    const startedAt = new Date().toISOString();
    const maxPages = options.maxPages ?? Infinity;

    let page = 1;
    let lastPage = 1;
    let fetched = 0;
    let invoiced = 0;
    let totalReported = 0;

    while (page <= lastPage && page <= maxPages) {
      const result = await this.#client.listOrdersPage(page);
      const rows = result?.data ?? [];
      lastPage = Number(result?.last_page ?? page);
      totalReported = Number(result?.total ?? totalReported);

      for (const row of rows) {
        this.#trackMerchantOrder(row);
        fetched += 1;
        if (row.order_invoice_id) invoiced += 1;
      }

      // A page Pathao reports but does not fill would loop forever otherwise.
      if (rows.length === 0) break;
      page += 1;
    }

    return {
      fetched,
      pages: page - 1,
      totalReported,
      invoiced,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  /** Writes one `/orders/all` row through both the seed and the sync path. */
  #trackMerchantOrder(row: MerchantOrder): void {
    const consignmentId = row.order_consignment_id;
    if (!consignmentId) return;

    this.#orders.upsertSeed({
      consignmentId,
      merchantOrderId: row.merchant_order_id ?? null,
      recipientName: row.recipient_name ?? null,
      recipientPhone: row.recipient_phone ?? null,
      recipientAddress: row.recipient_address ?? null,
      itemDescription: row.order_description ?? null,
      amountToCollect: row.order_amount ?? null,
      // `total_fee` includes COD and surcharges; `delivery_fee` is the carriage
      // alone. Prefer the total, since that is what Pathao nets off the invoice.
      deliveryFee: row.total_fee ?? row.delivery_fee ?? null,
      orderStatus: row.order_status ?? null,
      orderType: row.order_type ?? null,
    });

    this.#orders.applySync({
      consignmentId,
      merchantOrderId: row.merchant_order_id ?? null,
      orderStatus: row.order_status ?? null,
      orderStatusSlug: row.order_status ? row.order_status.toLowerCase().replace(/\s+/g, '_') : null,
      invoiceId: row.order_invoice_id ?? null,
      pathaoUpdatedAt: row.order_status_updated_at ?? row.order_created_at ?? null,
    });
  }

  /**
   * Bulk creation returns only an acceptance flag, so the consignment ids are
   * unknown here. The orders can be tracked later via `importByConsignmentId`.
   */
  async createBulkOrders(orders: CreateOrderInput[]): Promise<boolean> {
    return this.#client.createBulkOrders(orders);
  }
}
