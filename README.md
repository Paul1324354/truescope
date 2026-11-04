# TrueScope

Nachrichten nach Land, Ressort und Zeitraum, mit International-Ansicht sowie Abstimmungen und Kommentaren.
Läuft kostenlos auf Cloudflare Pages mit einer D1-Datenbank.

## Aufbau

- `public/index.html`: die App (eine Seite, ohne Build-Schritt)
- `functions/api/news.js`: holt Schlagzeilen aus Google News (RSS), 10 Minuten zwischengespeichert
- `functions/api/polls.js`, `vote.js`, `comment.js`: Abstimmungen, Stimmen, Kommentare
- `schema.sql`: Tabellen der D1-Datenbank
- `wrangler.toml`: Cloudflare-Einstellungen (Datenbank-Bindung `DB`)

## Auf Cloudflare Pages veröffentlichen

1. Cloudflare-Dashboard: **Workers & Pages → Erstellen → Pages → Mit Git verbinden**.
2. Dieses Repo auswählen. Framework: **Keins**. Build-Befehl: leer lassen. Ausgabeverzeichnis: `public`.
3. **Speichern und bereitstellen.** Die Datenbank-Bindung `DB` kommt aus `wrangler.toml`.
   Falls sie fehlt: Projekt → Einstellungen → Bindungen → D1-Datenbank `truescope` als `DB` hinzufügen und neu bereitstellen.

Danach wird jede Änderung auf GitHub automatisch veröffentlicht.

## Moderation (optional)

Unter Einstellungen → Variablen eine geheime Variable `ADMIN_KEY` anlegen. Im Browser einmal in der Konsole
`localStorage.setItem("ts-admin", JSON.stringify("DEIN_KEY"))` ausführen: Dann kannst du alle Abstimmungen und Kommentare löschen.

## Ältere Version

Die frühere TrueScope-Version (Next.js mit Nachrichten-Bot) ist in der Git-Historie, Commit `ac5c166`.
