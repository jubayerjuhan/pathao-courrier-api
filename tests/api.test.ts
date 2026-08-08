import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/db/index.js';
import { InvoiceRepository } from '../src/db/invoiceRepository.js';
import { OrderRepository } from '../src/db/orderRepository.js';
import { PathaoClient } from '../src/pathao/client.js';
import { MemoryTokenStore } from '../src/pathao/tokenStore.js';
import { OrderService } from '../src/services/orderService.js';
import { SyncService } from '../src/services/syncService.js';
import { createFetchStub, envelope, testCredentials, tokenResponse } from './helpers.js';

const ISSUE = 'POST /aladdin/api/v1/issue-token';

let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let baseUrl: string;
let ctx: AppContext;

before(async () => {
  const { fetchImpl } = createFetchStub({
    [ISSUE]: tokenResponse('access-1'),
    'POST /aladdin/api/v1/orders': envelope({
      consignment_id: 'DT-NEW',
      merchant_order_id: 'ORD-9',
      order_status: 'Pending',
      delivery_fee: 80,
    }),
    'GET /aladdin/api/v1/orders/DT-IMPORT/info': envelope({
      consignment_id: 'DT-IMPORT',
      merchant_order_id: 'ORD-IMP',
      order_status: 'Delivered',
      order_status_slug: 'Delivered',
      updated_at: '2024-11-21 09:00:00',
      invoice_id: 'INV-IMPORTED',
    }),
    'GET /aladdin/api/v1/orders/DT-VALUED/info': envelope({
      consignment_id: 'DT-VALUED',
      merchant_order_id: null,
      order_status: 'Delivered',
      order_status_slug: 'Delivered',
      updated_at: '2024-11-22 09:00:00',
      invoice_id: 'INV-VALUED',
    }),
  });

  const db = await openDatabase({ url: ':memory:' });
  const client = new PathaoClient({
    credentials: testCredentials,
    tokenStore: new MemoryTokenStore(),
    fetchImpl,
    timeoutMs: 5000,
  });
  const orders = new OrderRepository(db);

  ctx = {
    config: {
      port: 0,
      database: { url: ':memory:' },
      tokenRefreshLeewaySeconds: 300,
      requestTimeoutMs: 5000,
      pathao: testCredentials,
    },
    db,
    client,
    orders,
    invoices: new InvoiceRepository(db),
    orderService: new OrderService(client, orders),
    syncService: new SyncService(client, orders),
  };

  server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  ctx.db.close();
});

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return { status: response.status, json: (await response.json()) as any };
}

describe('HTTP API', () => {
  it('reports health with the configured base URL', async () => {
    const { status, json } = await call('/api/health');
    assert.equal(status, 200);
    assert.equal(json.status, 'ok');
    assert.equal(json.base_url, testCredentials.baseUrl);
  });

  it('creates an order through Pathao and tracks it locally', async () => {
    const { status, json } = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        store_id: 1,
        merchant_order_id: 'ORD-9',
        recipient_name: 'Demo Recipient',
        recipient_phone: '01700000000',
        recipient_address: 'House 123, Road 4, Sector 10, Uttara, Dhaka-1230',
        delivery_type: 48,
        item_type: 2,
        item_quantity: 1,
        item_weight: 0.5,
        amount_to_collect: 900,
      }),
    });

    assert.equal(status, 201);
    assert.equal(json.data.consignment_id, 'DT-NEW');
    assert.equal((await ctx.orders.findById('DT-NEW'))?.amount_to_collect, 900);
  });

  it('rejects payloads that violate the documented field rules', async () => {
    const { status, json } = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        store_id: 1,
        recipient_name: 'Demo Recipient',
        recipient_phone: '017', // must be 11 digits
        recipient_address: 'House 123, Road 4, Sector 10, Uttara, Dhaka-1230',
        delivery_type: 48,
        item_type: 2,
        item_quantity: 1,
        item_weight: 0.5,
        amount_to_collect: 900,
      }),
    });

    assert.equal(status, 400);
    assert.ok(json.error.issues.some((issue: any) => issue.path === 'recipient_phone'));
  });

  it('imports an existing consignment and exposes it as an invoice', async () => {
    const imported = await call('/api/orders/import', {
      method: 'POST',
      body: JSON.stringify({ consignment_ids: ['DT-IMPORT'] }),
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.json.meta.imported, 1);

    const invoices = await call('/api/invoices');
    const invoice = invoices.json.data.find((row: any) => row.invoice_id === 'INV-IMPORTED');
    assert.ok(invoice, 'imported order should surface as an invoice');
    assert.equal(invoice.order_count, 1);

    const detail = await call('/api/invoices/INV-IMPORTED');
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.orders[0].consignment_id, 'DT-IMPORT');
  });

  it('values an imported consignment from the amounts supplied with it', async () => {
    const imported = await call('/api/orders/import', {
      method: 'POST',
      body: JSON.stringify({
        consignment_ids: [
          { consignment_id: 'DT-VALUED', amount_to_collect: 1500, delivery_fee: 120 },
        ],
      }),
    });
    assert.equal(imported.json.meta.imported, 1);

    const { json } = await call('/api/invoices/INV-VALUED');
    assert.equal(json.data.total_collected, 1500);
    assert.equal(json.data.total_delivery_fee, 120);
    assert.equal(json.data.net_payable, 1380);
  });

  it('lists orders that are still awaiting an invoice', async () => {
    const { json } = await call('/api/orders?invoiced=false');
    assert.ok(json.data.some((order: any) => order.consignment_id === 'DT-NEW'));
    assert.ok(!json.data.some((order: any) => order.consignment_id === 'DT-IMPORT'));
  });

  it('404s for an unknown invoice', async () => {
    const { status } = await call('/api/invoices/NOPE');
    assert.equal(status, 404);
  });

  it('surfaces a failed sync as a per-order failure rather than a 500', async () => {
    const { status, json } = await call('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ limit: 10 }),
    });

    assert.equal(status, 200);
    assert.equal(json.data.checked, 3);
    // DT-NEW has no stubbed info route, so it fails while the two imports succeed.
    assert.equal(json.data.updated, 2);
    assert.equal(json.data.failures.length, 1);
    assert.equal(json.data.failures[0].consignmentId, 'DT-NEW');
  });
});
