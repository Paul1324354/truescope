# TrueScope

Nachrichten nach Land, Ressort und Zeitraum, mit International-Ansicht sowie Abstimmungen und Kommentaren.
Läuft kostenlos auf Cloudflare Pages mit einer D1-Datenbank.

## Aufbau

- `public/index.html`: die App (eine Seite, ohne Build-Schritt): dunkle Filterleiste links, Meldungsliste rechts, Seitenfenster „Mehr lesen“. Schriften (Archivo, Literata, beide OFL) liegen selbst gehostet in `public/fonts/`, das Aussehen der Rechtsseiten steht in `public/legal.css`.
- `functions/api/news.js`: Recherche-Bot. Liest die RSS-Feeds mehrerer Medien pro europäischem Land (`lib/feeds.js`, Leser in `lib/rss.js`), bündelt Artikel verschiedener Medien zum selben Ereignis (Doppelcheck: ab 2 Medien „bestätigt“) und lässt Workers AI eine eigene deutsche Schlagzeile schreiben. Angezeigt werden nur KI-Schlagzeile und Links zu den Originalen.
- `functions/api/story.js`: Detailansicht („Mehr lesen“). Liefert die Quellen mit Originalschlagzeile und Link und schreibt beim ersten Öffnen einen kurzen KI-Überblick in eigenen Worten (wird gespeichert, höchstens 250 neue pro Tag). Die kurzen Feed-Anrisse (`articles.descr`) dienen nur als Eingabe für die KI und werden nie ausgeliefert.
- `lib/bot.js`: gemeinsame Helfer für KI-Aufruf und Sperren
- `functions/api/report.js`: Beiträge melden; ab 3 Meldungen automatisch ausgeblendet
- `public/impressum.html`, `datenschutz.html`, `regeln.html`: rechtliche Seiten (Platzhalter im Impressum und in der Datenschutzerklärung ausfüllen!)
- `functions/api/polls.js`, `vote.js`, `comment.js`: Abstimmungen, Stimmen, Kommentare
- `schema.sql`: Tabellen der D1-Datenbank
- `wrangler.toml`: Cloudflare-Einstellungen (Datenbank-Bindung `DB`)

## Auf Cloudflare Pages veröffentlichen

1. Cloudflare-Dashboard: **Workers & Pages → Erstellen → Pages → Mit Git verbinden**.
2. Dieses Repo auswählen. Framework: **Keins**. Build-Befehl: leer lassen. Ausgabeverzeichnis: `public`.
3. **Speichern und bereitstellen.** Die Datenbank-Bindung `DB` kommt aus `wrangler.toml`.
   Falls sie fehlt: Projekt → Einstellungen → Bindungen → D1-Datenbank `truescope` als `DB` hinzufügen und neu bereitstellen.

Danach wird jede Änderung auf GitHub automatisch veröffentlicht.

## Moderation

Unter Einstellungen → Variablen eine geheime Variable `ADMIN_KEY` anlegen. Im Browser einmal in der Konsole
`localStorage.setItem("ts-admin", JSON.stringify("DEIN_KEY"))` ausführen: Dann siehst du auch ausgeblendete Beiträge
und kannst alle Abstimmungen und Kommentare löschen.

Gemeldete Beiträge ansehen (in der Konsole auf der Seite):
`await fetch("/api/report",{headers:{"X-Admin-Key":"DEIN_KEY"}}).then(r=>r.json())`

Einen gemeldeten Beitrag wieder freigeben:
`await fetch("/api/report",{method:"POST",headers:{"X-Admin-Key":"DEIN_KEY"},body:JSON.stringify({action:"approve",type:"comment",id:"…"})})`

## Rechtliches

- Nachrichten: eigene KI-Schlagzeilen und KI-Überblicke, keine Artikeltexte, nur Links (mit Namen des Mediums und Originalüberschrift als Linktext) zu den Originalartikeln (§ 76f UrhG erlaubt Hyperlinks und sehr kurze Auszüge). Medien können sich austragen lassen.
- Keine Cookies, kein Tracking, keine externen Schriften.
- Impressum und Datenschutzerklärung enthalten gelb markierte Platzhalter, die ausgefüllt werden müssen.

## Ältere Version

Die frühere TrueScope-Version (Next.js mit Nachrichten-Bot) ist in der Git-Historie, Commit `ac5c166`.
