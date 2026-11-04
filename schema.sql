CREATE TABLE IF NOT EXISTS polls (
  id            TEXT PRIMARY KEY,
  question      TEXT NOT NULL,
  options       TEXT NOT NULL,          -- JSON-Liste der Antworten
  country       TEXT NOT NULL,          -- Ländercode (AT, FR …) oder INT
  author_name   TEXT NOT NULL,
  author_client TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  approved      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS polls_country ON polls (country, created_at);

CREATE TABLE IF NOT EXISTS votes (
  poll_id    TEXT NOT NULL,
  client     TEXT NOT NULL,
  option     INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, client)
);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,
  poll_id       TEXT NOT NULL,
  text          TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  author_client TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  approved      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS comments_poll ON comments (poll_id, created_at);

-- Meldungen von Beiträgen (eine pro Browser und Beitrag)
CREATE TABLE IF NOT EXISTS reports (
  type       TEXT NOT NULL,             -- poll oder comment
  target_id  TEXT NOT NULL,
  client     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (type, target_id, client)
);

-- Schlagzeilen-Bot: Ereignisse aus Wikipedia "Portal:Current events" (CC BY-SA 4.0)
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  day          TEXT NOT NULL,          -- YYYY-MM-DD
  ord          INTEGER NOT NULL,
  section      TEXT,
  cats         TEXT NOT NULL,          -- ,politik,wirtschaft,
  countries    TEXT NOT NULL,          -- ,AT,DE,
  context      TEXT,
  text_en      TEXT NOT NULL,
  source_url   TEXT,
  source_label TEXT,
  headline_de  TEXT,                   -- KI-formulierte Schlagzeile
  summary_de   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_day ON events (day);

CREATE TABLE IF NOT EXISTS wiki_days (
  day        TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  n          INTEGER NOT NULL
);

-- Recherche-Bot: Artikel aus den RSS-Feeds europäischer Medien und daraus gebündelte Ereignisse
CREATE TABLE IF NOT EXISTS articles (
  id         TEXT PRIMARY KEY,          -- Hash des Links
  country    TEXT NOT NULL,
  outlet     TEXT NOT NULL,
  title      TEXT NOT NULL,
  link       TEXT NOT NULL,
  published  INTEGER NOT NULL,
  story_id   TEXT,                      -- NULL = noch nicht geprüft, '-' = keine Nachricht
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS articles_open ON articles (country, story_id, published);
CREATE INDEX IF NOT EXISTS articles_story ON articles (story_id);

CREATE TABLE IF NOT EXISTS stories (
  id         TEXT PRIMARY KEY,
  country    TEXT NOT NULL,
  cat        TEXT NOT NULL,
  headline   TEXT NOT NULL,             -- KI-formulierte Schlagzeile
  summary    TEXT,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  outlets    INTEGER NOT NULL           -- Anzahl verschiedener Medien (Doppelcheck)
);
CREATE INDEX IF NOT EXISTS stories_q ON stories (country, cat, last_seen);

CREATE TABLE IF NOT EXISTS feed_state (
  url        TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);
