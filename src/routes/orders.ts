import { Router } from 'express';
import type { AppContext } from '../context.js';
import { asyncHandler, boolParam, intParam, stringParam } from './helpers.js';
import {
  bulkOrderSchema,
  createOrderSchema,
  importAllSchema,
  importOrdersSchema,
} from './schemas.js';

export function orderRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filters = {
        ...(stringParam(req.query.invoice_id) !== undefined
          ? { invoiceId: stringParam(req.query.invoice_id)! }
          : {}),
        ...(stringParam(req.query.status) !== undefined
          ? { status: stringParam(req.query.status)! }
          : {}),
        ...(stringParam(req.query.search) !== undefined
          ? { search: stringParam(req.query.search)! }
          : {}),
        ...(intParam(req.query.store_id) !== undefined
          ? { storeId: intParam(req.query.store_id)! }
          : {}),
        ...(boolParam(req.query.invoiced) !== undefined
          ? { invoiced: boolParam(req.query.invoiced)! }
          : {}),
      };
      const data = await ctx.orders.list(filters);
      res.json({ data, meta: { count: data.length } });
    }),
  );

  /** Creates the order at Pathao and starts tracking it locally. */
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = createOrderSchema.parse(req.body);
      const created = await ctx.orderService.createOrder(input);
      res.status(201).json({ data: created });
    }),
  );

  router.post(
    '/bulk',
    asyncHandler(async (req, res) => {
      const { orders } = bulkOrderSchema.parse(req.body);
      const accepted = await ctx.orderService.createBulkOrders(orders);
      res.status(202).json({
        data: { accepted },
        meta: {
          note: 'Pathao creates bulk orders asynchronously and returns no consignment ids. Import them with POST /api/orders/import once available.',
        },
      });
    }),
  );

  /** Tracks orders created outside this app so they can reach the invoice view. */
  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const { consignment_ids: entries } = importOrdersSchema.parse(req.body);
      const imported: unknown[] = [];
      const failed: { consignment_id: string; message: string }[] = [];

      for (const entry of entries) {
        try {
          imported.push(await ctx.orderService.importByConsignmentId(entry));
        } catch (error) {
          failed.push({
            consignment_id: typeof entry === 'string' ? entry : entry.consignment_id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      res.status(failed.length && !imported.length ? 502 : 200).json({
        data: { imported, failed },
        meta: { imported: imported.length, failed: failed.length },
      });
    }),
  );

  /** Pulls the merchant's entire Pathao order history into local tracking. */
  router.post(
    '/import-all',
    asyncHandler(async (req, res) => {
      const { max_pages: maxPages } = importAllSchema.parse(req.body ?? {});
      const report = await ctx.orderService.importAllFromPathao(
        maxPages !== undefined ? { maxPages } : {},
      );
      res.json({ data: report });
    }),
  );

  /** Local record plus a live short-info read from Pathao. */
  router.get(
    '/:consignmentId',
    asyncHandler(async (req, res) => {
      const consignmentId = req.params.consignmentId!;
      const local = await ctx.orders.findById(consignmentId);
      const remote = await ctx.client.getOrderInfo(consignmentId);
      res.json({ data: { local, remote } });
    }),
  );

  return router;
}
