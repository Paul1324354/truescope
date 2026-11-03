# TrueScope kostenlos veröffentlichen – Schritt für Schritt

Diese Anleitung ist für absolute Anfänger:innen. Du brauchst **kein Geld, keine Kreditkarte und
keine Programmierkenntnisse**. Zeitaufwand: etwa 20 Minuten, plus 15–30 Minuten Warten, bis die
ersten Nachrichten erscheinen.

Am Ende läuft TrueScope öffentlich unter einer Adresse wie **`https://truescope.pages.dev`**.

---

## Schritt 1: Kostenloses Cloudflare-Konto anlegen

1. Öffne **https://dash.cloudflare.com/sign-up**.
2. Registriere dich mit E-Mail und Passwort und bestätige die E-Mail.
3. Wähle den **Free**-Plan. Eine Kreditkarte ist nicht nötig. Überspringe Fragen nach einer eigenen Domain.

## Schritt 2: Node.js installieren

Node.js ist das Programm, mit dem das Einrichtungs-Skript läuft.

1. Öffne **https://nodejs.org** und lade die Version mit **„LTS“** herunter (Version 22 oder neuer).
2. Installiere sie mit allen Standardeinstellungen (immer „Weiter“).
3. Starte den Computer danach einmal neu.

## Schritt 3: Projekt entpacken

1. Entpacke `truescope-cloudflare.zip`, zum Beispiel in deinen Ordner **Dokumente**.
2. Danach gibt es einen Ordner `truescope-cloudflare` mit `ANLEITUNG.md`, `worker`, `frontend` usw.

## Schritt 4: Terminal im Projektordner öffnen

- **Windows:** Öffne den Ordner `truescope-cloudflare` im Explorer, klicke oben in die Adresszeile,
  tippe **`cmd`** und drücke Enter. (Bitte `cmd` verwenden, nicht PowerShell – das vermeidet eine
  häufige Fehlermeldung.)
- **Mac:** Öffne **Terminal**, tippe `cd ` (mit Leerzeichen), zieh den Ordner ins Fenster, Enter.

Prüfe, ob Node.js da ist:

```
node --version
```

Es sollte etwas wie `v22.…` erscheinen.

## Schritt 5: Einrichtung starten

```
npm run setup
```

Das Skript stellt dir zwei Fragen:

1. **E-Mail-Adresse für dein Admin-Konto** – mit genau dieser Adresse registrierst du dich später.
2. **Name der Website** – einfach Enter drücken für `truescope`, oder z. B. `truescope-paul`.

Dann passiert alles automatisch:

| Schritt | Was passiert | Was du tun musst |
|---|---|---|
| 1 | Programmpakete werden geladen | warten (1–3 Min.) |
| 2 | Anmeldung bei Cloudflare | Im Browser, der sich öffnet, auf **„Allow“** klicken |
| 3–5 | Datenbank wird angelegt, Tabellen und 31 echte Nachrichtenquellen werden geladen | nichts |
| 6 | Der Nachrichten-Bot wird veröffentlicht | Falls gefragt wird, eine **workers.dev-Subdomain** zu wählen: einen Namen eingeben (z. B. deinen Namen) |
| 7–8 | Die Website wird gebaut und veröffentlicht | nichts |

Am Ende steht: **„Fertig! Deine Website: https://….pages.dev“**.

## Schritt 6: Admin-Konto anlegen

1. Öffne deine Website-Adresse.
2. Klicke oben rechts auf das Personen-Symbol → **„Konto erstellen“**.
3. Registriere dich mit **derselben E-Mail**, die du im Setup angegeben hast.
   Dieses erste Konto wird automatisch Administrator.
4. Oben erscheint jetzt **„Admin“**. Dort siehst du Bot-Status, Quellen, Fehler und das Tageskontingent.

## Schritt 7: Warten auf die ersten Nachrichten

Der Bot arbeitet **jede Minute in kleinen Schritten**, damit er im kostenlosen Tarif bleibt
(abwechselnd: 2 Feeds abrufen, dann ein paar Artikel analysieren). Die ersten Ereignisse erscheinen
nach etwa **15–30 Minuten**, nach einigen Stunden ist die Seite gut gefüllt.

Im Admin-Bereich kannst du mit **„Analyse-Schritt jetzt ausführen“** nachhelfen und bei einzelnen
Quellen **„Jetzt abrufen“** klicken.

---

## Optional: KI-Zusammenfassungen einschalten (bleibt kostenlos)

TrueScope funktioniert vollständig ohne KI: Bewertung und Zusammenfassung sind regelbasiert.
Wer möchte, kann Zusammenfassungen von **Workers AI** formulieren lassen. Im kostenlosen Tarif sind
10.000 „Neurons“ pro Tag enthalten; TrueScope verbraucht pro Zusammenfassung etwa 55 und begrenzt
sich selbst auf 100 pro Tag.

1. Öffne `worker/wrangler.toml` mit einem Texteditor (Windows: Rechtsklick → „Öffnen mit“ → Editor).
2. Ändere `AI_SUMMARIES = "false"` zu `AI_SUMMARIES = "true"` und speichere.
3. Im Terminal: `npm run update`

Ist das Gratis-Kontingent einmal aufgebraucht, schlagen KI-Aufrufe einfach fehl, und TrueScope nutzt
automatisch wieder die regelbasierte Zusammenfassung. Es entstehen keine Kosten.

## Später: Änderungen veröffentlichen

Nach jeder Änderung am Code oder an `wrangler.toml`:

```
npm run update
```

## Pausieren oder ganz abschalten

- **Pausieren:** Admin → Übersicht → **„Ingestion pausieren“**. Die Website bleibt online, der Bot holt keine neuen Nachrichten.
- **Ganz entfernen:** Im Cloudflare-Dashboard unter **Workers & Pages** den Worker `truescope-api` und
  das Pages-Projekt löschen, unter **Storage & Databases → D1** die Datenbank `truescope` löschen.

---

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| `npm` oder `node` „wird nicht erkannt“ | Node.js installieren (Schritt 2), Computer neu starten, neues Terminal öffnen |
| Windows: „Die Ausführung von Skripts ist auf diesem System deaktiviert“ | Statt PowerShell die **Eingabeaufforderung `cmd`** verwenden (Schritt 4) |
| Browser-Anmeldung öffnet sich nicht | Den im Terminal angezeigten Link kopieren und im Browser öffnen |
| „You need to register a workers.dev subdomain“ | Im Dashboard **Workers & Pages** öffnen, eine Subdomain wählen, dann `npm run setup` erneut starten |
| Setup bricht mittendrin ab | Einfach `npm run setup` noch einmal ausführen – bereits Angelegtes wird wiederverwendet |
| Nach 1 Stunde noch keine Nachrichten | Admin → **Fehler** und **Quellen** ansehen. Manche Medien blockieren Abrufe aus Rechenzentren; diese Quellen werden nach 10 Fehlversuchen automatisch deaktiviert |
| Meldung „Tageskontingent der Datenbank erreicht“ | Kommt nur bei sehr viel Besuch vor. Ab 00:00 UTC (01:00/02:00 Uhr bei uns) geht es automatisch weiter. Es entstehen keine Kosten |
| Passwort vergessen | Admin → **Benutzer** → „Passwort zurücksetzen“ (E-Mail-Versand ist im Gratis-Paket nicht enthalten) |

Wenn du nicht weiterkommst: Kopiere die letzten 20–30 Zeilen aus dem Terminal und frag nach.
