"use client";

import Link from "next/link";
import { CATEGORY_LABEL, FLAG, timeAgo } from "@/lib/format";
import type { EventCard as Ev } from "@/lib/types";
import { ScoreRing, StatusBadge } from "./ui";

function Meta({ ev }: { ev: Ev }) {
  const where = ev.countries.filter((c) => c.relation !== "source").slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500 dark:text-slate-400">
      {where.length > 0 && <span title="Betroffenes Land">{where.map((c) => FLAG[c.code] ?? c.code).join(" ")}</span>}
      {ev.categories[0] && <span className="font-medium uppercase tracking-wide">{CATEGORY_LABEL[ev.categories[0]] ?? ev.categories[0]}</span>}
      <span>
        <b className="text-navy-900 dark:text-slate-200">{ev.independent_sources}</b> unabh. {ev.independent_sources === 1 ? "Quelle" : "Quellen"}
        {ev.article_count > ev.independent_sources && <span className="opacity-70"> · {ev.article_count} Berichte</span>}
      </span>
      <time dateTime={ev.last_updated_at}>{timeAgo(ev.last_updated_at)}</time>
    </div>
  );
}

function Flags({ ev }: { ev: Ev }) {
  return (
    <>
      {ev.is_breaking && <span className="rounded bg-bad px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Breaking</span>}
      {ev.is_demo && <span className="rounded bg-warn px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy-950" title="Synthetische Demo-Daten">Demo</span>}
      {ev.manual_override && <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300" title="Status redaktionell festgelegt">Redaktion</span>}
    </>
  );
}

export function EventCard({ ev, variant = "default" }: { ev: Ev; variant?: "default" | "hero" | "compact" }) {
  if (variant === "compact") {
    return (
      <Link href={`/event?id=${ev.id}`} className="group flex gap-3 py-3 border-b border-slate-100 dark:border-ink-700 last:border-0">
        <ScoreRing score={ev.score} size={36} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1"><StatusBadge status={ev.status} /><Flags ev={ev} /></div>
          <h3 className="text-sm font-semibold leading-snug text-navy-900 group-hover:text-sky-500 dark:text-slate-100 line-clamp-2">{ev.title}</h3>
          <p className="mt-1 text-[11px] text-slate-500">{timeAgo(ev.last_updated_at)} · {ev.independent_sources} unabh. Quellen</p>
        </div>
      </Link>
    );
  }

  const hero = variant === "hero";
  return (
    <Link href={`/event?id=${ev.id}`}
      className={`group flex flex-col overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:ring-sky-400/60 dark:bg-ink-900 dark:ring-ink-700 ${hero ? "md:flex-row" : ""}`}>
      {ev.image_url && (
        <div className={`relative overflow-hidden bg-slate-100 dark:bg-ink-800 ${hero ? "md:w-1/2 aspect-[16/9] md:aspect-auto" : "aspect-[16/9]"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ev.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        </div>
      )}
      <div className={`flex flex-1 flex-col gap-3 p-5 ${hero ? "md:p-7" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={ev.status} /><Flags ev={ev} /></div>
          <ScoreRing score={ev.score} size={hero ? 52 : 42} />
        </div>
        <h3 className={`font-serif font-semibold leading-tight text-navy-900 group-hover:text-sky-500 dark:text-white ${hero ? "text-2xl md:text-[1.9rem]" : "text-lg"}`}>
          {ev.title}
        </h3>
        {ev.summary && <p className={`text-slate-600 dark:text-slate-300 ${hero ? "text-base line-clamp-4" : "text-sm line-clamp-3"}`}>{ev.summary}</p>}
        <div className="mt-auto pt-1"><Meta ev={ev} /></div>
      </div>
    </Link>
  );
}
