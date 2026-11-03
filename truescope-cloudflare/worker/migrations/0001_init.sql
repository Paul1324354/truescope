-- TrueScope D1 schema (SQLite). Timestamps are epoch milliseconds (UTC).
-- Designed for the D1 free tier: every hot query is index-backed so that
-- "rows read" stays proportional to the result size, not to the table size.

CREATE TABLE countries (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  flag TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  extra_keywords TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  website TEXT NOT NULL,
  feed_url TEXT UNIQUE,
  country_code TEXT REFERENCES countries(code),
  source_type TEXT NOT NULL DEFAULT 'other',
  owner_group TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  base_reliability REAL NOT NULL DEFAULT 0.6,
  rationale TEXT NOT NULL DEFAULT '',
  corrections_90d INTEGER NOT NULL DEFAULT 0,
  wire_key TEXT,
  requires_license INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  fetch_interval_min INTEGER NOT NULL DEFAULT 60,
  last_fetched_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  last_modified TEXT,
  robots_checked_at INTEGER,
  robots_allowed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX ix_sources_due ON sources(active, requires_license, last_fetched_at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_updated INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  score INTEGER,
  last_verified INTEGER,
  breaking INTEGER NOT NULL DEFAULT 0,
  article_count INTEGER NOT NULL DEFAULT 0,
  independent_count INTEGER NOT NULL DEFAULT 0,
  categories TEXT NOT NULL DEFAULT '',      -- csv of slugs
  countries TEXT NOT NULL DEFAULT '{}',     -- JSON {code: relation}
  relevant TEXT NOT NULL DEFAULT '',        -- csv of country codes used by the filter
  source_names TEXT NOT NULL DEFAULT '',    -- csv, for cards and source filter
  facts TEXT NOT NULL DEFAULT '{}',         -- JSON: 5W, confirmed, unclear, contradictions, explanation, factors
  entities TEXT NOT NULL DEFAULT '[]',
  centroid TEXT NOT NULL DEFAULT '{}',
  image_url TEXT,
  generated_by TEXT NOT NULL DEFAULT 'tsie-extractive',
  manual_override INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  needs_assessment INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_events_recent ON events(archived, last_updated DESC);
CREATE INDEX ix_events_assess ON events(needs_assessment, last_updated);

-- Denormalised lookup: one row per (event, key) where key = 'c:AT' (relevant
-- country) or 'k:politik' (category). Keeps filtered queries index-only.
CREATE TABLE event_index (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  last_updated INTEGER NOT NULL,
  PRIMARY KEY (event_id, key)
);
CREATE INDEX ix_event_index_key ON event_index(key, last_updated DESC);

CREATE VIRTUAL TABLE events_fts USING fts5(title, summary, entities, sources, tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',          -- feed teaser only, never the full article
  url TEXT NOT NULL UNIQUE,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  published_at INTEGER NOT NULL,
  collected_at INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  feed_categories TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  analysis TEXT,                             -- JSON TSIE analysis
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  group_key TEXT,
  similarity REAL,
  processed INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_articles_pending ON articles(processed, published_at);
CREATE INDEX ix_articles_event ON articles(event_id, published_at);
CREATE INDEX ix_articles_hash ON articles(source_id, content_hash);
CREATE INDEX ix_articles_collected ON articles(collected_at);

CREATE TABLE verification_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  score INTEGER,
  explanation TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  trigger TEXT NOT NULL DEFAULT 'pipeline',
  engine_version TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_reports_event ON verification_reports(event_id, created_at DESC);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iterations INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  preferences TEXT NOT NULL DEFAULT '{}',
  notifications_seen_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE saved (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE history (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX ix_history_user ON history(user_id, read_at DESC);

CREATE TABLE login_attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX ix_login_attempts ON login_attempts(key, at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE misratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_id INTEGER,
  reason TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                       -- fetch | analyze | maintenance | manual_fetch
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',   -- running | ok | error | skipped
  batch INTEGER NOT NULL DEFAULT 0,
  stats TEXT NOT NULL DEFAULT '{}',
  error TEXT
);
CREATE INDEX ix_jobs_kind ON job_runs(kind, started_at DESC);

CREATE TABLE errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_errors_time ON errors(created_at DESC);

-- Usage accounting for the free-tier guard (one row per UTC day).
CREATE TABLE usage_daily (
  day TEXT PRIMARY KEY,
  cron_runs INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  rows_read INTEGER NOT NULL DEFAULT 0,
  articles_new INTEGER NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
