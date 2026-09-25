CREATE TABLE outbox_v3 (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES entitlements(license_id),
  result TEXT NOT NULL CHECK(result IN ('activated','failed','guide')),
  recipient TEXT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  sent_at INTEGER
);
INSERT INTO outbox_v3 SELECT * FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_v3 RENAME TO outbox;
CREATE INDEX outbox_pending ON outbox(state,next_attempt);
