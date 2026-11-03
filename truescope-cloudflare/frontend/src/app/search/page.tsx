"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { EventCard } from "@/components/EventCard";
import { countriesParam, useApp } from "@/components/Providers";
import { Empty, Skeleton } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { CATEGORY_LABEL, STATUS_META } from "@/lib/format";
import type { EventCard as Ev, Paged, Status } from "@/lib/types";

const WINDOWS = [["", "Alle"], ["1h", "Letzte Stunde"], ["24h", "24 Stunden"], ["7d", "7 Tage"], ["30d", "30 Tage"], ["custom", "Zeitraum…"]] as const;

function Search() {
  const router = useRouter();
  const params = useSearchParams();
  const { selected } = useApp();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [win, setWin] = useState(params.get("window") ?? "");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [source, setSource] = useState(params.get("source") ?? "");
  const [sort, setSort] = useState(params.get("sort") ?? "latest");
  const [res, setRes] = useState<Paged<Ev> | null>(null);
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<(number | null)[]>([null]); // cursor for page n = cursors[n-1]

  useEffect(() => {
    setRes(null);
    const query = {
      q: params.get("q"), window: params.get("window") === "custom" ? undefined : params.get("window"),
      date_from: params.get("from") ? `${params.get("from")}T00:00:00` : undefined,
      date_to: params.get("to") ? `${params.get("to")}T23:59:59` : undefined,
      category: params.get("category"), status: params.get("status"), source: params.get("source"),
      sort: params.get("sort") ?? "latest", countries: countriesParam(selected), cursor: cursors[page - 1] ?? undefined, page_size: 20,
    };
    api<Paged<Ev>>(`/events${qs(query)}`).then((r) => {
      setRes(r);
      setCursors((c) => { const n = [...c]; n[page] = r.next_cursor; return n; });
    }).catch(() => setRes({ items: [], next_cursor: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, selected, page]);

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    setPage(1);
    setCursors([null]);
    router.push(`/search${qs({ q, window: win, from: win === "custom" ? from : "", to: win === "custom" ? to : "", category, status, source, sort })}`);
  };
  const sel = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900";

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold text-navy-900 dark:text-white">Suche</h1>
      <form onSubmit={apply} className="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titel, Stichwort, Person, Unternehmen, Ort, Ereignis …"
          className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-sky-500 dark:border-ink-600 dark:bg-ink-800" />
        <div className="flex flex-wrap gap-2">
          <select aria-label="Zeitraum" value={win} onChange={(e) => setWin(e.target.value)} className={sel}>
            {WINDOWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {win === "custom" && (<>
            <input type="date" aria-label="Von" value={from} onChange={(e) => setFrom(e.target.value)} className={sel} />
            <input type="date" aria-label="Bis" value={to} onChange={(e) => setTo(e.target.value)} className={sel} />
          </>)}
          <select aria-label="Kategorie" value={category} onChange={(e) => setCategory(e.target.value)} className={sel}>
            <option value="">Alle Kategorien</option>
            {Object.entries(CATEGORY_LABEL).filter(([k]) => k !== "all" && k !== "breaking").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
            <option value="">Jeder Status</option>
            {(Object.keys(STATUS_META) as Status[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Quelle (z. B. ORF)" aria-label="Quelle" className={sel} />
          <select aria-label="Sortierung" value={sort} onChange={(e) => setSort(e.target.value)} className={sel}>
            <option value="latest">Neueste zuerst</option><option value="top">Relevanz</option><option value="verified">Höchster Score</option>
          </select>
          <button className="ml-auto rounded-lg bg-navy-800 px-5 py-2 text-sm font-medium text-white dark:bg-sky-500 dark:text-navy-950">Suchen</button>
        </div>
      </form>
      {!res ? <Skeleton className="h-60" /> : res.items.length === 0 ? <Empty>Keine Treffer für diese Kriterien und Länderauswahl.</Empty> : (
        <>
          <p className="text-sm text-slate-500">{res.total !== undefined ? `${res.total} Treffer` : `Seite ${page}`}</p>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{res.items.map((e) => <EventCard key={e.id} ev={e} />)}</div>
          <div className="flex justify-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-full border px-4 py-1.5 text-sm disabled:opacity-40 dark:border-ink-600">Zurück</button>
            <span className="px-2 py-1.5 text-sm">Seite {page}</span>
            <button disabled={!res.next_cursor} onClick={() => setPage(page + 1)} className="rounded-full border px-4 py-1.5 text-sm disabled:opacity-40 dark:border-ink-600">Weiter</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense><Search /></Suspense>;
}
