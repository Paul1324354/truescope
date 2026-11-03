"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/Providers";
import { Button, Field } from "@/components/ui";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

export default function Register() {
  const { setUser } = useApp();
  const router = useRouter();
  const [f, setF] = useState({ username: "", email: "", password: "" });
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      setUser(await api<User>("/auth/register", { method: "POST", json: f }));
      router.push("/profile");
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-6 font-serif text-3xl font-semibold text-navy-900 dark:text-white">Konto erstellen</h1>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Benutzername" required minLength={3} maxLength={40} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <Field label="E-Mail" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field label="Passwort (mind. 10 Zeichen, Buchstaben und Ziffern)" type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <label className="flex gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-0.5 accent-sky-500" />
          Ich stimme der Verarbeitung meiner Daten (E-Mail, Einstellungen, Leseverlauf) zum Betrieb meines Kontos zu. Ich kann alles jederzeit exportieren oder löschen.
        </label>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <Button className="w-full" disabled={!consent}>Registrieren</Button>
      </form>
      <p className="mt-6 text-sm">Schon registriert? <Link href="/login" className="text-sky-500 hover:underline">Anmelden</Link></p>
    </div>
  );
}
