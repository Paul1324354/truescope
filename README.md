# TrueScope

Nachrichten nach Land, Ressort und Zeitraum (24 Stunden, Woche, Monat; zuerst 80 Meldungen, mit „Mehr anzeigen“ bis 400), mit International-Ansicht, KI-Überblick, Ranking der Quellen und Daumen-Bewertungen.
Läuft auf Cloudflare Pages mit einer D1-Datenbank, erreichbar unter https://truescope.dev (und www.truescope.dev; dazu https://truescope-49p.pages.dev).

## Aufbau

- `public/index.html`: die App (eine Seite, ohne Build-Schritt). Bei jedem Besuch erscheint ein Startbildschirm (Slogan, drei Kernpunkte, Knopf „Zu den Nachrichten“); innerhalb desselben Tabs nur einmal (`sessionStorage`-Eintrag `ts-intro`), geteilte Links zu einer Meldung (`#s=`) überspringen ihn. Aufbau der App: dunkle Filterleiste links, Meldungsliste rechts, Seitenfenster „Mehr lesen“. Schriften (Archivo, Literata, beide OFL) liegen selbst gehostet in `public/fonts/`, das Aussehen der Rechtsseiten steht in `public/legal.css`.
- `functions/api/news.js`: Recherche-Bot. Liest die RSS-Feeds mehrerer Medien pro europäischem Land (`lib/feeds.js`, Leser in `lib/rss.js`), bündelt Artikel verschiedener Medien zum selben Ereignis (Doppelcheck: ab 2 Medien „bestätigt“) und lässt Workers AI eine eigene deutsche Schlagzeile schreiben. Angezeigt werden nur KI-Schlagzeile und Links zu den Originalen.
- `functions/api/search.js`: Suche (`GET /api/search?q=&country=`): durchsucht KI-Schlagzeilen, Kurzfassungen und Originalschlagzeilen der letzten 30 Tage und erkennt Mediennamen ("ORF", "Der Standard", auch ohne Artikel wie "Standard"): dann kommen alle Meldungen mit einem Artikel dieses Mediums dazu; ein Medium aus einem anderen Land wechselt die Suche in dessen Land. Alle Wörter müssen vorkommen; 60 Treffer je Seite, mit `offset` mehr; `country=EU` = ganz Europa. Suchleiste oben in der Kopfzeile (am Handy hinter dem Lupen-Symbol).
- `functions/api/story.js`: Detailansicht („Mehr lesen“). `GET /api/story?id=` liefert die Quellen mit Originalschlagzeile und Link und schreibt beim ersten Öffnen in einem KI-Aufruf eine ausführliche Zusammenfassung (3–5 Absätze, 220–380 Wörter, also 1–2 Minuten Lesezeit, in eigenen Worten) und einen Quellenvergleich (wo die Medien Unterschiedliches angeben, z. B. „Medium A: 100 Menschen, Medium B: 85 Menschen“; Feld `compare`). Beides wird gespeichert, höchstens 250 neue pro Tag; ältere kurze Überblicke werden beim nächsten Öffnen einmal neu geschrieben. `GET /api/story?id=&part=rank` liefert das Ranking der Quellen (siehe unten). Die Feed-Anrisse (`articles.descr`) dienen nur als Eingabe für die KI und werden nie ausgeliefert.
- `lib/context.js`: Kontext-Bot. Lässt die KI bis zu 3 Suchbegriffe (Eigennamen) zur Meldung nennen, holt dazu die Einleitung aus Wikipedia (deutsch, sonst englisch) und passende Mitteilungen offizieller Stellen (Liste `OFFICIAL`, Feeds stündlich in Tabelle `official`, 14 Tage behalten). Das dient nur als Hintergrund für die Zusammenfassung; die Artikel der Medien liest er nicht, Wikipedia-Texte werden nicht gespeichert, und als Quellen angezeigt werden weiterhin nur die Medien. Weitere offizielle Feeds einfach in `OFFICIAL` ergänzen.
- `lib/readtime.js`: Lesezeit-Messung (robots.txt prüfen, Seite abrufen, nur Wörter zählen, Bezahlschranke erkennen)
- `lib/bot.js`: gemeinsame Helfer für KI-Aufruf und Sperren
- `functions/api/react.js`: Daumen hoch / runter für Meldungen (eine Bewertung pro Browser-Kennung, umschaltbar; Zählung für viele Meldungen auf einmal)
- `public/impressum.html`, `datenschutz.html`: rechtliche Seiten (Platzhalter im Impressum und in der Datenschutzerklärung ausfüllen!)
- `schema.sql`: Tabellen der D1-Datenbank
- `wrangler.toml`: Cloudflare-Einstellungen (Datenbank-Bindung `DB`)

## Auf Cloudflare Pages veröffentlichen

1. Cloudflare-Dashboard: **Workers & Pages → Erstellen → Pages → Mit Git verbinden**.
2. Dieses Repo auswählen. Framework: **Keins**. Build-Befehl: leer lassen. Ausgabeverzeichnis: `public`.
3. **Speichern und bereitstellen.** Die Datenbank-Bindung `DB` kommt aus `wrangler.toml`.
   Falls sie fehlt: Projekt → Einstellungen → Bindungen → D1-Datenbank `truescope` als `DB` hinzufügen und neu bereitstellen.

Danach wird jede Änderung auf GitHub automatisch veröffentlicht.

## Konten (Anmeldung)

Freiwillige Konten mit Vor- und Nachname, E-Mail-Adresse und Passwort. Knopf oben rechts im Startbildschirm und oben links auf der Hauptseite; man kann auch ohne Konto fortfahren. Angemeldete sehen im Startbildschirm „Hallo <Vorname>!“.

- `functions/api/auth/[action].js`: `me`, `register`, `verify`, `login`, `logout`, `forgot`, `reset`, `delete`; Hilfen in `lib/auth.js`.
- Ein Konto entsteht erst nach Klick auf den Bestätigungslink (48 Stunden gültig). Passwort-Links gelten eine Stunde und nur einmal; nach dem Zurücksetzen werden alle Sitzungen beendet.
- Passwörter: PBKDF2-SHA-256 mit Salz. Sitzung: HttpOnly-Cookie `ts_session` (30 Tage), in der Datenbank nur als Hash. Anfragen werden je IP-Adresse und E-Mail-Adresse begrenzt; die Antworten verraten nicht, ob eine Adresse registriert ist.
- Tabellen: `users`, `sessions`, `auth_tokens`, `auth_limits` (siehe `schema.sql`).

**E-Mail-Versand einrichten** (Cloudflare Email Service, im Workers-Paid-Plan 3.000 E-Mails pro Monat inklusive). Solange das fehlt, ist die Registrierung abgeschaltet und die App zeigt einen Hinweis:

1. Eine eigene Domain, deren DNS bei Cloudflare liegt.
2. Dashboard → **Compute → Email Service → Email Sending → Onboard Domain**, Domain auswählen (Cloudflare legt SPF, DKIM und DMARC selbst an).
3. Dashboard → **Mein Profil → API-Tokens → Token erstellen** mit der Berechtigung **Email Sending: Edit**.
4. Pages-Projekt → **Einstellungen → Variablen und Geheimnisse**: Geheimnis `EMAIL_API_TOKEN` mit diesem Token anlegen.
5. In `wrangler.toml` `EMAIL_FROM` auf die Absenderadresse setzen (z. B. `noreply@deine-domain.at`) und veröffentlichen.

## KI-Kontingent

Workers AI ist bis 10.000 Neurons pro Tag kostenlos (Tageswechsel 0 Uhr UTC, also 1 Uhr österreichischer Winterzeit). Damit es reicht:

- **Reserve für „Mehr lesen“:** `lib/bot.js` schätzt den Verbrauch jedes KI-Aufrufs (Tabelle `ai_usage`). Der Recherche-Bot hört bei `BOT_BUDGET` (15.000 Neurons pro Tag) auf; was über die 10.000 Gratis-Neurons hinausgeht, wird im Workers-Paid-Plan abgerechnet (0,011 US-Dollar je 1.000 Neurons). „Mehr lesen“ ist zusätzlich über `DETAIL_CAP` und `RANK_CAP` begrenzt.
- Nur günstige Modelle (Gemma, GLM); das teure Llama 3.3 70B ist gestrichen.
- Der automatische Bot läuft alle 5 Minuten (GitHub startet geplante Läufe oft etwas verspätet) und nur für Österreich, Deutschland, Schweiz und International (`.github/workflows/bot.yml`). Alle anderen Länder werden aufgefüllt, sobald jemand sie auswählt. Feeds werden höchstens alle 4 Minuten abgerufen; die KI ordnet erst zu, wenn mindestens 8 neue Artikel warten oder der älteste 15 Minuten alt ist (spart die wiederholt mitgeschickte Liste bekannter Meldungen).
- Artikel, die nach 24 Stunden noch nicht zugeordnet sind, werden verworfen statt nachgearbeitet.

## Ranking der Quellen und Lesezeit

Beim Öffnen einer Meldung wird je Medium der früheste Artikel bewertet (höchstens 10 Medien):

- **Faktendichte und Sachlichkeit** (1–10) schätzt die KI aus Titel und Anriss (ein Aufruf je Meldung, höchstens 150 pro Tag, Ergebnis in `stories.rank_json`). Das ist eine Einschätzung des einzelnen Artikels, nicht des Mediums.
- **Tempo**: wer zuerst berichtet (fällt über die Stunden Abstand ab). **Umfang**: gezählte Wörter der Artikelseite.
- Gesamtwertung = 0,4 Fakten + 0,25 Sachlichkeit + 0,15 Tempo + 0,2 Umfang (fehlende KI-Werte oder unbekannter Umfang zählen als Durchschnitt der übrigen Medien, damit fehlende Daten weder belohnen noch bestrafen; hat niemand solche Werte, entfällt der Teil für alle; Bezahlschranke −1). „Beste Quelle“ gibt es nur, wenn die KI bewertet hat und mindestens 2 Medien vorliegen. Ohne KI (Kontingent leer) wird nach Tempo und Umfang sortiert und das angezeigt.
- **Lesezeit** = Wörter ÷ 200, gerundet. Dafür ruft der Server die Artikelseite einmal ab (`User-Agent: TrueScope/1.0 (+https://truescope.dev/; Lesezeit-Messung)`). Vorher wird die robots.txt des Mediums geprüft (24 Stunden zwischengespeichert in `robots`; Gruppe `TrueScope`, sonst `*`). Es wird **nichts abgerufen**, wenn der Abruf nicht erlaubt ist, die robots.txt nicht erreichbar ist (alles außer 404/410) oder ein Vorbehalt vorliegt (`tdm-reservation: 1`, `X-Robots-Tag`/Meta `noai`). Gespeichert werden nur `articles.words`, `paywall` und `measured_at`, nie Text.
- Medien können den Abruf selbst sperren: `User-agent: TrueScope` / `Disallow: /` in der robots.txt.

## Bewertungen

Die Daumen speichern nur Meldung, Wert (1 oder -1), zufällige Browser-Kennung und Zeitpunkt in der Tabelle `reactions`. Es gibt keine Namen, Texte oder Konten und damit nichts zu moderieren.
Der frühere Bereich „Abstimmungen“ (mit Kommentaren) wurde entfernt. Seine Tabellen (`polls`, `votes`, `comments`, `reports`, `events`, `wiki_days`) stehen in einer bestehenden Datenbank noch, werden aber nicht mehr benutzt und stehen nicht mehr in `schema.sql`. Eine vorhandene Variable `ADMIN_KEY` wird nicht mehr gebraucht.

## Rechtliches

- Nachrichten: eigene KI-Schlagzeilen und KI-Überblicke, keine Artikeltexte, nur Links (mit Namen des Mediums und Originalüberschrift als Linktext) zu den Originalartikeln (§ 76f UrhG erlaubt Hyperlinks und sehr kurze Auszüge). Medien können sich austragen lassen. Seitenabrufe für die Lesezeit erfolgen nur mit Erlaubnis der robots.txt und speichern nur eine Zahl (Text-und-Data-Mining-Ausnahme, § 42h UrhG, mit Beachtung des maschinenlesbaren Vorbehalts).
- Keine Cookies, kein Tracking, keine externen Schriften.
- Impressum und Datenschutzerklärung enthalten gelb markierte Platzhalter, die ausgefüllt werden müssen.

## Ältere Version

Die frühere TrueScope-Version (Next.js mit Nachrichten-Bot) ist in der Git-Historie, Commit `ac5c166`.
