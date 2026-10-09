CREATE TABLE IF NOT EXISTS puzzle_memberships (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES puzzle_users(id),
  plan TEXT NOT NULL CHECK(plan='puzzle'),
  status TEXT NOT NULL CHECK(status IN ('active','ended')),
  starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0,1)),
  CHECK(expires_at>starts_at)
);
CREATE TABLE IF NOT EXISTS puzzle_membership_orders (
  id TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL REFERENCES puzzle_users(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('paid','pending','failed','refunded')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS puzzle_membership_order_owner_idx ON puzzle_membership_orders(user_id,created_at);
