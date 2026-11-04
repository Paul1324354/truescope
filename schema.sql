CREATE TABLE IF NOT EXISTS polls (
  id            TEXT PRIMARY KEY,
  question      TEXT NOT NULL,
  options       TEXT NOT NULL,          -- JSON-Liste der Antworten
  country       TEXT NOT NULL,          -- Ländercode (AT, FR …) oder INT
  author_name   TEXT NOT NULL,
  author_client TEXT NOT NULL,
  created_at    INTEGER NOT NULL
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
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_poll ON comments (poll_id, created_at);
