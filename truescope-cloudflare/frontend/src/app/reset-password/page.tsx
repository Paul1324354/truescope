"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Field } from "@/components/ui";
import { api } from "@/lib/api";

function Reset() {
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState("");
  const [state, setState] = useState<"idle" | "ok" | string>("idle");
  if (state === "ok") return <p className="py-10 text-center">Passwort geändert. <Link href="/login" className="text-sky-500 underline">Jetzt anmelden</Link></p>;
  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-6 font-serif text-3xl font-semibold text-navy-900 dark:text-white">Neues Passwort</h1>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        try { await api("/auth/reset", { method: "POST", json: { token, password: pw } }); setState("ok"); } catch (x) { setState((x as Error).message); }
      }}>
        <Field label="Neues Passwort" type="password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} />
        {state !== "idle" && <p className="text-sm text-bad">{state}</p>}
        <Button className="w-full">Speichern</Button>
      </form>
    </div>
  );
}
export default function Page() { return <Suspense><Reset /></Suspense>; }
