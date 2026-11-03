"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/Providers";
import { Button, Field } from "@/components/ui";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

export default function Login() {
  const { setUser } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setUser(await api<User>("/auth/login", { method: "POST", json: { email, password } }));
      router.push("/");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-6 font-serif text-3xl font-semibold text-navy-900 dark:text-white">Anmelden</h1>
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-Mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Passwort" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <Button disabled={busy} className="w-full">{busy ? "…" : "Anmelden"}</Button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/register" className="text-sky-500 hover:underline">Konto erstellen</Link>
        <Link href="/forgot-password" className="text-slate-500 hover:underline">Passwort vergessen?</Link>
      </div>
      <p className="mt-8 text-xs text-slate-500">Du kannst TrueScope auch ohne Konto im Gastmodus nutzen. Deine Länderauswahl wird dann nur in diesem Browser gespeichert.</p>
    </div>
  );
}
