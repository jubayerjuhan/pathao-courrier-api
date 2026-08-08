import { Router } from 'express';
import type { AppContext } from '../context.js';
import { asyncHandler } from './helpers.js';
import { createStoreSchema, pricePlanSchema, syncSchema } from './schemas.js';

/** Stores, location lookups, price plan and the sync trigger. */
export function catalogRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/stores',
    asyncHandler(async (_req, res) => {
      res.json({ data: await ctx.client.listStores() });
    }),
  );

  router.post(
    '/stores',
    asyncHandler(async (req, res) => {
      const input = createStoreSchema.parse(req.body);
      res.status(201).json({ data: await ctx.client.createStore(input) });
    }),
  );

  router.get(
    '/cities',
    asyncHandler(async (_req, res) => {
      res.json({ data: await ctx.client.listCities() });
    }),
  );

  router.get(
    '/cities/:cityId/zones',
    asyncHandler(async (req, res) => {
      const cityId = Number(req.params.cityId);
      if (!Number.isInteger(cityId)) {
        res.status(400).json({ error: { message: 'cityId must be an integer' } });
        return;
      }
      res.json({ data: await ctx.client.listZones(cityId) });
    }),
  );

  router.get(
    '/zones/:zoneId/areas',
    asyncHandler(async (req, res) => {
      const zoneId = Number(req.params.zoneId);
      if (!Number.isInteger(zoneId)) {
        res.status(400).json({ error: { message: 'zoneId must be an integer' } });
        return;
      }
      res.json({ data: await ctx.client.listAreas(zoneId) });
    }),
  );

  router.post(
    '/price-plan',
    asyncHandler(async (req, res) => {
      const input = pricePlanSchema.parse(req.body);
      res.json({ data: await ctx.client.calculatePrice(input) });
    }),
  );

  /** Re-reads tracked orders from Pathao so new invoice ids show up. */
  router.post(
    '/sync',
    asyncHandler(async (req, res) => {
      const options = syncSchema.parse(req.body ?? {});
      const report = await ctx.syncService.syncOrders({
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.only_uninvoiced !== undefined
          ? { onlyUninvoiced: options.only_uninvoiced }
          : {}),
        ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
      });
      res.json({ data: report });
    }),
  );

  return router;
}
