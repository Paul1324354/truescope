"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EventCard } from "@/components/EventCard";
import { useApp } from "@/components/Providers";
import { Button, Empty, Field, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, STATUS_META } from "@/lib/format";
import type { EventCard as Ev, NotificationSettings, Status, User } from "@/lib/types";

const CATS = Object.keys(CATEGORY_LABEL).filter((k) => k !== "all" && k !== "breaking");

function Chips({ options, value, onChange, label }: { options: { v: string; l: string }[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.v);
          return (
            <button type="button" key={o.v} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.v) : [...value, o.v])}
              className={`rounded-full px-3 py-1 text-sm ring-1 ${on ? "bg-navy-800 text-white ring-navy-800 dark:bg-sky-500 dark:text-navy-950 dark:ring-sky-500" : "ring-slate-300 dark:ring-ink-600"}`}>
              {o.l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function Profile() {
  const { user, userLoaded, setUser, countries, setSelected } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<"settings" | "saved" | "history" | "account">("settings");
  const [prefC, setPrefC] = useState<string[]>([]);
  const [prefK, setPrefK] = useState<string[]>([]);
  const [ns, setNs] = useState<NotificationSettings>({ enabled: true, breaking: true, countries: [], categories: [], min_status: "STRONGLY_CORROBORATED" });
  const [list, setList] = useState<Ev[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });

  useEffect(() => {
    if (userLoaded && !user) router.push("/login");
    if (user) {
      setPrefC(user.preferences.preferred_countries);
      setPrefK(user.preferences.preferred_categories);
      setNs({ ...ns, ...user.preferences.notification_settings });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userLoaded]);

  useEffect(() => {
    if (tab === "saved" || tab === "history") {
      setList(null);
      api<Ev[]>(`/me/${tab}`).then(setList).catch(() => setList([]));
    }
  }, [tab]);

  if (!user) return null;
  const save = async () => {
    const u = await api<User>("/me/preferences", { method: "PUT", json: { preferred_countries: prefC, preferred_categories: prefK, notification_settings: ns, theme: user.preferences.theme } });
    setUser(u);
    setSelected(prefC);
    setMsg("Gespeichert.");
  };
  const countryOpts = countries.map((c) => ({ v: c.code, l: `${c.flag} ${c.name}` }));
  const catOpts = CATS.map((c) => ({ v: c, l: CATEGORY_LABEL[c] }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl font-semibold text-navy-900 dark:text-white">Hallo, {user.username}</h1>
        <Button variant="ghost" onClick={async () => { await api("/auth/logout", { method: "POST" }); setUser(null); router.push("/"); }}>Abmelden</Button>
      </div>
      <div className="flex gap-1 border-b border-slate-200 dark:border-ink-700">
        {([["settings", "Einstellungen"], ["saved", "Gespeichert"], ["history", "Verlauf"], ["account", "Konto & Datenschutz"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? "border-sky-500 font-semibold" : "border-transparent text-slate-500"}`}>{l}</button>
        ))}
      </div>

      {tab === "settings" && (
        <div className="space-y-8">
          <section className="space-y-4">
            <SectionTitle>Personalisierung</SectionTitle>
            <Chips label="Bevorzugte Länder (leer = Global)" options={countryOpts} value={prefC} onChange={setPrefC} />
            <Chips label="Lieblingskategorien" options={catOpts} value={prefK} onChange={setPrefK} />
          </section>
          <section className="space-y-4">
            <SectionTitle>Benachrichtigungen</SectionTitle>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ns.enabled} onChange={(e) => setNs({ ...ns, enabled: e.target.checked })} className="accent-sky-500" /> Benachrichtigungen aktiv</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ns.breaking} onChange={(e) => setNs({ ...ns, breaking: e.target.checked })} className="accent-sky-500" /> Breaking News</label>
            <Chips label="Neue Nachrichten aus …" options={countryOpts} value={ns.countries} onChange={(v) => setNs({ ...ns, countries: v })} />
            <Chips label="Kategorien" options={catOpts} value={ns.categories} onChange={(v) => setNs({ ...ns, categories: v })} />
            <label className="block text-sm">Nur benachrichtigen ab Status
              <select value={ns.min_status} onChange={(e) => setNs({ ...ns, min_status: e.target.value as Status })} className="ml-2 rounded-lg border border-slate-300 px-2 py-1 dark:border-ink-600 dark:bg-ink-900">
                {(["VERIFIED", "STRONGLY_CORROBORATED", "DEVELOPING"] as Status[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-500">Gegen Spam: maximal eine Benachrichtigung pro Ereignis und höchstens 25 pro Tag.</p>
          </section>
          <div className="flex items-center gap-3"><Button onClick={save}>Speichern</Button>{msg && <span className="text-sm text-ok">{msg}</span>}</div>
        </div>
      )}

      {(tab === "saved" || tab === "history") && (
        list === null ? null : list.length === 0 ? <Empty>{tab === "saved" ? "Noch keine gespeicherten Nachrichten." : "Noch kein Leseverlauf."}</Empty> : (
          <>
            {tab === "history" && <button onClick={async () => { await api("/me/history", { method: "DELETE" }); setList([]); }} className="text-sm text-bad hover:underline">Verlauf löschen</button>}
            <div className="grid gap-5 sm:grid-cols-2">{list.map((e) => <EventCard key={e.id} ev={e} />)}</div>
          </>
        )
      )}

      {tab === "account" && (
        <div className="space-y-8">
          <form className="max-w-sm space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            try { setUser(await api<User>("/me/profile", { method: "PATCH", json: pw })); setMsg("Passwort geändert."); setPw({ current_password: "", new_password: "" }); }
            catch (x) { setMsg((x as Error).message); }
          }}>
            <SectionTitle>Passwort ändern</SectionTitle>
            <Field label="Aktuelles Passwort" type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
            <Field label="Neues Passwort" type="password" minLength={10} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            <Button>Ändern</Button>{msg && <p className="text-sm">{msg}</p>}
          </form>
          <section className="space-y-3">
            <SectionTitle>Datenschutz (DSGVO)</SectionTitle>
            <a href="/api/me/export" download="truescope-daten.json" className="inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-ink-600">Meine Daten exportieren</a>
            <div>
              <Button variant="danger" onClick={async () => {
                if (!confirm("Konto und alle persönlichen Daten endgültig löschen?")) return;
                await api("/me", { method: "DELETE" });
                setUser(null);
                router.push("/");
              }}>Konto löschen</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
