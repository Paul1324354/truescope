"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { Empty, ScoreRing, Skeleton, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, CLAIM_LABEL, FLAG, SOURCE_TYPE_LABEL, STATUS_META, dateTime, groupLabel, timeAgo } from "@/lib/format";
import type { EventDetail } from "@/lib/types";

function Block({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const bar = tone === "ok" ? "border-l-ok" : tone === "warn" ? "border-l-warn" : tone === "bad" ? "border-l-bad" : "border-l-sky-500";
  return (
    <section className={`rounded-2xl border-l-4 ${bar} bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700`}>
      <h2 className="mb-3 font-serif text-lg font-semibold text-navy-900 dark:text-white">{title}</h2>
      {children}
    </section>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return <ul className="space-y-1.5 text-sm">{items.map((x, i) => <li key={i} className="flex gap-2"><span className="text-slate-400">•</span><span>{x}</span></li>)}</ul>;
}

function EventPage() {
  const id = useSearchParams().get("id") ?? "";
  const { user } = useApp();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!/^\d+$/.test(id)) { setErr("Nachricht nicht gefunden"); return; }
    api<EventDetail>(`/events/${id}`).then(setEv).catch((e: Error) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    if (!user || !id) return;
    api<{ id: number }[]>("/me/saved").then((s) => setSaved(s.some((x) => String(x.id) === id))).catch(() => undefined);
    api(`/me/history/${id}`, { method: "POST" }).catch(() => undefined); // reading history (only for signed-in users)
  }, [user, id]);

  if (err) return <Empty>{err}</Empty>;
  if (!ev) return <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40" /><Skeleton className="h-72" /></div>;

  const meta = STATUS_META[ev.status];
  const where = ev.facts.where?.length ? ev.facts.where : ev.countries.filter((c) => c.relation !== "source").map((c) => c.code);
  const toggleSave = async () => {
    if (!user) return (window.location.href = "/login");
    await api(`/me/saved/${ev.id}`, { method: saved ? "DELETE" : "POST" });
    setSaved(!saved);
  };

  return (
    <article className="mx-auto max-w-4xl space-y-6">
      {ev.is_demo && (
        <div className="rounded-xl bg-warn/15 px-4 py-3 text-sm font-medium text-[#8a6400] ring-1 ring-warn/40 dark:text-warn">
          DEMO-DATEN: Diese Meldung ist ein synthetisches Testbeispiel und keine echte Nachricht.
        </div>
      )}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Link href="/" className="hover:underline">Start</Link><span>/</span>
          {ev.categories.map((c) => <Link key={c} href={`/?category=${c}`} className="uppercase tracking-wide hover:underline">{CATEGORY_LABEL[c] ?? c}</Link>)}
          {ev.is_breaking && <span className="rounded bg-bad px-1.5 py-0.5 font-bold uppercase text-white">Breaking</span>}
        </div>
        <h1 className="font-serif text-3xl font-semibold leading-tight text-navy-900 md:text-4xl dark:text-white">{ev.title}</h1>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
          <ScoreRing score={ev.score} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={ev.status} size="md" /><span className="text-sm font-medium">{meta.label}</span>
              {ev.manual_override && <span className="text-xs text-slate-500">· redaktionell festgelegt</span>}</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{meta.help}</p>
            <p className="mt-1 text-xs text-slate-500">
              {ev.independent_sources} unabhängige Quellengruppe(n) · {ev.article_count} Berichte · zuletzt geprüft {timeAgo(ev.last_verified_at)}
              {ev.score === null && " · kein Score: Datenlage zu dünn"}
            </p>
          </div>
          <button onClick={toggleSave} className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-ink-600 dark:hover:bg-ink-800">
            {saved ? "★ Gespeichert" : "☆ Merken"}
          </button>
        </div>
      </header>

      <Block title="Neutrale Zusammenfassung">
        <p className="prose-ts text-[15px] text-slate-700 dark:text-slate-200">{ev.summary || "Noch keine Zusammenfassung verfügbar."}</p>
        <p className="mt-3 text-[11px] text-slate-500">
          {ev.generated_by === "tsie-llm" ? "Formuliert mit KI aus den Quellenteasern; geprüft gegen die Quellen." : "Aus Sätzen der Quellen zusammengestellt (extraktiv), ohne eigene Ergänzungen."}
        </p>
      </Block>

      <div className="grid gap-4 sm:grid-cols-2">
        <Block title="Was ist passiert?"><p className="text-sm">{ev.facts.what || ev.summary || "–"}</p></Block>
        <Block title="Wo?"><p className="text-sm">{where.length ? where.map((w) => `${FLAG[w] ?? ""} ${w}`).join(", ") : "Ort nicht eindeutig erkannt"}</p></Block>
        <Block title="Wann?"><p className="text-sm">Erste Meldung: {dateTime(ev.event_date)}<br />Letztes Update: {dateTime(ev.last_updated_at)}</p></Block>
        <Block title="Wer ist beteiligt?"><p className="text-sm">{ev.facts.who?.length ? ev.facts.who.join(", ") : "Keine Personen/Organisationen erkannt"}</p></Block>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Block title="Was ist bestätigt?" tone="ok"><List items={ev.confirmed} empty="Noch nichts unabhängig bestätigt." /></Block>
        <Block title="Was ist noch unklar?" tone="warn"><List items={ev.unclear} empty="Keine offenen Punkte erkannt." /></Block>
      </div>
      <Block title="Widersprüchliche Informationen" tone={ev.contradictions.length ? "bad" : undefined}>
        <List items={ev.contradictions.map((c) => c.description)} empty="Zwischen den unabhängigen Quellen wurden keine Widersprüche erkannt." />
      </Block>

      <Block title="Warum TrueScope diese Bewertung vergeben hat">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{ev.explanation}</p>
        {ev.factors.length > 0 && (
          <div className="mt-5 space-y-3">
            {ev.factors.map((f) => (
              <div key={f.key}>
                <div className="flex justify-between text-sm"><span className="font-medium">{f.label}</span>
                  <span className={`tabular-nums ${f.value < 0 ? "text-bad" : "text-slate-500"}`}>{f.value > 0 ? "+" : ""}{f.value}{f.max ? ` / ${f.max}` : ""}</span></div>
                {f.max > 0 && <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-ink-700"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(0, (f.value / f.max) * 100)}%` }} /></div>}
                <p className="mt-0.5 text-xs text-slate-500">{f.detail}</p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">Der Confidence Score ist eine Orientierung, keine Garantie. <Link href="/methodology" className="text-sky-500 hover:underline">Methodik</Link></p>
      </Block>

      <Block title={`Welche Quellen berichten? (${ev.source_groups.length} unabhängige Gruppen)`}>
        <p className="mb-4 text-xs text-slate-500">Berichte innerhalb einer Gruppe beruhen auf derselben Ursprungsquelle (Agenturmeldung, gleiches Medienhaus oder nahezu identischer Text) und zählen zusammen nur einmal.</p>
        <div className="space-y-4">
          {ev.source_groups.map((g) => (
            <div key={g.group} className="rounded-xl border border-slate-200 p-4 dark:border-ink-700">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{groupLabel(g.group)}</p>
              <ul className="space-y-3">
                {g.articles.map((a) => (
                  <li key={a.article_id}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-navy-900 hover:text-sky-500 hover:underline dark:text-slate-100">{a.title} ↗</a>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                      <span className="font-semibold">{a.source}</span>
                      <span>{SOURCE_TYPE_LABEL[a.source_type] ?? a.source_type}</span>
                      {a.source_country && <span>{FLAG[a.source_country]} {a.source_country}</span>}
                      <span>{dateTime(a.published_at)}</span>
                      {a.wire_origin && <span className="text-sky-500">beruft sich auf {a.wire_origin.toUpperCase()}</span>}
                      {a.is_opinion && <span className="text-warn">Meinung</span>}
                      {a.hedged && <span className="text-warn">vorläufig formuliert</span>}
                    </div>
                    {a.claims.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {a.claims.map((c, i) => (
                          <span key={i} title={c.evidence} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-800">
                            {CLAIM_LABEL[c.kind] ?? c.kind}: {c.value} <span className="opacity-60">({c.type})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Block>

      {ev.history.length > 0 && (
        <Block title="Bewertungsverlauf">
          <ol className="space-y-2 text-sm">
            {ev.history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-36 text-xs text-slate-500">{dateTime(h.created_at)}</span>
                <StatusBadge status={h.status} /><span className="tabular-nums">{h.score ?? "–"}</span>
                <span className="text-xs text-slate-500">({h.trigger === "admin" ? "Redaktion" : h.trigger === "reanalysis" ? "Neuanalyse" : "automatisch"})</span>
              </li>
            ))}
          </ol>
        </Block>
      )}
    </article>
  );
}

export default function Page() {
  return <Suspense><EventPage /></Suspense>;
}
