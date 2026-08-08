import type { PathaoCredentials } from '../config.js';
import { TokenManager } from './auth.js';
import { PathaoApiError } from './errors.js';
import { pathaoRequest, type FetchLike } from './http.js';
import type { TokenStore } from './tokenStore.js';
import type {
  Area,
  City,
  CreateOrderInput,
  CreateOrderResponse,
  CreateStoreInput,
  CreateStoreResponse,
  MerchantOrderPage,
  OrderShortInfo,
  PathaoEnvelope,
  PathaoListData,
  PricePlan,
  PricePlanInput,
  Store,
  Zone,
} from './types.js';

export interface PathaoClientOptions {
  credentials: PathaoCredentials;
  tokenStore: TokenStore;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  tokenLeewaySeconds?: number;
}

/**
 * Typed client for the Pathao Courier Merchant API.
 *
 * Covers every endpoint in the merchant integration docs. Authentication is
 * handled transparently: each call attaches the cached bearer token and, if
 * Pathao rejects it with a 401, re-issues the token once and replays the call.
 */
export class PathaoClient {
  readonly #credentials: PathaoCredentials;
  readonly #tokens: TokenManager;
  readonly #fetchImpl: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: PathaoClientOptions) {
    this.#credentials = options.credentials;
    this.#fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#tokens = new TokenManager({
      credentials: options.credentials,
      store: options.tokenStore,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
      leewaySeconds: options.tokenLeewaySeconds ?? 300,
    });
  }

  /** Exposed so callers can warm the token cache at boot. */
  async authenticate(): Promise<string> {
    return this.#tokens.getAccessToken();
  }

  // ---------------------------------------------------------------- stores

  /** POST /aladdin/api/v1/stores */
  async createStore(input: CreateStoreInput): Promise<CreateStoreResponse> {
    const envelope = await this.#authed<PathaoEnvelope<CreateStoreResponse>>({
      method: 'POST',
      path: '/aladdin/api/v1/stores',
      body: input,
    });
    return envelope.data;
  }

  /** GET /aladdin/api/v1/stores */
  async listStores(): Promise<Store[]> {
    const envelope = await this.#authed<PathaoEnvelope<PathaoListData<Store>>>({
      method: 'GET',
      path: '/aladdin/api/v1/stores',
    });
    return envelope.data?.data ?? [];
  }

  // ---------------------------------------------------------------- orders

  /** POST /aladdin/api/v1/orders */
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
    const envelope = await this.#authed<PathaoEnvelope<CreateOrderResponse>>({
      method: 'POST',
      path: '/aladdin/api/v1/orders',
      body: input,
    });
    return envelope.data;
  }

  /**
   * POST /aladdin/api/v1/orders/bulk
   *
   * Answers 202 with `data: true` — Pathao accepts the batch and creates the
   * orders asynchronously, so no consignment ids come back here.
   */
  async createBulkOrders(orders: CreateOrderInput[]): Promise<boolean> {
    if (orders.length === 0) {
      throw new Error('createBulkOrders requires at least one order.');
    }
    const envelope = await this.#authed<PathaoEnvelope<boolean>>({
      method: 'POST',
      path: '/aladdin/api/v1/orders/bulk',
      body: { orders },
    });
    return envelope.data === true;
  }

  /** GET /aladdin/api/v1/orders/{consignment_id}/info */
  async getOrderInfo(consignmentId: string): Promise<OrderShortInfo> {
    const envelope = await this.#authed<PathaoEnvelope<OrderShortInfo>>({
      method: 'GET',
      path: `/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`,
    });
    return envelope.data;
  }

  /**
   * GET /aladdin/api/v1/orders/all — one page of the merchant's own orders.
   *
   * Pathao paginates this at 40 rows; `listAllOrders` walks the pages.
   */
  async listOrdersPage(page = 1): Promise<MerchantOrderPage> {
    const envelope = await this.#authed<PathaoEnvelope<MerchantOrderPage>>({
      method: 'GET',
      path: `/aladdin/api/v1/orders/all?page=${page}`,
    });
    return envelope.data;
  }

  // ------------------------------------------------------------- locations

  /** GET /aladdin/api/v1/city-list */
  async listCities(): Promise<City[]> {
    const envelope = await this.#authed<PathaoEnvelope<PathaoListData<City>>>({
      method: 'GET',
      path: '/aladdin/api/v1/city-list',
    });
    return envelope.data?.data ?? [];
  }

  /** GET /aladdin/api/v1/cities/{city_id}/zone-list */
  async listZones(cityId: number): Promise<Zone[]> {
    const envelope = await this.#authed<PathaoEnvelope<PathaoListData<Zone>>>({
      method: 'GET',
      path: `/aladdin/api/v1/cities/${cityId}/zone-list`,
    });
    return envelope.data?.data ?? [];
  }

  /** GET /aladdin/api/v1/zones/{zone_id}/area-list */
  async listAreas(zoneId: number): Promise<Area[]> {
    const envelope = await this.#authed<PathaoEnvelope<PathaoListData<Area>>>({
      method: 'GET',
      path: `/aladdin/api/v1/zones/${zoneId}/area-list`,
    });
    return envelope.data?.data ?? [];
  }

  // --------------------------------------------------------------- pricing

  /** POST /aladdin/api/v1/merchant/price-plan */
  async calculatePrice(input: PricePlanInput): Promise<PricePlan> {
    const envelope = await this.#authed<PathaoEnvelope<PricePlan>>({
      method: 'POST',
      path: '/aladdin/api/v1/merchant/price-plan',
      body: input,
    });
    return envelope.data;
  }

  // ---------------------------------------------------------------- plumbing

  async #authed<T>(options: { method: 'GET' | 'POST'; path: string; body?: unknown }): Promise<T> {
    const send = (accessToken: string) =>
      pathaoRequest<T>({
        ...options,
        accessToken,
        baseUrl: this.#credentials.baseUrl,
        timeoutMs: this.#timeoutMs,
        fetchImpl: this.#fetchImpl,
      });

    try {
      return await send(await this.#tokens.getAccessToken());
    } catch (error) {
      if (error instanceof PathaoApiError && error.isAuthError) {
        // The cached token was revoked or expired early — one clean retry.
        return await send(await this.#tokens.forceRenew());
      }
      throw error;
    }
  }
}
