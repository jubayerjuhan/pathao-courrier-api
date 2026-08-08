import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PathaoClient } from '../src/pathao/client.js';
import { PathaoApiError } from '../src/pathao/errors.js';
import { MemoryTokenStore } from '../src/pathao/tokenStore.js';
import { createFetchStub, envelope, testCredentials, tokenResponse } from './helpers.js';

const ISSUE = 'POST /aladdin/api/v1/issue-token';

function makeClient(routes: Parameters<typeof createFetchStub>[0]) {
  const { fetchImpl, calls } = createFetchStub({ [ISSUE]: tokenResponse('access-1'), ...routes });
  const client = new PathaoClient({
    credentials: testCredentials,
    tokenStore: new MemoryTokenStore(),
    fetchImpl,
    timeoutMs: 5000,
  });
  return { client, calls };
}

describe('PathaoClient', () => {
  it('creates an order and unwraps the envelope', async () => {
    const { client, calls } = makeClient({
      'POST /aladdin/api/v1/orders': envelope({
        consignment_id: 'DT120000',
        merchant_order_id: 'ORD-1',
        order_status: 'Pending',
        delivery_fee: 80,
      }),
    });

    const order = await client.createOrder({
      store_id: 1,
      recipient_name: 'Demo Recipient',
      recipient_phone: '01700000000',
      recipient_address: 'House 123, Road 4, Sector 10, Uttara, Dhaka-1230',
      delivery_type: 48,
      item_type: 2,
      item_quantity: 1,
      item_weight: '0.5',
      amount_to_collect: 900,
    });

    assert.equal(order.consignment_id, 'DT120000');
    assert.equal(order.delivery_fee, 80);

    const orderCall = calls.find((call) => call.url.endsWith('/orders'))!;
    assert.equal(orderCall.headers['Authorization'], 'Bearer access-1');
  });

  it('flattens the doubly-nested list payloads', async () => {
    const { client } = makeClient({
      'GET /aladdin/api/v1/city-list': envelope({
        data: [
          { city_id: 1, city_name: 'Dhaka' },
          { city_id: 2, city_name: 'Chittagong' },
        ],
      }),
      'GET /aladdin/api/v1/cities/1/zone-list': envelope({
        data: [{ zone_id: 298, zone_name: '60 feet' }],
      }),
      'GET /aladdin/api/v1/zones/298/area-list': envelope({
        data: [
          { area_id: 37, area_name: 'Bonolota', home_delivery_available: true, pickup_available: true },
        ],
      }),
    });

    assert.deepEqual(
      (await client.listCities()).map((city) => city.city_name),
      ['Dhaka', 'Chittagong'],
    );
    assert.equal((await client.listZones(1))[0]!.zone_id, 298);
    assert.equal((await client.listAreas(298))[0]!.area_name, 'Bonolota');
  });

  it('re-issues the token and replays the call once on a 401', async () => {
    const { client, calls } = makeClient({
      [ISSUE]: [tokenResponse('access-1'), tokenResponse('access-2')],
      'GET /aladdin/api/v1/orders/DT1/info': [
        { status: 401, body: { message: 'Unauthenticated.' } },
        envelope({
          consignment_id: 'DT1',
          merchant_order_id: null,
          order_status: 'Delivered',
          order_status_slug: 'Delivered',
          updated_at: '2024-11-20 15:11:40',
          invoice_id: 'INV-9',
        }),
      ],
    });

    const info = await client.getOrderInfo('DT1');
    assert.equal(info.invoice_id, 'INV-9');

    const infoCalls = calls.filter((call) => call.url.includes('/orders/DT1/info'));
    assert.equal(infoCalls.length, 2);
    assert.equal(infoCalls[0]!.headers['Authorization'], 'Bearer access-1');
    assert.equal(infoCalls[1]!.headers['Authorization'], 'Bearer access-2');
  });

  it('surfaces validation errors as PathaoApiError with the field map intact', async () => {
    const { client } = makeClient({
      'POST /aladdin/api/v1/orders': {
        status: 422,
        body: {
          message: 'The given data was invalid.',
          errors: { recipient_phone: ['The recipient phone must be 11 characters.'] },
        },
      },
    });

    await assert.rejects(
      () =>
        client.createOrder({
          store_id: 1,
          recipient_name: 'Demo',
          recipient_phone: '017',
          recipient_address: 'House 123, Road 4, Sector 10, Uttara',
          delivery_type: 48,
          item_type: 2,
          item_quantity: 1,
          item_weight: 0.5,
          amount_to_collect: 0,
        }),
      (error: unknown) => {
        assert.ok(error instanceof PathaoApiError);
        assert.equal(error.status, 422);
        assert.deepEqual(error.errors, {
          recipient_phone: ['The recipient phone must be 11 characters.'],
        });
        return true;
      },
    );
  });

  it('reports bulk acceptance from the 202 response', async () => {
    const { client } = makeClient({
      'POST /aladdin/api/v1/orders/bulk': { status: 202, body: { code: 202, data: true } },
    });

    const accepted = await client.createBulkOrders([
      {
        store_id: 1,
        recipient_name: 'Demo Recipient One',
        recipient_phone: '01700000000',
        recipient_address: 'House 123, Road 4, Sector 10, Uttara, Dhaka',
        delivery_type: 48,
        item_type: 2,
        item_quantity: 2,
        item_weight: '0.5',
        amount_to_collect: 100,
      },
    ]);

    assert.equal(accepted, true);
  });
});
