# TrueScope

Nachrichten nach Land, Ressort und Zeitraum, mit International-Ansicht sowie Abstimmungen und Kommentaren.
Läuft kostenlos auf Cloudflare Pages mit einer D1-Datenbank.

## Aufbau

- `public/index.html`: die App (eine Seite, ohne Build-Schritt)
- `functions/api/news.js`: holt Schlagzeilen über die [Guardian Open Platform](https://open-platform.theguardian.com) (Gratis-Schlüssel, nicht kommerziell, mit Quellenangabe), 30 Minuten zwischengespeichert
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

### Guardian-Schlüssel eintragen

1. Gratis-Schlüssel holen: https://open-platform.theguardian.com/access/ → „Register developer key“.
2. Cloudflare → Workers & Pages → truescope → Einstellungen → Variablen und geheime Schlüssel → Hinzufügen:
   Typ **Geheim**, Name `GUARDIAN_API_KEY`, Wert = dein Schlüssel. Für **Produktion** speichern.
3. Unter Bereitstellungen die neueste Version erneut bereitstellen.

## Moderation

Unter Einstellungen → Variablen eine geheime Variable `ADMIN_KEY` anlegen. Im Browser einmal in der Konsole
`localStorage.setItem("ts-admin", JSON.stringify("DEIN_KEY"))` ausführen: Dann siehst du auch ausgeblendete Beiträge
und kannst alle Abstimmungen und Kommentare löschen.

Gemeldete Beiträge ansehen (in der Konsole auf der Seite):
`await fetch("/api/report",{headers:{"X-Admin-Key":"DEIN_KEY"}}).then(r=>r.json())`

Einen gemeldeten Beitrag wieder freigeben:
`await fetch("/api/report",{method:"POST",headers:{"X-Admin-Key":"DEIN_KEY"},body:JSON.stringify({action:"approve",type:"comment",id:"…"})})`

## Rechtliches

- Nachrichten: nur Überschrift, Quelle und Link (§ 76f UrhG erlaubt Hyperlinks und sehr kurze Auszüge). Quelle: The Guardian Open Platform, „Powered by The Guardian“ mit Link ist Pflicht.
- Keine Cookies, kein Tracking, keine externen Schriften.
- Impressum und Datenschutzerklärung enthalten gelb markierte Platzhalter, die ausgefüllt werden müssen.

## Ältere Version

Die frühere TrueScope-Version (Next.js mit Nachrichten-Bot) ist in der Git-Historie, Commit `ac5c166`.
