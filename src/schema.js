export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS short_links (
  code varchar(32) PRIMARY KEY,
  owner_id varchar(128) NOT NULL,
  target_url text NOT NULL,
  request_key varchar(128) NOT NULL,
  request_digest char(64) NOT NULL,
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms bigint,
  state varchar(16) NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deactivated')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  deactivated_at_ms bigint,
  CONSTRAINT short_links_owner_request_uniq UNIQUE (owner_id, request_key),
  CONSTRAINT short_links_expiry_after_create CHECK (expires_at_ms IS NULL OR expires_at_ms > created_at_ms),
  CONSTRAINT short_links_deactivation_shape CHECK (
    (state = 'active' AND deactivated_at_ms IS NULL)
    OR (state = 'deactivated' AND deactivated_at_ms IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS redirect_events (
  event_id uuid PRIMARY KEY,
  code varchar(32) NOT NULL REFERENCES short_links(code),
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0)
);

CREATE INDEX IF NOT EXISTS redirect_events_code_time_idx
  ON redirect_events (code, occurred_at_ms);
`;
