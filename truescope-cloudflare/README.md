# TrueScope – See Beyond the Headlines (Cloudflare-Free-Edition)

KI-gestützte Nachrichtenplattform, die Meldungen aus echten RSS-Quellen in Österreich, Deutschland,
USA und UK sammelt, zu Ereignissen bündelt, **unabhängige Bestätigungen von bloßer Weiterverbreitung
unterscheidet**, Widersprüche erkennt und jede Bewertung nachvollziehbar begründet –
vollständig im **kostenlosen Cloudflare-Tarif**.

**Einrichtung für Anfänger:innen: siehe [ANLEITUNG.md](ANLEITUNG.md)** – im Kern `npm run setup`.

```
 Browser ──▶ Cloudflare Pages  (https://<name>.pages.dev)
             ├─ statische Website (Next.js Export)            → kostenlos & unbegrenzt
             └─ /api/*  Pages Function ──┐  gleiche Herkunft, Session-Cookie, 60 s Edge-Cache
                                         ▼
                      worker/src  (gemeinsamer Backend-Code, TypeScript, ohne Abhängigkeiten)
                                         ▲
 Cron Trigger (jede Minute) ──▶ Worker "truescope-api"  → Nachrichten-Bot + lesende öffentliche API
                                         │
                                  Cloudflare D1 (SQLite, FTS5-Suche)
                   optional: Workers AI (Gratis-Kontingent) nur für Formulierungen
```

## Was gegenüber der Docker-Version geändert wurde

| Docker-Version (`docker-version/`) | Cloudflare-Version |
|---|---|
| Python/FastAPI-Backend | TypeScript im Worker bzw. in der Pages Function (Workers führen kein FastAPI aus) |
| TSIE-Engine in Python | 1:1 nach TypeScript portiert, dieselben Regeln und Testfälle |
| PostgreSQL + Redis | D1 (SQLite) + FTS5-Volltextsuche, Cache API statt Redis |
| Worker-Prozess mit Warteschlange | Cron Trigger jede Minute, ein kleiner Schritt pro Lauf |
| bcrypt | PBKDF2-SHA256 (WebCrypto) + geheimer Pepper |
| E-Mail für Passwort-Reset | Admin setzt temporäres Passwort (kein kostenloser Mail-Dienst enthalten) |
| Benachrichtigungen als Datenbankzeilen | werden beim Abruf berechnet (spart Schreibzugriffe) |
| Next.js-Server | statischer Export; Detailseite unter `/event?id=…` |

Die Docker-Version liegt unverändert in `docker-version/`, falls du später auf einen eigenen Server
umziehen möchtest.

## Projektstruktur

```
worker/
  src/engine/        TSIE: sanitize, text, entities, classify, independence, claims, verification, engine
  src/rss.ts         RSS/Atom/RDF-Parser (nur Titel, Teaser, Link – nie ganze Artikel), robots.txt
  src/pipeline.ts    Cron-Pipeline: Abruf → Duplikate → Analyse → Clustering → Bewertung → Speichern
  src/budget.ts      Kosten-/Nutzungskontrolle (Tagesbudgets für D1)
  src/ai.ts          optionale Workers-AI-Zusammenfassung mit Absicherung
  src/auth.ts        Konten, Sessions, Brute-Force-Schutz
  src/routes/        public, account, admin
  src/app.ts         gemeinsamer Router für Pages Function und Worker
  src/index.ts       Worker-Einstieg (Cron + lesende API)
  migrations/        0001 Schema, 0002 Länder, Kategorien, echte Quellen
  test/              31 Tests (Engine + End-to-End mit D1-Nachbildung), CPU-Messung
  wrangler.toml      Worker-Konfiguration (Cron, D1, AI, Budgets)
frontend/
  src/               Next.js-App (Start, Detail, Suche, Profil, Admin, Methodik, Quellen)
  functions/api/     Pages Function → worker/src/app.ts
  wrangler.toml      Pages-Konfiguration (D1-Bindung)
scripts/setup.mjs    Einrichtung mit einem Befehl          scripts/update.mjs  erneut veröffentlichen
docker-version/      ursprüngliche Docker/PostgreSQL/Python-Version
```

## Nachrichtenquellen

31 öffentliche RSS-Feeds werden aktiv abgefragt (AT 6, DE 8, US 9, UK 6, dazu Al Jazeera und GDACS),
u. a. ORF, Der Standard, Die Presse, Kurier, tagesschau, ZDFheute, Spiegel, ZEIT, NPR, PBS, NYT,
BBC, Guardian, Sky News sowie USGS-Erdbebendaten als offizielle Primärquelle. Reuters, AP, AFP, APA,
dpa, Financial Times und ITV haben keinen frei nutzbaren Feed; sie sind als „Lizenz nötig“ hinterlegt
und werden trotzdem erkannt, wenn andere Medien sie zitieren.

Der Abruf respektiert robots.txt, nutzt ETag/Last-Modified, identifiziert sich mit eigenem User-Agent
und speichert nur Metadaten und Teaser. Quellen-Startwerte beruhen ausschließlich auf redaktionellen
Prozessmerkmalen, nie auf politischer Ausrichtung; Admins können alles ändern (mit Audit-Log).

## Verifizierungslogik (unverändert aus der Hauptversion)

* **Unabhängigkeit:** Agentur-Credits („(APA)“, „dpa/“, „laut Reuters“), gleiches Medienhaus oder nahezu
  identischer Text → eine Quellengruppe. Zehn Seiten mit derselben Agenturmeldung = eine Bestätigung.
* **Status:** RETRACTED → FALSE (≥ 2 unabhängige Widerlegungen) → DISPUTED (Widerspruch/Dementi) →
  VERIFIED (≥ 3 unabhängige glaubwürdige Gruppen + offizielle Bestätigung oder ≥ 4, älter als 2 h) →
  STRONGLY_CORROBORATED (≥ 2) → DEVELOPING (< 24 h) → UNCONFIRMED. Unbestätigt wird nie zu falsch.
* **Widersprüche:** jeweils der *neueste* Wert jeder unabhängigen Gruppe wird verglichen; steigende
  Opferzahlen sind Entwicklung, kein Widerspruch.
* **Confidence Score 0–100:** Quellenqualität 25, Unabhängigkeit 25, Übereinstimmung 20, offizielle
  Bestätigung 10, prüfbare Angaben 10, Stabilität 5, Korrekturen 5, Abzüge; je Status gedeckelt;
  **unter zwei glaubwürdigen Gruppen kein Score**.
* **Prompt-Injection:** externe Inhalte sind Daten, verdächtige Anweisungen werden markiert; die KI darf
  nur formulieren und wird verworfen, wenn sie Zahlen erfindet.

---

## Was im kostenlosen Tarif funktioniert – und was nicht

### Die relevanten Gratis-Grenzen von Cloudflare

| Dienst | Gratis-Grenze | Was bei Überschreitung passiert |
|---|---|---|
| Workers + Pages Functions | 100.000 Anfragen/Tag (zusammen), **10 ms CPU** pro Anfrage und pro Cron-Lauf, 50 Unteranfragen pro Lauf, 5 Cron Triggers pro Konto | Anfragen schlagen fehl (Fehler 1027 bzw. 1102), keine Kosten |
| Pages (statische Dateien) | unbegrenzt, kostenlos | – |
| D1 | 5 Mio. gelesene und 100.000 geschriebene Zeilen pro Tag, 5 GB Speicher | Abfragen schlagen bis 00:00 UTC fehl, keine Kosten |
| Workers AI | 10.000 Neurons/Tag | Aufrufe schlagen fehl, keine Kosten |

Im Free-Plan gibt es **keine nachträgliche Abrechnung**: Wird eine Grenze erreicht, funktioniert der
betroffene Teil bis zum Tageswechsel (00:00 UTC) nicht – es kann aber nie eine Rechnung entstehen,
solange du nicht selbst auf einen bezahlten Plan wechselst.

### Eingebaute Nutzungskontrollen

* **Tagesbudgets** (`worker/wrangler.toml`): die Pipeline zählt ihre D1-Zugriffe und stoppt den Import bei
  70.000 geschriebenen bzw. 4 Mio. gelesenen Zeilen – lange vor den Gratis-Grenzen. Ab 85 % wird nur
  noch analysiert, nicht mehr importiert. Höchstens 1.500 neue Artikel pro Tag.
* **CPU-Selbstregelung:** Jeder Cron-Lauf macht nur einen kleinen Schritt (2 Feeds *oder* wenige Artikel).
  Wird ein Lauf von Cloudflare abgebrochen, halbiert der nächste automatisch seine Stapelgröße;
  Artikel, die dreimal scheitern, werden übersprungen, damit nichts hängen bleibt.
* **Lesesparende Abfragen:** alle Listen laufen über Indizes (`event_index`) und FTS5, öffentliche
  Antworten werden 60 Sekunden am Edge zwischengespeichert.
* **Aufräumen:** Artikel und Ereignisse älter als 30 Tage werden täglich gelöscht (Speicher bleibt klein).
* **Not-Aus:** „Ingestion pausieren“ im Admin-Bereich; fehlerhafte Quellen deaktivieren sich nach 10 Fehlern.
* **Anzeige:** Admin → Übersicht zeigt den heutigen Verbrauch gegenüber Budget und Gratis-Grenze.

### Funktioniert vollständig

* Öffentliche Website unter `*.pages.dev` mit HTTPS, Dark/Light Mode, mobil optimiert
* Echter Nachrichtenimport aus 31 Quellen, Duplikaterkennung, Ereignis-Clustering
* Quellenvergleich, Unabhängigkeitsgruppen, Widerspruchserkennung, Status, Score und Begründung
* Länderfilter AT/DE/US/UK, Mehrfachauswahl, Global; weitere Länder per Klick im Admin aktivierbar
* Kategorien, Volltextsuche, Zeitfilter (1 h / 24 h / 7 Tage / 30 Tage / eigener Zeitraum), Quellenfilter
* Konten, Gastmodus, Einstellungen, Lesezeichen, Leseverlauf, In-App-Benachrichtigungen, DSGVO-Export und -Löschung
* Admin-Dashboard: Kennzahlen, Verbrauch, Quellenverwaltung, Bot-Steuerung, Korrekturen mit Audit-Log,
  Fehlbewertungen, Fehler- und Job-Protokoll, Länder, Benutzer

### Einschränkungen (ehrlich)

1. **Geschwindigkeit:** Der Bot schafft etwa 1.400–2.800 Artikel pro Tag; jeder Feed wird ungefähr alle
   30–60 Minuten abgefragt. Breaking News erscheinen daher mit einigen Minuten Verzögerung, nicht in Sekunden.
2. **10 ms CPU sind knapp.** In meinen Messungen braucht ein Analyse-Schritt mit 4 Artikeln 9–12 ms
   (warm) bzw. ~20–30 ms in einer frischen Instanz; der Standard-Schritt (2 Artikel, 1 Bewertung) liegt
   darunter. Einzelne abgebrochene Läufe sind möglich und werden automatisch ausgeglichen. Wie streng
   Cloudflare die Grenze im Einzelfall durchsetzt, lässt sich nur im Live-Betrieb beobachten (Admin → Jobs).
3. **Passwort-Hashing** ist wegen der CPU-Grenze schwächer als in der Docker-Version (12.000 statt
   ~600.000 PBKDF2-Runden). Ausgeglichen durch einen geheimen Pepper, der nicht in der Datenbank liegt,
   und Brute-Force-Sperren.
4. **Kein E-Mail-Versand** (dafür gibt es keinen kostenlosen Cloudflare-Dienst): Passwort-Reset über den Admin.
5. **Sprachübergreifendes Clustering** fehlt: Ein deutscher und ein englischer Bericht über dasselbe
   Ereignis landen oft in getrennten Ereignissen.
6. **Manche Medien blockieren Abrufe aus Rechenzentren** oder ändern ihre Feed-Adressen. Ich konnte die
   Feeds aus der Entwicklungsumgebung nicht live testen; betroffene Quellen erscheinen im Admin mit Fehler.
7. **Aktualität der Anzeige:** Öffentliche Seiten sind bis zu 60 Sekunden zwischengespeichert.
8. **Archiv:** nur die letzten 30 Tage (einstellbar über `RETENTION_DAYS`).
9. **Eigene Domain** ist optional und kostet Geld; die `pages.dev`-Adresse ist kostenlos.

## Tests

```bash
npm test                # 31 Tests: Engine + End-to-End (Worker-Code gegen D1-Nachbildung, Feeds simuliert)
cd worker && npm run cpu   # CPU-Messung eines Cron-Schritts
cd frontend && npm test    # Vitest
```

Abgedeckt: Agentur-Syndizierung zählt einmal · gleiches Medienhaus ist nicht unabhängig · Widersprüche →
DISPUTED · steigende Opferzahlen kein Widerspruch · Einzelquelle → DEVELOPING ohne Score · Unbestätigt ≠
falsch · FALSE/RETRACTED · junge Ereignisse gedeckelt · Meinungsbeiträge zählen nicht · Injection markiert ·
RSS/Atom/RDF-Parser · robots.txt · Duplikate/ETag · Länderfilter Ereignis- vs. Quellenland · Suche und
FTS-Absicherung · Konten, Rollen, Admin-Bootstrap · Brute-Force-Sperre · CSRF · Audit-Log · manuelle
Korrektur übersteht Neuanalyse · Budget-Wächter · Pause · lesende Worker-API · DSGVO-Löschung.

Nicht getestet werden konnte in der Entwicklungsumgebung (kein Zugriff auf npm und Cloudflare):
der Next.js-Build, das Bündeln durch Wrangler und der Live-Betrieb auf Cloudflare.

## Konfiguration (`worker/wrangler.toml`, Abschnitt `[vars]`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `ADMIN_EMAIL` | (vom Setup gesetzt) | Wer sich damit registriert, wird Admin |
| `AI_SUMMARIES` | `false` | Workers AI für Formulierungen |
| `AI_DAILY_CALLS` | `100` | Obergrenze KI-Aufrufe pro Tag |
| `MAX_FEEDS_PER_RUN` / `MAX_ANALYZE_PER_RUN` | `2` / `4` | Größe eines Cron-Schritts |
| `MAX_NEW_ARTICLES_PER_DAY` | `1500` | Import-Obergrenze |
| `DAILY_WRITE_BUDGET` / `DAILY_READ_BUDGET` | `70000` / `4000000` | Budgets unterhalb der D1-Gratis-Grenzen |
| `RETENTION_DAYS` | `30` | Aufbewahrung |

`PBKDF2_ITERATIONS` und `ADMIN_EMAIL` stehen zusätzlich in `frontend/wrangler.toml`; der Secret `PEPPER`
wird vom Setup einmalig zufällig gesetzt und darf danach nicht geändert werden.
