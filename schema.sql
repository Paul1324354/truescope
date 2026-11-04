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
  descr      TEXT DEFAULT '',           -- kurzer Feed-Anriss, nur als Eingabe für die KI, wird nie angezeigt
  words      INTEGER,                   -- gezählte Wörter der Artikelseite (nur die Zahl, kein Text) für die Lesezeit
  paywall    INTEGER DEFAULT 0,         -- 1 = Bezahlschranke erkannt
  measured_at INTEGER DEFAULT 0         -- Zeitpunkt der Messung (0 = noch nicht gemessen)
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
  detail_at  INTEGER DEFAULT 0,         -- Zeitpunkt der Erzeugung (für die Tagesgrenze)
  detail_v   INTEGER DEFAULT 0,         -- Version des Überblicks (2 = lange Zusammenfassung mit Quellenvergleich)
  compare_json TEXT DEFAULT '',         -- Quellenvergleich: [{topic, items:[{outlet, says}]}], [] = keine Unterschiede
  rank_json  TEXT DEFAULT '',           -- KI-Bewertung je Artikel: [{i: Artikel-ID, f: Faktendichte, s: Sachlichkeit}]
  rank_n     INTEGER DEFAULT 0,         -- Anzahl Artikel zum Zeitpunkt der Bewertung
  rank_at    INTEGER DEFAULT 0          -- Zeitpunkt der Bewertung (0 = noch nicht bewertet)
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

-- robots.txt der Medien (Zwischenspeicher), damit Artikelseiten nur dann abgerufen werden, wenn es erlaubt ist
CREATE TABLE IF NOT EXISTS robots (
  host       TEXT PRIMARY KEY,          -- Ursprung, z. B. https://www.beispiel.at
  body       TEXT,                      -- NULL = nicht abrufbar (dann wird nichts abgerufen)
  fetched_at INTEGER NOT NULL
);

-- Kontext-Bot: Mitteilungen offizieller Stellen (nur als Hintergrund für die KI, werden nicht angezeigt)
CREATE TABLE IF NOT EXISTS official (
  id         TEXT PRIMARY KEY,          -- Hash des Links
  country    TEXT NOT NULL,             -- Land oder EU (gilt für alle)
  body       TEXT NOT NULL,             -- Stelle, z. B. Europäisches Parlament
  title      TEXT NOT NULL,
  descr      TEXT DEFAULT '',
  published  INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS official_q ON official (country, published);

-- Geschätzter KI-Verbrauch je Tag (UTC) in Neurons, für die Reserve von „Mehr lesen“
CREATE TABLE IF NOT EXISTS ai_usage (
  day     TEXT PRIMARY KEY,
  neurons REAL NOT NULL DEFAULT 0
);

-- Bestehende Datenbank erweitern (einmalig, falls die Spalten fehlen):
-- ALTER TABLE stories ADD COLUMN detail_v INTEGER DEFAULT 0;
-- ALTER TABLE stories ADD COLUMN compare_json TEXT DEFAULT '';
