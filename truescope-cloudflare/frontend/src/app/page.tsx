"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { EventCard } from "@/components/EventCard";
import { countriesParam, useApp } from "@/components/Providers";
import { Empty, SectionTitle, Skeleton } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { CATEGORY_LABEL, STATUS_META } from "@/lib/format";
import type { EventCard as Ev, HomeData, Paged, Status } from "@/lib/types";

function Overview({ counts }: { counts: HomeData["verification_overview"] }) {
  const order: Status[] = ["VERIFIED", "STRONGLY_CORROBORATED", "DEVELOPING", "DISPUTED", "UNCONFIRMED", "FALSE", "RETRACTED"];
  const total = order.reduce((s, k) => s + (counts[k] ?? 0), 0) || 1;
  const color: Record<string, string> = { ok: "bg-ok", info: "bg-sky-500", warn: "bg-warn", bad: "bg-bad", muted: "bg-slate-400" };
  return (
    <div className="space-y-2.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-ink-700">
        {order.map((k) => <div key={k} className={color[STATUS_META[k].tone]} style={{ width: `${((counts[k] ?? 0) / total) * 100}%` }} />)}
      </div>
      {order.filter((k) => counts[k]).map((k) => (
        <div key={k} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${color[STATUS_META[k].tone]}`} />{STATUS_META[k].label}</span>
          <span className="tabular-nums text-slate-500">{counts[k]}</span>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-slate-500">Ereignisse der letzten 48 Stunden in deiner Länderauswahl.</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ items, cols = 3 }: { items: Ev[]; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-5 sm:grid-cols-2 ${cols === 3 ? "xl:grid-cols-3" : ""}`}>
      {items.map((e) => <EventCard key={e.id} ev={e} />)}
    </div>
  );
}

function CategoryFeed({ category, countries }: { category: string; countries: string }) {
  const [items, setItems] = useState<Ev[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const load = (cur: number | null, append: boolean) => {
    const params = category === "breaking" ? { countries, breaking: true } : { countries, category };
    api<Paged<Ev>>(`/events${qs({ ...params, page_size: 18, cursor: cur ?? undefined })}`).then((r) => {
      setCursor(r.next_cursor);
      setItems((prev) => (append && prev ? [...prev, ...r.items] : r.items));
    }).catch(() => setItems([]));
  };
  useEffect(() => { setItems(null); load(null, false); }, [category, countries]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <SectionTitle>{CATEGORY_LABEL[category] ?? category}</SectionTitle>
      {items === null ? <Skeleton className="h-64" /> : items.length === 0 ? <Empty>Noch keine Nachrichten in dieser Kategorie.</Empty> : <Grid items={items} />}
      {items && cursor && (
        <div className="mt-6 text-center">
          <button onClick={() => load(cursor, true)} className="rounded-full border border-slate-300 px-5 py-2 text-sm hover:bg-slate-100 dark:border-ink-600 dark:hover:bg-ink-800">Mehr laden</button>
        </div>
      )}
    </>
  );
}

function Home() {
  const { selected } = useApp();
  const params = useSearchParams();
  const category = params.get("category");
  const countries = countriesParam(selected);
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (category) return;
    setData(null);
    api<HomeData>(`/home${qs({ countries })}`).then(setData).catch((e: Error) => setError(e.message));
    const t = setInterval(() => api<HomeData>(`/home${qs({ countries })}`).then(setData).catch(() => undefined), 120_000);
    return () => clearInterval(t);
  }, [countries, category]);

  const main = category ? (
    <CategoryFeed category={category} countries={countries} />
  ) : error ? (
    <Empty>Die Nachrichten konnten nicht geladen werden ({error}). Läuft das Backend?</Empty>
  ) : !data ? (
    <div className="space-y-5"><Skeleton className="h-80" /><div className="grid gap-5 sm:grid-cols-2"><Skeleton className="h-60" /><Skeleton className="h-60" /></div></div>
  ) : data.latest.length === 0 ? (
    <Empty>
      Noch keine analysierten Nachrichten. Der TrueScope-Bot ruft jede Minute einen kleinen Teil der Feeds ab –
      nach der ersten Einrichtung dauert es etwa 15–30 Minuten, bis die ersten Ereignisse erscheinen.
    </Empty>
  ) : (
    <div className="space-y-10">
      {data.breaking.length > 0 && (
        <div role="alert" className="flex items-center gap-3 overflow-hidden rounded-xl bg-bad px-4 py-3 text-white">
          <span className="shrink-0 rounded bg-white/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wider">Breaking</span>
          <Link href={`/event?id=${data.breaking[0].id}`} className="truncate font-medium hover:underline">{data.breaking[0].title}</Link>
          <span className="ml-auto hidden shrink-0 text-xs opacity-90 sm:block">{STATUS_META[data.breaking[0].status].label}</span>
        </div>
      )}
      <section>
        <SectionTitle>Top-Nachrichten</SectionTitle>
        {data.top[0] && <div className="mb-5"><EventCard ev={data.top[0]} variant="hero" /></div>}
        <Grid items={data.top.slice(1, 7)} />
      </section>
      {data.verified.length > 0 && (
        <section><SectionTitle action={<Link href="/search?status=VERIFIED" className="text-sm text-sky-500 hover:underline">Alle</Link>}>Verifizierte Nachrichten</SectionTitle><Grid items={data.verified} /></section>
      )}
      <section><SectionTitle>Neueste Nachrichten</SectionTitle><Grid items={data.latest} /></section>
      {data.international.length > 0 && <section><SectionTitle>International</SectionTitle><Grid items={data.international} /></section>}
      {Object.entries(data.by_category).filter(([, v]) => v.length).map(([slug, items]) => (
        <section key={slug}>
          <SectionTitle action={<Link href={`/?category=${slug}`} className="text-sm text-sky-500 hover:underline">Mehr</Link>}>{CATEGORY_LABEL[slug]}</SectionTitle>
          <Grid items={items} />
        </section>
      ))}
    </div>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">{main}</div>
      <aside className="space-y-5 lg:sticky lg:top-32 lg:self-start">
        {data && (
          <>
            <Panel title="Verifizierungsübersicht"><Overview counts={data.verification_overview} /></Panel>
            <Panel title="Trending">{data.trending.length ? data.trending.map((e) => <EventCard key={e.id} ev={e} variant="compact" />) : <p className="text-sm text-slate-500">–</p>}</Panel>
            <Panel title="Aktuelle Ereignisse">{data.developing.length ? data.developing.map((e) => <EventCard key={e.id} ev={e} variant="compact" />) : <p className="text-sm text-slate-500">Keine laufenden Ereignisse.</p>}</Panel>
            <Panel title="Neueste Updates">{data.latest.slice(0, 5).map((e) => <EventCard key={e.id} ev={e} variant="compact" />)}</Panel>
          </>
        )}
        <Panel title="So bewertet TrueScope">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Wir zählen <b>unabhängige</b> Quellen – zehn Seiten mit derselben Agenturmeldung sind <i>eine</i> Bestätigung.
            Widersprüche verhindern „Verifiziert“, und bei dünner Datenlage geben wir lieber keinen Score an.
          </p>
          <Link href="/methodology" className="mt-2 inline-block text-sm text-sky-500 hover:underline">Zur Methodik →</Link>
        </Panel>
      </aside>
    </div>
  );
}

export default function Page() {
  return <Suspense><Home /></Suspense>;
}
