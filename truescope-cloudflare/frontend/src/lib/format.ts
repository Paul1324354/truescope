import type { Status } from "./types";

export const STATUS_META: Record<Status, { label: string; short: string; tone: "ok" | "info" | "warn" | "bad" | "muted"; help: string }> = {
  VERIFIED: { label: "Verifiziert", short: "VERIFIED", tone: "ok", help: "Durch mehrere unabhängige, glaubwürdige Quellen bestätigt." },
  STRONGLY_CORROBORATED: { label: "Stark gestützt", short: "CORROBORATED", tone: "info", help: "Mehrere glaubwürdige Quellen stützen die Meldung, die Bestätigung ist noch nicht vollständig." },
  DEVELOPING: { label: "In Entwicklung", short: "DEVELOPING", tone: "warn", help: "Aktuelles Ereignis, es fehlen noch Informationen." },
  DISPUTED: { label: "Umstritten", short: "DISPUTED", tone: "warn", help: "Glaubwürdige Quellen berichten Widersprüchliches." },
  UNCONFIRMED: { label: "Unbestätigt", short: "UNCONFIRMED", tone: "muted", help: "Bisher keine ausreichende unabhängige Bestätigung – das heißt nicht, dass sie falsch ist." },
  FALSE: { label: "Widerlegt", short: "FALSE", tone: "bad", help: "Eine konkrete Behauptung wurde durch belastbare Belege widerlegt." },
  RETRACTED: { label: "Zurückgezogen", short: "RETRACTED", tone: "bad", help: "Die ursprüngliche Meldung wurde zurückgezogen oder wesentlich korrigiert." },
};

export const CATEGORY_LABEL: Record<string, string> = {
  all: "Alle", politik: "Politik", wirtschaft: "Wirtschaft", finanzen: "Finanzen", technologie: "Technologie",
  wissenschaft: "Wissenschaft", gesundheit: "Gesundheit", umwelt: "Umwelt & Klima", konflikte: "Internationale Konflikte",
  gesellschaft: "Gesellschaft", kriminalitaet: "Kriminalität", sport: "Sport", unterhaltung: "Unterhaltung", breaking: "Breaking News",
};

export const FLAG: Record<string, string> = {
  AT: "🇦🇹", DE: "🇩🇪", US: "🇺🇸", GB: "🇬🇧", CH: "🇨🇭", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", UA: "🇺🇦", RU: "🇷🇺",
  CN: "🇨🇳", JP: "🇯🇵", IN: "🇮🇳", IL: "🇮🇱", PS: "🇵🇸", IR: "🇮🇷", TR: "🇹🇷", PL: "🇵🇱", HU: "🇭🇺", CA: "🇨🇦",
  AU: "🇦🇺", EU: "🇪🇺",
};

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const diff = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const d = Math.floor(diff / 86400);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function groupLabel(key: string): string {
  if (key.startsWith("wire:")) return `Agentur: ${key.slice(5).split("+").map((s) => s.toUpperCase()).join(" + ")}`;
  if (key.startsWith("owner:")) return `Medienhaus: ${key.slice(6).split("+").join(" + ")}`;
  if (key.startsWith("source:")) return key.slice(7).split("+").join(" + ");
  return key;
}

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  wire_agency: "Nachrichtenagentur", public_broadcaster: "Öffentlich-rechtlich", national_newspaper: "Überregionale Zeitung",
  regional_news: "Regionalmedium", broadcaster: "Sender", investigative: "Investigativ / Faktencheck", official: "Offizielle Stelle",
  press_release: "Pressemitteilung", aggregator: "Aggregator", other: "Sonstige",
};

export const CLAIM_LABEL: Record<string, string> = {
  dead: "Todesopfer", injured: "Verletzte", missing: "Vermisste", arrested: "Festnahmen", evacuated: "Evakuierte", magnitude: "Magnitude",
};
