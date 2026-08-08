/** Delivery type codes accepted by the order and price-plan endpoints. */
export const DeliveryType = {
  Normal: 48,
  OnDemand: 12,
} as const;
export type DeliveryTypeCode = (typeof DeliveryType)[keyof typeof DeliveryType];

/** Item type codes accepted by the order and price-plan endpoints. */
export const ItemType = {
  Document: 1,
  Parcel: 2,
} as const;
export type ItemTypeCode = (typeof ItemType)[keyof typeof ItemType];

/** Every Pathao endpoint wraps its payload in this envelope. */
export interface PathaoEnvelope<T> {
  message: string;
  type: string;
  code: number;
  data: T;
}

/** List endpoints (cities, zones, areas, stores) nest the array one level deeper. */
export interface PathaoListData<T> {
  data: T[];
  total?: number;
  current_page?: number;
  per_page?: number;
  last_page?: number;
}

export interface IssueTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

export interface CreateStoreInput {
  name: string;
  contact_name: string;
  contact_number: string;
  secondary_contact?: string;
  otp_number?: string;
  address: string;
  city_id: number;
  zone_id: number;
  area_id: number;
}

export interface CreateStoreResponse {
  store_name: string;
}

export interface Store {
  store_id: number | string;
  store_name: string;
  store_address: string;
  is_active: number;
  city_id: number | string;
  zone_id: number | string;
  hub_id: number | string;
  is_default_store: boolean | number;
  is_default_return_store: boolean | number;
}

export interface CreateOrderInput {
  store_id: number;
  merchant_order_id?: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_secondary_phone?: string;
  recipient_address: string;
  recipient_city?: number;
  recipient_zone?: number;
  recipient_area?: number;
  delivery_type: DeliveryTypeCode | number;
  item_type: ItemTypeCode | number;
  special_instruction?: string;
  item_quantity: number;
  item_weight: number | string;
  item_description?: string;
  amount_to_collect: number;
}

export interface CreateOrderResponse {
  consignment_id: string;
  merchant_order_id: string | null;
  order_status: string;
  delivery_fee: number;
}

export interface OrderShortInfo {
  consignment_id: string;
  merchant_order_id: string | null;
  order_status: string;
  order_status_slug: string;
  updated_at: string | null;
  /** Populated by Pathao once the consignment has been invoiced. Null until then. */
  invoice_id: string | null;
}

export interface City {
  city_id: number;
  city_name: string;
}

export interface Zone {
  zone_id: number;
  zone_name: string;
}

export interface Area {
  area_id: number;
  area_name: string;
  home_delivery_available: boolean;
  pickup_available: boolean;
}

export interface PricePlanInput {
  store_id: number;
  item_type: ItemTypeCode | number;
  delivery_type: DeliveryTypeCode | number;
  item_weight: number;
  recipient_city: number;
  recipient_zone: number;
}

export interface PricePlan {
  price: number;
  discount: number;
  promo_discount: number;
  plan_id: number;
  cod_enabled: number;
  cod_percentage: number;
  additional_charge: number;
  final_price: number;
}
