import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase, type Database } from '../src/db/index.js';
import { InvoiceRepository } from '../src/db/invoiceRepository.js';
import { OrderRepository } from '../src/db/orderRepository.js';

let db: Database;
let orders: OrderRepository;
let invoices: InvoiceRepository;

function seed(
  consignmentId: string,
  amount: number,
  fee: number,
  invoiceId: string | null,
  status: string,
): void {
  orders.upsertSeed({
    consignmentId,
    storeId: 1,
    recipientName: `Recipient ${consignmentId}`,
    amountToCollect: amount,
    deliveryFee: fee,
  });
  orders.applySync({
    consignmentId,
    merchantOrderId: null,
    orderStatus: status,
    orderStatusSlug: status,
    invoiceId,
    pathaoUpdatedAt: '2024-11-20 15:11:40',
  });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  orders = new OrderRepository(db);
  invoices = new InvoiceRepository(db);
});

describe('InvoiceRepository', () => {
  it('groups tracked orders into invoices and nets fees off the collected amount', () => {
    seed('DT1', 900, 80, 'INV-1', 'Delivered');
    seed('DT2', 500, 60, 'INV-1', 'Delivered');
    seed('DT3', 200, 70, 'INV-2', 'Pending');

    const list = invoices.list();
    assert.equal(list.length, 2);

    const first = invoices.findById('INV-1')!;
    assert.equal(first.order_count, 2);
    assert.equal(first.total_collected, 1400);
    assert.equal(first.total_delivery_fee, 140);
    assert.equal(first.net_payable, 1260);
    assert.equal(first.delivered_count, 2);
  });

  it('excludes orders Pathao has not invoiced yet', () => {
    seed('DT1', 900, 80, 'INV-1', 'Delivered');
    seed('DT2', 500, 60, null, 'Pending');

    assert.deepEqual(
      invoices.list().map((invoice) => invoice.invoice_id),
      ['INV-1'],
    );
    assert.deepEqual(
      orders.list({ invoiced: false }).map((order) => order.consignment_id),
      ['DT2'],
    );
  });

  it('buckets statuses into delivered, returned and in-transit counts', () => {
    seed('DT1', 100, 10, 'INV-1', 'Delivered');
    seed('DT2', 100, 10, 'INV-1', 'Return');
    seed('DT3', 100, 10, 'INV-1', 'Delivery_Failed');
    seed('DT4', 100, 10, 'INV-1', 'In_Transit');

    const invoice = invoices.findById('INV-1')!;
    assert.equal(invoice.delivered_count, 1, 'Delivery_Failed must not count as delivered');
    assert.equal(invoice.returned_count, 2);
    assert.equal(invoice.in_transit_count, 1);
  });

  it('reports portfolio totals split by invoiced state', () => {
    seed('DT1', 900, 80, 'INV-1', 'Delivered');
    seed('DT2', 500, 60, 'INV-2', 'Delivered');
    seed('DT3', 300, 50, null, 'Pending');

    const totals = invoices.totals();
    assert.equal(totals.invoice_count, 2);
    assert.equal(totals.invoiced_order_count, 2);
    assert.equal(totals.uninvoiced_order_count, 1);
    assert.equal(totals.total_collected, 1400, 'uninvoiced amounts are excluded');
    assert.equal(totals.total_delivery_fee, 140);
    assert.equal(totals.net_payable, 1260);
  });

  it('matches invoices by id, consignment id or merchant order id', () => {
    seed('DT-ALPHA', 100, 10, 'INV-1', 'Delivered');
    seed('DT-BETA', 100, 10, 'INV-2', 'Delivered');

    assert.deepEqual(
      invoices.list({ search: 'ALPHA' }).map((invoice) => invoice.invoice_id),
      ['INV-1'],
    );
    assert.deepEqual(
      invoices.list({ search: 'INV-2' }).map((invoice) => invoice.invoice_id),
      ['INV-2'],
    );
  });
});

describe('OrderRepository', () => {
  it('keeps synced values when a seed is written again', () => {
    orders.upsertSeed({ consignmentId: 'DT1', amountToCollect: 900, deliveryFee: 80 });
    orders.applySync({
      consignmentId: 'DT1',
      merchantOrderId: 'ORD-1',
      orderStatus: 'Delivered',
      orderStatusSlug: 'Delivered',
      invoiceId: 'INV-1',
      pathaoUpdatedAt: '2024-11-20 15:11:40',
    });

    orders.upsertSeed({ consignmentId: 'DT1', recipientName: 'Late detail' });

    const row = orders.findById('DT1')!;
    assert.equal(row.invoice_id, 'INV-1');
    assert.equal(row.order_status, 'Delivered');
    assert.equal(row.recipient_name, 'Late detail');
    assert.equal(row.amount_to_collect, 900);
  });

  it('queues never-synced orders ahead of recently synced ones', () => {
    orders.upsertSeed({ consignmentId: 'DT-SYNCED' });
    orders.applySync({
      consignmentId: 'DT-SYNCED',
      merchantOrderId: null,
      orderStatus: 'Pending',
      orderStatusSlug: 'Pending',
      invoiceId: null,
      pathaoUpdatedAt: null,
    });
    orders.upsertSeed({ consignmentId: 'DT-FRESH' });

    assert.equal(orders.idsForSync()[0], 'DT-FRESH');
  });
});
