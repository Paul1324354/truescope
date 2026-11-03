"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { FLAG, SOURCE_TYPE_LABEL } from "@/lib/format";

interface Src { id: number; name: string; website: string; type: string; country: string | null; owner_group: string | null; base_reliability: number; rationale: string | null; active: boolean; requires_license: boolean }

export default function Sources() {
  const [rows, setRows] = useState<Src[] | null>(null);
  useEffect(() => { api<Src[]>("/sources").then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl font-semibold text-navy-900 dark:text-white">Überwachte Quellen</h1>
      <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">Transparenz: Diese Quellen beobachtet TrueScope. Die Startbewertung beruht auf redaktionellen Prozessmerkmalen, nicht auf politischer Ausrichtung. Agenturen ohne öffentlichen Feed benötigen eine Lizenz; sie werden trotzdem erkannt, wenn andere Medien sie zitieren.</p>
      {!rows ? <Skeleton className="h-96" /> : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70 dark:bg-ink-900 dark:ring-ink-700">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-3">Quelle</th><th className="p-3">Typ</th><th className="p-3">Land</th><th className="p-3">Medienhaus</th><th className="p-3">Startwert</th><th className="p-3">Status</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 dark:border-ink-700">
                <td className="p-3"><a href={s.website} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-sky-500">{s.name}</a></td>
                <td className="p-3">{SOURCE_TYPE_LABEL[s.type] ?? s.type}</td>
                <td className="p-3">{s.country ? `${FLAG[s.country] ?? ""} ${s.country}` : "International"}</td>
                <td className="p-3 text-slate-500">{s.owner_group ?? "–"}</td>
                <td className="p-3 tabular-nums" title={s.rationale ?? ""}>{s.base_reliability.toFixed(2)}</td>
                <td className="p-3 text-xs">{s.requires_license ? "Lizenz nötig" : s.active ? "aktiv" : "inaktiv"}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
