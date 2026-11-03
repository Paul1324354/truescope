// Untrusted external content is DATA. Strip markup, cap length, flag
// instruction-like text (prompt injection). Nothing here ever executes content.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

export function cleanText(value: string | null | undefined, maxLen = 4000): string {
  if (!value) return "";
  let t = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  t = decodeEntities(decodeEntities(t)); // feeds often double-encode
  t = t.replace(/<[^>]+>/g, " ");           // tags that were entity-encoded
  t = t.replace(/[​-‍⁠﻿‪-‮]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  t = t.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen - 1).trimEnd() + "…" : t;
}

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the |all )?(previous|prior|above|system)/i,
  /(you are|act as) (now )?(an? )?(ai|assistant|chatgpt|claude|system)/i,
  /system prompt/i,
  /\bnew instructions?\b/i,
  /ignoriere (alle )?(vorherigen|bisherigen) anweisungen/i,
  /vergiss (alle )?(vorherigen|bisherigen) anweisungen/i,
  /mark (this|the) (story|article|news) as (verified|true)/i,
  /set (the )?(status|score|confidence) to/i,
  /<\|?(im_start|system|assistant)\|?>/i,
];

export function detectInjection(text: string): string[] {
  return INJECTION.filter((r) => r.test(text || "")).map((r) => r.source);
}

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : null;
}
