"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { Button, Empty, ScoreRing, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { SOURCE_TYPE_LABEL, STATUS_META, dateTime, timeAgo } from "@/lib/format";
import type { EventCard, EventDetail, Status } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "overview" | "sources" | "events" | "errors" | "jobs" | "audit" | "countries" | "users";

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900 dark:text-white">{value ?? "–"}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const pill = (ok: boolean, t: string) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ok ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad"}`}>{t}</span>;
const input = "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900";

function Bar({ label, used, budget, limit }: { label: string; used: number; budget: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-slate-500">{used.toLocaleString("de-AT")} / {limit.toLocaleString("de-AT")}</span></div>
      <div className="relative mt-1 h-2 rounded-full bg-slate-200 dark:bg-ink-700">
        <div className={`h-full rounded-full ${used >= budget ? "bg-bad" : used >= budget * 0.8 ? "bg-warn" : "bg-ok"}`} style={{ width: `${pct}%` }} />
        <div className="absolute top-[-3px] h-3.5 w-0.5 bg-navy-800 dark:bg-white" style={{ left: `${(budget / limit) * 100}%` }} title={`TrueScope-Budget: ${budget}`} />
      </div>
    </div>
  );
}

function Overview({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<any>("/admin/stats").then(setS).catch(() => undefined), []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  if (!s) return null;
  const u = s.usage_today;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 text-sm">
        <span>Datenbank {pill(true, "D1 ok")}</span>
        <span>TSIE-Bot {pill(s.system.bot === "running", s.system.bot)}</span>
        <span>Ingestion {pill(!s.system.ingest_paused, s.system.ingest_paused ? "pausiert" : "aktiv")}</span>
        <span>Passwort-Pepper {pill(s.system.pepper_configured, s.system.pepper_configured ? "gesetzt" : "fehlt")}</span>
        <span>Workers AI {pill(u.ai_enabled, u.ai_enabled ? `an (${u.ai_calls}/${u.ai_daily_calls} heute)` : "aus – regelbasiert")}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gesammelte Nachrichten" value={s.articles_total} hint={`${s.articles_24h} in 24 h`} />
        <Stat label="Analysierte Ereignisse" value={s.events_total} />
        <Stat label="Verifiziert" value={s.verified} />
        <Stat label="Unbestätigt" value={s.unconfirmed} />
        <Stat label="Aktive Quellen" value={s.sources_active} hint={`${s.sources_failing} mit Fehlern`} />
        <Stat label="Warteschlange" value={s.pending_articles} hint="unverarbeitete Artikel" />
        <Stat label="Fehler (24 h)" value={s.errors_24h} />
        <Stat label="Analyse-Batch" value={s.processing.current_batch ?? "–"} hint={`letzter Lauf ${timeAgo(s.processing.last_analyze_run)} (${s.processing.last_analyze_status ?? "–"})`} />
      </div>
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
        <p className="text-xs uppercase tracking-wider text-slate-500">Kostenlos-Kontingent heute (UTC) – Pipeline</p>
        <Bar label="D1 Zeilen geschrieben" used={u.rows_written} budget={u.write_budget} limit={u.free_limit_writes} />
        <Bar label="D1 Zeilen gelesen" used={u.rows_read} budget={u.read_budget} limit={u.free_limit_reads} />
        <Bar label="Neue Artikel" used={u.articles_new} budget={u.max_new_articles} limit={u.max_new_articles} />
        <p className="text-xs text-slate-500">Cron-Läufe heute: {u.cron_runs}. Erreicht die Pipeline ihr Budget (Strich), pausiert sie automatisch bis 00:00 UTC – die Website bleibt lesbar. Im kostenlosen Tarif entstehen nie Kosten.</p>
      </div>
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => api("/admin/settings", { method: "PUT", json: { ingest_paused: !s.system.ingest_paused } }).then(load)}>{s.system.ingest_paused ? "Ingestion fortsetzen" : "Ingestion pausieren"}</Button>
          <Button variant="ghost" onClick={() => api<any>("/admin/run-analysis", { method: "POST" }).then((r) => { setMsg(`${r.analyzed} Artikel analysiert, ${r.assessed} Ereignisse bewertet.`); load(); }).catch((e: Error) => setMsg(e.message))}>Analyse-Schritt jetzt ausführen</Button>
          {msg && <span className="self-center text-sm">{msg}</span>}
        </div>
      )}
      <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
        <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Ereignisse nach Status</p>
        <div className="flex flex-wrap gap-4">{Object.entries(s.events_by_status as Record<string, number>).map(([k, v]) => <span key={k} className="flex items-center gap-2"><StatusBadge status={k as Status} /> {v}</span>)}</div>
        {s.open_misratings > 0 && <p className="mt-3 text-sm text-warn">{s.open_misratings} gemeldete Fehlbewertung(en) offen.</p>}
      </div>
    </div>
  );
}

function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<any[]>("/admin/users").then(setRows);
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Passwort vergessen? Ohne E-Mail-Dienst (kostenpflichtig) setzt du hier ein temporäres Passwort und gibst es der Person direkt weiter.</p>
      {msg && <p className="rounded-lg bg-sky-500/10 p-3 text-sm">{msg}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Benutzer</th><th className="p-2">E-Mail</th><th className="p-2">Rolle</th><th className="p-2" /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className="border-t border-slate-100 dark:border-ink-700">
              <td className="p-2">{u.username}</td><td className="p-2">{u.email}</td>
              <td className="p-2"><select value={u.role} onChange={(e) => api(`/admin/users/${u.id}`, { method: "PATCH", json: { role: e.target.value } }).then(load).catch((x: Error) => setMsg(x.message))} className={input}>
                {["user", "editor", "admin"].map((r) => <option key={r}>{r}</option>)}</select></td>
              <td className="p-2"><button className="text-xs underline" onClick={() => api<any>(`/admin/users/${u.id}/reset-password`, { method: "POST" }).then((r) => setMsg(`Temporäres Passwort für ${u.username}: ${r.temporary_password} – bitte sofort im Profil ändern lassen.`))}>Passwort zurücksetzen</button></td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

function Sources({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: "", website: "", feed_url: "", country_code: "", source_type: "national_newspaper", owner_group: "", language: "de", base_reliability: 0.7, rationale: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<any[]>("/admin/sources").then(setRows), []);
  useEffect(() => { load(); }, [load]);
  const patch = async (id: number, body: any) => { await api(`/admin/sources/${id}`, { method: "PATCH", json: body }); load(); };
  return (
    <div className="space-y-6">
      {isAdmin && (
        <form className="grid gap-2 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 sm:grid-cols-3 dark:bg-ink-900 dark:ring-ink-700"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/admin/sources", { method: "POST", json: { ...form, feed_url: form.feed_url || null, country_code: form.country_code || null, owner_group: form.owner_group || null, base_reliability: Number(form.base_reliability) } });
              setMsg("Quelle angelegt."); load();
            } catch (x) { setMsg((x as Error).message); }
          }}>
          <p className="sm:col-span-3 font-semibold">Neue Quelle</p>
          {["name", "website", "feed_url", "owner_group", "country_code", "language"].map((k) => (
            <input key={k} placeholder={k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={input} />
          ))}
          <select value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })} className={input}>
            {Object.entries(SOURCE_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="text-sm">Startwert <input type="number" step="0.01" min={0} max={1} value={form.base_reliability} onChange={(e) => setForm({ ...form, base_reliability: e.target.value })} className={`${input} w-24`} /></label>
          <input placeholder="Begründung (redaktionelle Kriterien)" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} className={input} />
          <div className="sm:col-span-3 flex items-center gap-3"><Button>Anlegen</Button>{msg && <span className="text-sm">{msg}</span>}</div>
        </form>
      )}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Quelle</th><th className="p-2">Typ</th><th className="p-2">Land</th><th className="p-2">Wert</th><th className="p-2">Letzter Erfolg</th><th className="p-2">Fehler</th><th className="p-2" /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top dark:border-ink-700">
                <td className="p-2"><b>{s.name}</b><br /><span className="text-xs text-slate-500 break-all">{s.feed_url ?? (s.requires_license ? "Lizenz-API" : "–")}</span></td>
                <td className="p-2">{SOURCE_TYPE_LABEL[s.source_type] ?? s.source_type}</td>
                <td className="p-2">{s.country_code ?? "INT"}</td>
                <td className="p-2">
                  {isAdmin ? <input type="number" step="0.01" min={0} max={1} defaultValue={s.base_reliability} className={`${input} w-20`}
                    onBlur={(e) => Number(e.target.value) !== s.base_reliability && patch(s.id, { base_reliability: Number(e.target.value) })} /> : s.base_reliability}
                </td>
                <td className="p-2 text-xs">{timeAgo(s.last_success_at) || "nie"}</td>
                <td className="p-2 text-xs text-bad max-w-xs">{s.consecutive_errors ? `${s.consecutive_errors}× ${s.last_error ?? ""}` : ""}</td>
                <td className="p-2 whitespace-nowrap">
                  {isAdmin && <>
                    <button onClick={() => patch(s.id, { active: !s.active })} className="mr-2 text-xs underline">{s.active ? "Deaktivieren" : "Aktivieren"}</button>
                    {s.feed_url && <button onClick={() => api<any>(`/admin/sources/${s.id}/fetch`, { method: "POST" }).then((r) => { setMsg(`${s.name}: ${r.new ?? 0} neue Artikel${r.failed ? " – Abruf fehlgeschlagen, siehe Fehlerspalte" : ""}`); load(); })} className="text-xs text-sky-500 underline">Jetzt abrufen</button>}
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Events() {
  const [rows, setRows] = useState<EventCard[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<(EventDetail & { archived: boolean; misratings: any[] }) | null>(null);
  const [edit, setEdit] = useState<{ title: string; description: string; status: Status | ""; score: string; reason: string }>({ title: "", description: "", status: "", score: "", reason: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<EventCard[]>(`/admin/events?q=${encodeURIComponent(q)}`).then(setRows), [q]);
  useEffect(() => { load(); }, [load]);
  const open = async (id: number) => {
    const d = await api<any>(`/admin/events/${id}`);
    setSel(d);
    setEdit({ title: d.title, description: d.summary, status: "", score: "", reason: "" });
    setMsg(null);
  };
  const submit = async (extra: any = {}) => {
    if (!sel) return;
    try {
      const body: any = { reason: edit.reason, ...extra };
      if (!extra.archived && extra.archived !== false && !extra.release_override) {
        if (edit.title !== sel.title) body.title = edit.title;
        if (edit.description !== sel.summary) body.description = edit.description;
        if (edit.status) { body.status = edit.status; body.score = edit.score === "" ? null : Number(edit.score); }
      }
      await api(`/admin/events/${sel.id}`, { method: "PATCH", json: body });
      setMsg("Gespeichert und protokolliert.");
      open(sel.id); load();
    } catch (x) { setMsg((x as Error).message); }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen…" className={`${input} w-full`} />
        <div className="max-h-[70vh] overflow-y-auto rounded-2xl bg-white ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
          {rows.map((e) => (
            <button key={e.id} onClick={() => open(e.id)} className={`flex w-full gap-3 border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50 dark:border-ink-700 dark:hover:bg-ink-800 ${sel?.id === e.id ? "bg-sky-500/10" : ""}`}>
              <ScoreRing score={e.score} size={32} />
              <span className="min-w-0"><StatusBadge status={e.status} /> <span className="line-clamp-2">{e.title}</span><span className="text-xs text-slate-500">{timeAgo(e.last_updated_at)} · {e.article_count} Berichte</span></span>
            </button>
          ))}
        </div>
      </div>
      {!sel ? <Empty>Ereignis auswählen</Empty> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={sel.status} size="md" /><span className="tabular-nums">{sel.score ?? "–"}/100</span>
            {sel.manual_override && <span className="text-xs text-warn">manuell festgelegt</span>}
            {sel.archived && <span className="text-xs text-slate-500">archiviert</span>}
            <Link href={`/event?id=${sel.id}`} className="ml-auto text-sm text-sky-500 underline">Öffentliche Ansicht</Link>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">{sel.explanation}</p>
          <p className="text-xs text-slate-500">Gruppen: {sel.source_groups.map((g) => `${g.group} (${g.articles.length})`).join(" · ")}</p>
          <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
            <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={`${input} w-full`} />
            <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={4} className={`${input} w-full`} />
            <div className="flex flex-wrap gap-2">
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Status })} className={input}>
                <option value="">Status unverändert (TSIE)</option>
                {(Object.keys(STATUS_META) as Status[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {edit.status && <input type="number" min={0} max={100} placeholder="Score (leer = keiner)" value={edit.score} onChange={(e) => setEdit({ ...edit, score: e.target.value })} className={`${input} w-40`} />}
            </div>
            <input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="Begründung (Pflicht, wird protokolliert)" className={`${input} w-full`} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => submit()} disabled={edit.reason.length < 5}>Korrektur speichern</Button>
              <Button variant="ghost" onClick={() => api<any>(`/admin/events/${sel.id}/reanalyze`, { method: "POST" }).then(() => { setMsg("Neu analysiert."); open(sel.id); })}>Neu analysieren</Button>
              {sel.manual_override && <Button variant="ghost" disabled={edit.reason.length < 5} onClick={() => submit({ release_override: true })}>Kontrolle an TSIE zurückgeben</Button>}
              <Button variant="ghost" disabled={edit.reason.length < 5} onClick={() => api(`/admin/events/${sel.id}/misrating`, { method: "POST", json: { reason: edit.reason } }).then(() => setMsg("Fehlbewertung gemeldet."))}>Fehlbewertung melden</Button>
              <Button variant="danger" disabled={edit.reason.length < 5} onClick={() => submit({ archived: !sel.archived })}>{sel.archived ? "Wiederherstellen" : "Archivieren"}</Button>
            </div>
            {msg && <p className="text-sm">{msg}</p>}
          </div>
          {sel.misratings.length > 0 && <div className="text-sm"><b>Gemeldete Fehlbewertungen:</b>{sel.misratings.map((m) => <p key={m.id} className="text-slate-600">{dateTime(m.created_at)} – {m.reason} {m.resolved ? "(erledigt)" : <button className="text-sky-500 underline" onClick={() => api(`/admin/misratings/${m.id}/resolve`, { method: "POST" }).then(() => open(sel.id))}>erledigt</button>}</p>)}</div>}
          <div className="text-sm"><b>Verlauf</b>{sel.history.map((h, i) => <p key={i} className="text-slate-600 dark:text-slate-300">{dateTime(h.created_at)} · {h.status} · {h.score ?? "–"} · {h.trigger}</p>)}</div>
        </div>
      )}
    </div>
  );
}

function LogTable({ path, cols }: { path: string; cols: [string, string][] }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api<any[]>(path).then(setRows).catch(() => setRows([])); }, [path]);
  if (!rows.length) return <Empty>Keine Einträge.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
      <table className="w-full text-xs">
        <thead className="text-left uppercase text-slate-500"><tr>{cols.map(([, l]) => <th key={l} className="p-2">{l}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-100 align-top dark:border-ink-700">{cols.map(([k]) => (
          <td key={k} className="p-2 max-w-md break-words">{k.endsWith("_at") ? dateTime(r[k]) : typeof r[k] === "object" && r[k] !== null ? <code className="text-[10px]">{JSON.stringify(r[k]).slice(0, 300)}</code> : String(r[k] ?? "")}</td>
        ))}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Countries() {
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api<any[]>("/admin/countries").then(setRows);
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">Länder werden in der Datenbank verwaltet. Aktivieren macht sie sofort im Länder-Menü verfügbar.</p>
      {rows.map((c) => (
        <label key={c.id} className="flex items-center gap-3 rounded-lg bg-white p-2 ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
          <input type="checkbox" checked={c.enabled} onChange={() => api(`/admin/countries/${c.code}`, { method: "PATCH", json: { enabled: !c.enabled } }).then(load)} className="accent-sky-500" />
          <span className="text-lg">{c.flag}</span> {c.name} <span className="text-xs text-slate-500">{c.code}</span>
        </label>
      ))}
    </div>
  );
}

export default function Admin() {
  const { user, userLoaded } = useApp();
  const [tab, setTab] = useState<Tab>("overview");
  if (!userLoaded) return null;
  if (!user || (user.role !== "admin" && user.role !== "editor")) return <Empty>Kein Zugriff. Dieser Bereich ist nur für autorisierte Administrator:innen.</Empty>;
  const isAdmin = user.role === "admin";
  const tabs: [Tab, string][] = [["overview", "Übersicht"], ["sources", "Quellen"], ["events", "Nachrichten"], ["errors", "Fehler"], ["jobs", "Jobs"], ...(isAdmin ? ([["audit", "Audit-Log"], ["countries", "Länder"], ["users", "Benutzer"]] as [Tab, string][]) : [])];
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold text-navy-900 dark:text-white">Admin-Dashboard</h1>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-ink-700">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm ${tab === k ? "border-sky-500 font-semibold" : "border-transparent text-slate-500"}`}>{l}</button>)}
      </div>
      {tab === "overview" && <Overview isAdmin={isAdmin} />}
      {tab === "sources" && <Sources isAdmin={isAdmin} />}
      {tab === "events" && <Events />}
      {tab === "errors" && <LogTable path="/admin/errors" cols={[["created_at", "Zeit"], ["component", "Komponente"], ["message", "Meldung"], ["details", "Details"]]} />}
      {tab === "jobs" && <LogTable path="/admin/jobs" cols={[["started_at", "Start"], ["type", "Typ"], ["status", "Status"], ["batch", "Batch"], ["stats", "Ergebnis"], ["error", "Fehler"]]} />}
      {tab === "audit" && <LogTable path="/admin/audit" cols={[["created_at", "Zeit"], ["admin", "Admin"], ["action", "Aktion"], ["entity_type", "Typ"], ["entity_id", "ID"], ["details", "Details"]]} />}
      {tab === "countries" && <Countries />}
      {tab === "users" && <Users />}
    </div>
  );
}
