PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS push_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_at INTEGER,
  personal INTEGER NOT NULL DEFAULT 0 CHECK (personal IN (0, 1)),
  vynalth INTEGER NOT NULL DEFAULT 0 CHECK (vynalth IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_test_at INTEGER,
  CHECK (personal = 1 OR vynalth = 1)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_owner ON push_subscriptions(owner_id);

CREATE TABLE IF NOT EXISTS push_events (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL CHECK (account IN ('personal', 'vynalth')),
  email_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  event_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  snapshot_ready INTEGER NOT NULL DEFAULT 0 CHECK (snapshot_ready IN (0, 1)),
  UNIQUE (account, email_id)
);
CREATE INDEX IF NOT EXISTS push_events_age ON push_events(first_seen_at);

CREATE TABLE IF NOT EXISTS push_deliveries (
  event_id TEXT NOT NULL REFERENCES push_events(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'sending', 'retry', 'sent', 'failed', 'cancelled')),
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  sent_at INTEGER,
  PRIMARY KEY (event_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS push_deliveries_due ON push_deliveries(event_id, state, next_attempt_at);

INSERT OR IGNORE INTO push_meta(key, value) VALUES ('schema_version', '1');
