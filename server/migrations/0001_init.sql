-- users: Cloudflare Access identity (email = Access `sub`/email). org_id seam for future teams.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,        -- Access subject (sub)
  email       TEXT NOT NULL UNIQUE,
  org_id      TEXT,                    -- nullable: future org layer
  created_at  INTEGER NOT NULL         -- unix seconds
);

-- edits: metadata only; CSS-override diff blob lives in KV under diff:<id>
CREATE TABLE edits (
  id          TEXT PRIMARY KEY,        -- ULID, also the KV key suffix
  owner_id    TEXT NOT NULL REFERENCES users(id),
  target_url  TEXT NOT NULL,
  title       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_edits_owner ON edits(owner_id, created_at DESC);
