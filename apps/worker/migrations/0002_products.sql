CREATE TABLE purchases (
  order_no TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  payment_status INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE entitlements (
  license_id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL REFERENCES purchases(order_no),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  device_id TEXT,
  license_token TEXT,
  issued_at INTEGER,
  state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','issued','activated','failed')),
  updated_at INTEGER NOT NULL,
  UNIQUE(order_no,product_id)
);
CREATE TABLE sessions_next (
  handoff_hash TEXT PRIMARY KEY,
  status_hash TEXT NOT NULL UNIQUE,
  license_id TEXT NOT NULL REFERENCES entitlements(license_id),
  expires_at INTEGER NOT NULL,
  status_expires_at INTEGER NOT NULL,
  device_id TEXT,
  request_id TEXT,
  receipt_hash TEXT UNIQUE,
  receipt_expires_at INTEGER
);
CREATE TABLE outbox_next (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES entitlements(license_id),
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
INSERT INTO purchases SELECT order_no,buyer_id,plan_id,payment_status,updated_at FROM orders;
-- Every license issued before this migration belongs to this original application.
INSERT INTO entitlements SELECT license_id,order_no,'com.komoridev.tankturmoil','坦克动荡',device_id,license_token,issued_at,state,updated_at FROM orders;
INSERT INTO sessions_next SELECT s.handoff_hash,s.status_hash,o.license_id,s.expires_at,s.status_expires_at,s.device_id,s.request_id,s.receipt_hash,s.receipt_expires_at FROM sessions s JOIN orders o ON o.order_no=s.order_no;
INSERT INTO outbox_next SELECT b.id,o.license_id,b.result,b.recipient,b.content,b.state,b.attempts,b.next_attempt,b.lease_until,b.lease_token,b.sent_at FROM outbox b JOIN orders o ON o.order_no=b.order_no;
DROP TABLE sessions;
DROP TABLE outbox;
DROP TABLE orders;
ALTER TABLE sessions_next RENAME TO sessions;
ALTER TABLE outbox_next RENAME TO outbox;
CREATE INDEX sessions_expiry ON sessions(status_expires_at);
CREATE INDEX outbox_pending ON outbox(state,next_attempt);
