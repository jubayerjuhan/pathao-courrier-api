import { z } from 'zod';

/**
 * Mirrors the field constraints stated in the Pathao merchant API docs so bad
 * payloads fail here with a readable message instead of as a remote 422.
 */
export const createOrderSchema = z.object({
  store_id: z.number().int().positive(),
  merchant_order_id: z.string().max(100).optional(),
  recipient_name: z.string().min(3).max(100),
  recipient_phone: z.string().regex(/^\d{11}$/, 'recipient_phone must be exactly 11 digits'),
  recipient_secondary_phone: z
    .string()
    .regex(/^\d{11}$/, 'recipient_secondary_phone must be exactly 11 digits')
    .optional(),
  recipient_address: z.string().min(10).max(220),
  recipient_city: z.number().int().positive().optional(),
  recipient_zone: z.number().int().positive().optional(),
  recipient_area: z.number().int().positive().optional(),
  delivery_type: z.union([z.literal(48), z.literal(12)]),
  item_type: z.union([z.literal(1), z.literal(2)]),
  special_instruction: z.string().max(500).optional(),
  item_quantity: z.number().int().positive(),
  item_weight: z.coerce.number().min(0.5).max(10),
  item_description: z.string().max(500).optional(),
  amount_to_collect: z.number().min(0),
});

export const bulkOrderSchema = z.object({
  orders: z.array(createOrderSchema).min(1).max(200),
});

export const createStoreSchema = z.object({
  name: z.string().min(3).max(50),
  contact_name: z.string().min(3).max(50),
  contact_number: z.string().regex(/^\d{11}$/, 'contact_number must be exactly 11 digits'),
  secondary_contact: z
    .string()
    .regex(/^\d{11}$/, 'secondary_contact must be exactly 11 digits')
    .optional(),
  otp_number: z
    .string()
    .regex(/^\d{11}$/, 'otp_number must be exactly 11 digits')
    .optional(),
  address: z.string().min(15).max(120),
  city_id: z.number().int().positive(),
  zone_id: z.number().int().positive(),
  area_id: z.number().int().positive(),
});

export const pricePlanSchema = z.object({
  store_id: z.number().int().positive(),
  item_type: z.union([z.literal(1), z.literal(2)]),
  delivery_type: z.union([z.literal(48), z.literal(12)]),
  item_weight: z.coerce.number().min(0.5).max(10),
  recipient_city: z.number().int().positive(),
  recipient_zone: z.number().int().positive(),
});

/**
 * An order to start tracking. `GET /orders/{id}/info` returns status and
 * invoice id but no money fields, so amounts may be supplied here — otherwise
 * the consignment lands on its invoice with a zero value.
 */
const importEntrySchema = z.union([
  z.string().min(1),
  z.object({
    consignment_id: z.string().min(1),
    store_id: z.number().int().positive().optional(),
    recipient_name: z.string().max(100).optional(),
    recipient_phone: z.string().max(20).optional(),
    recipient_address: z.string().max(220).optional(),
    item_description: z.string().max(500).optional(),
    amount_to_collect: z.number().min(0).optional(),
    delivery_fee: z.number().min(0).optional(),
  }),
]);

export const importOrdersSchema = z.object({
  consignment_ids: z.array(importEntrySchema).min(1).max(100),
});

export type ImportEntry = z.infer<typeof importEntrySchema>;

export const syncSchema = z.object({
  limit: z.number().int().positive().max(1000).optional(),
  only_uninvoiced: z.boolean().optional(),
  concurrency: z.number().int().positive().max(10).optional(),
});
