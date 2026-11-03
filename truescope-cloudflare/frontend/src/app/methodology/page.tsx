import type { Metadata } from "next";

export const metadata: Metadata = { title: "Methodik" };

const STATUSES: [string, string][] = [
  ["VERIFIED", "Mindestens drei voneinander unabhängige, glaubwürdige Quellengruppen berichten übereinstimmend, dazu eine offizielle Bestätigung oder eine vierte unabhängige Gruppe. Keine Widersprüche, Ereignis älter als zwei Stunden."],
  ["STRONGLY CORROBORATED", "Mindestens zwei unabhängige, glaubwürdige Quellengruppen stützen die Meldung, ohne Widersprüche."],
  ["DEVELOPING", "Aktuelles Ereignis (unter 24 Stunden) mit bisher nur einer unabhängigen Quellengruppe oder vorläufigen Angaben."],
  ["DISPUTED", "Unabhängige, glaubwürdige Quellen nennen widersprüchliche Kernangaben (z. B. Opferzahlen, Stärke eines Bebens) oder eine Quelle dementiert."],
  ["UNCONFIRMED", "Keine ausreichende unabhängige Bestätigung. Das heißt ausdrücklich nicht, dass die Meldung falsch ist."],
  ["FALSE", "Mindestens zwei unabhängige, glaubwürdige Gruppen widerlegen eine konkrete Behauptung mit eigener Prüfung."],
  ["RETRACTED", "Die ursprüngliche Meldung wurde von der Quelle zurückgezogen oder wesentlich korrigiert."],
];

export default function Methodology() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 text-[15px] leading-relaxed">
      <h1 className="font-serif text-4xl font-semibold text-navy-900 dark:text-white">Wie TrueScope bewertet</h1>
      <p>Die TrueScope Intelligence Engine (TSIE) sammelt Meldungen aus öffentlichen RSS-Feeds und lizenzierten Schnittstellen, gruppiert sie zu Ereignissen und prüft, <b>wer was unabhängig voneinander berichtet</b>. Gespeichert werden nur Titel, Teaser, Link und Metadaten – keine vollständigen Artikel.</p>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">1. Unabhängigkeit statt Masse</h2>
        <p>Berichte werden zu einer Quellengruppe zusammengefasst, wenn sie sich auf dieselbe Agentur berufen (z. B. „(Reuters)“, „dpa/“, „APA“), zum selben Medienhaus gehören oder nahezu identischen Text enthalten. Zehn Websites mit derselben Agenturmeldung zählen als <i>eine</i> Bestätigung.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">2. Status</h2>
        <dl className="space-y-3">{STATUSES.map(([k, v]) => <div key={k}><dt className="font-semibold">{k}</dt><dd className="text-slate-600 dark:text-slate-300">{v}</dd></div>)}</dl>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">3. Confidence Score (0–100)</h2>
        <p>Qualität der Quellen (25), Unabhängigkeit (25), Übereinstimmung der Kernaussagen (20), offizielle Bestätigung (10), überprüfbare Angaben (10), Stabilität über Zeit (5), Korrekturhistorie (5); Abzüge für vorläufige Formulierungen, Wiederverbreitung alter Meldungen und auffällige Inhalte. Der Wert ist je Status gedeckelt (z. B. höchstens 40 bei UNCONFIRMED). Bei weniger als zwei glaubwürdigen Quellengruppen zeigen wir <b>keinen</b> Score – lieber keine Zahl als eine vorgetäuschte Genauigkeit.</p>
        <p>Der Score ist eine Orientierung, keine mathematische Garantie für Wahrheit.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">4. Neutralität</h2>
        <p>Die Startbewertung einer Quelle beruht ausschließlich auf redaktionellen Prozessmerkmalen (Agentur, öffentlich-rechtlich, offizielle Stelle, dokumentierte Korrekturen) – nie auf politischer Ausrichtung. Keine Nachricht wird wegen einer einzelnen Quellenbewertung unterdrückt. Meinungsbeiträge werden erkannt und zählen nicht als Bestätigung. Zusammenfassungen werden aus Sätzen der Quellen gebildet; eine optionale KI darf nur formulieren, nie bewerten, und ihre Ausgabe wird verworfen, wenn sie Zahlen enthält, die in keiner Quelle stehen.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">5. Grenzen</h2>
        <p>Die Erkennung arbeitet mit Sprachmustern und kann irren, etwa bei sprachübergreifenden Berichten oder ungewöhnlichen Formulierungen. Bewertungen werden bei jeder neuen Meldung neu berechnet, Redakteur:innen können Fehlbewertungen melden und korrigieren – jede manuelle Änderung wird protokolliert und auf der Detailseite als „redaktionell festgelegt“ gekennzeichnet.</p>
      </section>
    </article>
  );
}
