import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Database = DatabaseSync;

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

function applyMigrations(db: Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (existing.some((row) => row.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Opens the SQLite database and applies the schema.
 *
 * Pass `:memory:` for tests. Any other path has its parent directory created.
 */
export function openDatabase(file: string): Database {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  applyMigrations(db);
  return db;
}
