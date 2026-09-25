CREATE TABLE orders (
  order_no TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  license_id TEXT NOT NULL UNIQUE,
  device_id TEXT,
  license_token TEXT,
  issued_at INTEGER,
  state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','issued','activated','failed')),
  payment_status INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  handoff_hash TEXT PRIMARY KEY,
  status_hash TEXT NOT NULL UNIQUE,
  order_no TEXT NOT NULL REFERENCES orders(order_no),
  expires_at INTEGER NOT NULL,
  status_expires_at INTEGER NOT NULL,
  device_id TEXT,
  request_id TEXT,
  receipt_hash TEXT UNIQUE,
  receipt_expires_at INTEGER
);
CREATE INDEX sessions_expiry ON sessions(status_expires_at);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL REFERENCES orders(order_no),
  result TEXT NOT NULL CHECK(result IN ('activated','failed')),
  recipient TEXT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  sent_at INTEGER
);
CREATE INDEX outbox_pending ON outbox(state,next_attempt);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
