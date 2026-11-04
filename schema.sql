-- Daumen hoch (1) / runter (-1) für Meldungen, eine Bewertung pro Browser-Kennung
CREATE TABLE IF NOT EXISTS reactions (
  story_id   TEXT NOT NULL,
  client     TEXT NOT NULL,
  value      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, client)
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
  created_at INTEGER NOT NULL,
  hint       TEXT,                      -- Ressort-Hinweis aus dem Feed
  descr      TEXT DEFAULT ''            -- kurzer Feed-Anriss, nur als Eingabe für die KI, wird nie angezeigt
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
  outlets    INTEGER NOT NULL,          -- Anzahl verschiedener Medien (Doppelcheck)
  domestic   INTEGER NOT NULL DEFAULT 1, -- 1 = betrifft das Land selbst, 0 = Auslandsmeldung
  detail     TEXT DEFAULT '',           -- KI-Überblick für „Mehr lesen“ (wird beim ersten Öffnen erzeugt)
  detail_n   INTEGER DEFAULT 0,         -- Anzahl Artikel, aus denen der Überblick entstand
  detail_at  INTEGER DEFAULT 0          -- Zeitpunkt der Erzeugung (für die Tagesgrenze)
);
CREATE INDEX IF NOT EXISTS stories_q ON stories (country, cat, last_seen);

CREATE TABLE IF NOT EXISTS feed_state (
  url        TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
  name  TEXT PRIMARY KEY,
  until INTEGER NOT NULL
);
