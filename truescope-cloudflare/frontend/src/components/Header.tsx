"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, timeAgo } from "@/lib/format";
import { useApp } from "./Providers";
import { Logo } from "./ui";

function useOutside(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, close]);
}

export function CountrySelector() {
  const { countries, selected, setSelected } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const label = selected.length === 0 ? "🌐 Global" : selected.map((c) => countries.find((x) => x.code === c)?.flag ?? c).join(" ");
  const toggle = (code: string) => setSelected(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-ink-600 dark:hover:bg-ink-800">
        <span>{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true"
          className="absolute left-0 z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-ink-700 dark:bg-ink-900">
          <p className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wider text-slate-500">Länder auswählen</p>
          <button onClick={() => setSelected([])}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-ink-800 ${selected.length === 0 ? "font-semibold text-sky-500" : ""}`}>
            <span className="text-lg">🌐</span> Global <span className="ml-auto text-xs text-slate-500">alle Regionen</span>
          </button>
          <div className="my-1 h-px bg-slate-200 dark:bg-ink-700" />
          {countries.map((c) => (
            <label key={c.code} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-ink-800">
              <input type="checkbox" checked={selected.includes(c.code)} onChange={() => toggle(c.code)} className="accent-sky-500" />
              <span className="text-lg">{c.flag}</span> {c.name}
            </label>
          ))}
          {selected.length > 0 && (
            <button onClick={() => setSelected(countries.map((c) => c.code))} className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs text-sky-500 hover:underline">
              Alle {countries.length} Länder auswählen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { user } = useApp();
  const [items, setItems] = useState<{ id: number; event_id: number; message: string; read: boolean; created_at: string }[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  useEffect(() => {
    if (!user) return;
    const load = () => api<typeof items>("/me/notifications").then(setItems).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [user]);
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="relative" ref={ref}>
      <button aria-label="Benachrichtigungen" onClick={() => { setOpen(!open); if (user && unread) api("/me/notifications/read", { method: "POST" }).catch(() => undefined); }}
        className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-ink-800">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 004 0" /></svg>
        {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-bad" />}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-ink-700 dark:bg-ink-900">
          {!user ? (
            <p className="p-3 text-sm text-slate-500"><Link href="/login" className="text-sky-500 underline">Melde dich an</Link>, um Benachrichtigungen zu erhalten.</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">Keine Benachrichtigungen. Einstellen kannst du sie im <Link href="/profile" className="text-sky-500 underline">Profil</Link>.</p>
          ) : (
            items.slice(0, 12).map((n) => (
              <Link key={n.id} href={`/event?id=${n.event_id}`} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-ink-800">
                <span className={n.read ? "" : "font-semibold"}>{n.message}</span>
                <span className="block text-[11px] text-slate-500">{timeAgo(n.created_at)}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useApp();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const icon = theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🖥️";
  return (
    <button onClick={() => setTheme(next)} aria-label={`Darstellung: ${theme}`} title={`Darstellung: ${theme === "system" ? "System" : theme === "dark" ? "Dunkel" : "Hell"}`}
      className="rounded-full p-2 text-base hover:bg-slate-100 dark:hover:bg-ink-800">{icon}</button>
  );
}

export function SearchBox({ className = "" }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  return (
    <form role="search" className={className} onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nachrichten, Personen, Orte, Quellen …" aria-label="Suche"
        className="w-full rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-ink-600 dark:bg-ink-800" />
    </form>
  );
}

const NAV_CATS = ["all", "politik", "wirtschaft", "finanzen", "technologie", "wissenschaft", "gesundheit", "umwelt", "konflikte", "gesellschaft", "kriminalitaet", "sport", "unterhaltung", "breaking"];

export function Header() {
  const { user } = useApp();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = pathname === "/" ? params.get("category") ?? "all" : "";
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-ink-700 dark:bg-ink-950/90">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Logo />
        <div className="hidden md:block"><CountrySelector /></div>
        <SearchBox className="ml-auto hidden w-full max-w-md md:block" />
        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <Link href="/search" aria-label="Suche" className="rounded-full p-2 hover:bg-slate-100 md:hidden dark:hover:bg-ink-800">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          </Link>
          <Notifications />
          <ThemeToggle />
          {user?.role === "admin" || user?.role === "editor" ? (
            <Link href="/admin" className="hidden rounded-full px-3 py-1.5 text-sm font-medium hover:bg-slate-100 sm:block dark:hover:bg-ink-800">Admin</Link>
          ) : null}
          <Link href={user ? "/profile" : "/login"} aria-label={user ? "Profil & Einstellungen" : "Anmelden"}
            className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-navy-800 text-sm font-semibold text-white dark:bg-sky-500 dark:text-navy-950">
            {user ? user.username.slice(0, 1).toUpperCase() : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>
            )}
          </Link>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 pb-2 md:hidden"><CountrySelector /></div>
      <nav aria-label="Kategorien" className="mx-auto max-w-7xl overflow-x-auto px-4 [scrollbar-width:none]">
        <ul className="flex gap-1 pb-2 text-[13px] whitespace-nowrap">
          {NAV_CATS.map((c) => (
            <li key={c}>
              <Link href={c === "all" ? "/" : `/?category=${c}`}
                className={`inline-block rounded-full px-3 py-1 transition ${active === c ? "bg-navy-800 text-white dark:bg-sky-500 dark:text-navy-950" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800"} ${c === "breaking" ? "font-semibold text-bad" : ""}`}>
                {CATEGORY_LABEL[c]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
