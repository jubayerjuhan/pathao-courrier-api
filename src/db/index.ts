import { createClient, type Client, type InValue } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every query in this app goes through these three methods.
 *
 * libSQL speaks SQLite's dialect but reaches the database over HTTP, so unlike
 * `node:sqlite`'s synchronous `DatabaseSync` each call is a promise. That is
 * what lets the database live off the filesystem — on Turso for deployments,
 * or a local file during development — instead of needing a mounted disk.
 */
export interface Database {
  run(sql: string, params?: Param[]): Promise<void>;
  get<T>(sql: string, params?: Param[]): Promise<T | null>;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  close(): void;
}

/** Bindable value. `undefined` is not one — pass an explicit null. */
export type Param = string | number | boolean | bigint | null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  access_token   TEXT    NOT NULL,
  refresh_token  TEXT    NOT NULL,
  token_type     TEXT    NOT NULL,
  expires_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  consignment_id      TEXT    PRIMARY KEY,
  merchant_order_id   TEXT,
  store_id            INTEGER,
  recipient_name      TEXT,
  recipient_phone     TEXT,
  recipient_address   TEXT,
  item_description    TEXT,
  item_quantity       INTEGER,
  item_weight         REAL,
  amount_to_collect   REAL    NOT NULL DEFAULT 0,
  delivery_fee        REAL    NOT NULL DEFAULT 0,
  order_status        TEXT,
  order_status_slug   TEXT,
  -- "Delivery", "Return" or "Exchange" as reported by GET /orders/all. Return
  -- and exchange rows are the back-leg of a parcel already counted as a
  -- delivery, so return-rate maths must exclude them. Null for orders created
  -- through this app, which are always forward deliveries.
  order_type          TEXT,
  invoice_id          TEXT,
  pathao_updated_at   TEXT,
  created_at          TEXT    NOT NULL,
  last_synced_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_invoice_id ON orders (invoice_id);
CREATE INDEX IF NOT EXISTS idx_orders_store_id   ON orders (store_id);
`;

/** Columns added after the first release, applied to databases already on disk. */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'orders', column: 'order_type', definition: 'TEXT' },
];

async function applyMigrations(db: Database): Promise<void> {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (existing.some((row) => row.name === column)) continue;
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function wrap(client: Client): Database {
  return {
    async run(sql, params = []) {
      await client.execute({ sql, args: params as InValue[] });
    },
    async get<T>(sql: string, params: Param[] = []) {
      const result = await client.execute({ sql, args: params as InValue[] });
      return (result.rows[0] as T | undefined) ?? null;
    },
    async all<T>(sql: string, params: Param[] = []) {
      const result = await client.execute({ sql, args: params as InValue[] });
      return result.rows as unknown as T[];
    },
    close() {
      client.close();
    },
  };
}

export interface DatabaseOptions {
  /**
   * `libsql://…` for Turso, `file:…` for a local file, `:memory:` for tests.
   */
  url: string;
  /** Required by Turso, meaningless for local files. */
  authToken?: string | undefined;
}

/**
 * Connects to the database and brings the schema up to date.
 *
 * Safe to call on every boot: the schema is all `IF NOT EXISTS` and the
 * migrations check `PRAGMA table_info` before touching anything.
 */
export async function openDatabase(options: DatabaseOptions): Promise<Database> {
  // Local development points at a file that may sit in a directory nobody has
  // created yet; libSQL will not make one for us.
  if (options.url.startsWith('file:')) {
    fs.mkdirSync(path.dirname(options.url.slice('file:'.length)), { recursive: true });
  }

  const client = createClient({
    url: options.url,
    ...(options.authToken ? { authToken: options.authToken } : {}),
  });
  const db = wrap(client);

  // executeMultiple takes the whole script; execute() is one statement only.
  await client.executeMultiple(SCHEMA);
  await applyMigrations(db);
  return db;
}
