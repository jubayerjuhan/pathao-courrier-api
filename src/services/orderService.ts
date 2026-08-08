import type { OrderRepository } from '../db/orderRepository.js';
import type { PathaoClient } from '../pathao/client.js';
import type { CreateOrderInput, CreateOrderResponse, OrderShortInfo } from '../pathao/types.js';

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
 * Local tracking is required, not incidental: the merchant API has no
 * "list my orders" endpoint, so an order not stored here can never appear on
 * an invoice.
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
   * Bulk creation returns only an acceptance flag, so the consignment ids are
   * unknown here. The orders can be tracked later via `importByConsignmentId`.
   */
  async createBulkOrders(orders: CreateOrderInput[]): Promise<boolean> {
    return this.#client.createBulkOrders(orders);
  }
}
