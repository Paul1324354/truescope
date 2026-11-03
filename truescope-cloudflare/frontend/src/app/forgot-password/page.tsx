"use client";

import { useState } from "react";
import { Button, Field } from "@/components/ui";
import { api } from "@/lib/api";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-6 font-serif text-3xl font-semibold text-navy-900 dark:text-white">Passwort zurücksetzen</h1>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const r = await api<{ message: string }>("/auth/forgot", { method: "POST", json: { email } }).catch((x: Error) => ({ message: x.message }));
        setMsg(r.message);
      }}>
        <p className="text-sm text-slate-600 dark:text-slate-300">Diese kostenlose TrueScope-Instanz versendet keine E-Mails. Die Administration kann dir ein temporäres Passwort setzen.</p>
        <Field label="E-Mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button className="w-full">Hinweis anzeigen</Button>
        {msg && <p className="text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
      </form>
    </div>
  );
}
