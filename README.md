# TrueScope

Nachrichten nach Land, Ressort und Zeitraum, mit International-Ansicht, KI-Überblick, Ranking der Quellen und Daumen-Bewertungen.
Läuft kostenlos auf Cloudflare Pages mit einer D1-Datenbank.

## Aufbau

- `public/index.html`: die App (eine Seite, ohne Build-Schritt): dunkle Filterleiste links, Meldungsliste rechts, Seitenfenster „Mehr lesen“. Schriften (Archivo, Literata, beide OFL) liegen selbst gehostet in `public/fonts/`, das Aussehen der Rechtsseiten steht in `public/legal.css`.
- `functions/api/news.js`: Recherche-Bot. Liest die RSS-Feeds mehrerer Medien pro europäischem Land (`lib/feeds.js`, Leser in `lib/rss.js`), bündelt Artikel verschiedener Medien zum selben Ereignis (Doppelcheck: ab 2 Medien „bestätigt“) und lässt Workers AI eine eigene deutsche Schlagzeile schreiben. Angezeigt werden nur KI-Schlagzeile und Links zu den Originalen.
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

## Ranking der Quellen und Lesezeit

Beim Öffnen einer Meldung wird je Medium der früheste Artikel bewertet (höchstens 10 Medien):

- **Faktendichte und Sachlichkeit** (1–10) schätzt die KI aus Titel und Anriss (ein Aufruf je Meldung, höchstens 150 pro Tag, Ergebnis in `stories.rank_json`). Das ist eine Einschätzung des einzelnen Artikels, nicht des Mediums.
- **Tempo**: wer zuerst berichtet (fällt über die Stunden Abstand ab). **Umfang**: gezählte Wörter der Artikelseite.
- Gesamtwertung = 0,4 Fakten + 0,25 Sachlichkeit + 0,15 Tempo + 0,2 Umfang (fehlende KI-Werte oder unbekannter Umfang zählen als Durchschnitt der übrigen Medien, damit fehlende Daten weder belohnen noch bestrafen; hat niemand solche Werte, entfällt der Teil für alle; Bezahlschranke −1). „Beste Quelle“ gibt es nur, wenn die KI bewertet hat und mindestens 2 Medien vorliegen. Ohne KI (Kontingent leer) wird nach Tempo und Umfang sortiert und das angezeigt.
- **Lesezeit** = Wörter ÷ 200, gerundet. Dafür ruft der Server die Artikelseite einmal ab (`User-Agent: TrueScope/1.0 (+https://truescope-49p.pages.dev/; Lesezeit-Messung)`). Vorher wird die robots.txt des Mediums geprüft (24 Stunden zwischengespeichert in `robots`; Gruppe `TrueScope`, sonst `*`). Es wird **nichts abgerufen**, wenn der Abruf nicht erlaubt ist, die robots.txt nicht erreichbar ist (alles außer 404/410) oder ein Vorbehalt vorliegt (`tdm-reservation: 1`, `X-Robots-Tag`/Meta `noai`). Gespeichert werden nur `articles.words`, `paywall` und `measured_at`, nie Text.
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
