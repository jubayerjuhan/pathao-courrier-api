import { Router } from 'express';
import type { AppContext } from '../context.js';
import { asyncHandler, intParam, stringParam } from './helpers.js';

export function invoiceRoutes(ctx: AppContext): Router {
  const router = Router();

  /** Portfolio-wide totals for the dashboard header. */
  router.get('/summary', (_req, res) => {
    res.json({ data: ctx.invoices.totals() });
  });

  /** Orders Pathao has not invoiced yet — the "pending billing" bucket. */
  router.get('/unbilled', (req, res) => {
    const orders = ctx.orders.list({
      invoiced: false,
      ...(stringParam(req.query.search) !== undefined
        ? { search: stringParam(req.query.search)! }
        : {}),
    });
    const totalCollected = orders.reduce((sum, order) => sum + order.amount_to_collect, 0);
    const totalDeliveryFee = orders.reduce((sum, order) => sum + order.delivery_fee, 0);
    res.json({
      data: {
        order_count: orders.length,
        total_collected: totalCollected,
        total_delivery_fee: totalDeliveryFee,
        net_payable: totalCollected - totalDeliveryFee,
        orders,
      },
    });
  });

  /** All invoices derived from the tracked orders. */
  router.get('/', (req, res) => {
    const search = stringParam(req.query.search);
    const storeId = intParam(req.query.store_id);
    const limit = intParam(req.query.limit);
    const offset = intParam(req.query.offset);

    const data = ctx.invoices.list({
      ...(search !== undefined ? { search } : {}),
      ...(storeId !== undefined ? { storeId } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });

    res.json({ data, meta: { count: data.length } });
  });

  /** One invoice plus the consignments that make it up. */
  router.get(
    '/:invoiceId',
    asyncHandler(async (req, res) => {
      const invoiceId = req.params.invoiceId!;
      const invoice = ctx.invoices.findById(invoiceId);
      if (!invoice) {
        res.status(404).json({ error: { message: `No invoice found for id ${invoiceId}` } });
        return;
      }
      res.json({ data: { ...invoice, orders: ctx.orders.list({ invoiceId }) } });
    }),
  );

  return router;
}
