"use client";

import Link from "next/link";
import { STATUS_META } from "@/lib/format";
import type { Status } from "@/lib/types";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="TrueScope Startseite">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-navy-800 dark:text-sky-300" />
        <circle cx="16" cy="16" r="7.5" fill="none" stroke="#3A97F5" strokeWidth="2.2" />
        <circle cx="16" cy="16" r="2.4" fill="#3A97F5" />
        <path d="M16 1.5v5M16 25.5v5M1.5 16h5M25.5 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-navy-800 dark:text-sky-300" />
      </svg>
      {!compact && (
        <span className="leading-none">
          <span className="block font-serif text-[1.35rem] font-semibold tracking-tight text-navy-900 dark:text-white">
            True<span className="text-sky-500">Scope</span>
          </span>
          <span className="hidden sm:block text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mt-0.5">
            See Beyond the Headlines
          </span>
        </span>
      )}
    </Link>
  );
}

const TONE: Record<string, string> = {
  ok: "bg-ok/10 text-ok ring-ok/30 dark:bg-ok/15",
  info: "bg-sky-500/10 text-sky-500 ring-sky-500/30 dark:text-sky-300",
  warn: "bg-warn/10 text-[#A97A05] ring-warn/30 dark:text-warn",
  bad: "bg-bad/10 text-bad ring-bad/30",
  muted: "bg-slate-500/10 text-slate-600 ring-slate-500/25 dark:text-slate-300",
};

export function StatusBadge({ status, size = "sm" }: { status: Status; size?: "sm" | "md" }) {
  const m = STATUS_META[status];
  return (
    <span
      title={m.help}
      className={`inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset font-semibold tracking-wide ${TONE[m.tone]} ${size === "md" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10.5px]"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {m.short}
    </span>
  );
}

export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const v = score ?? 0;
  const color = score === null ? "#94A3B8" : v >= 75 ? "#2FA36B" : v >= 50 ? "#3A97F5" : v >= 30 ? "#D9A21B" : "#D2483F";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={score === null ? "Datenlage zu dünn für einen Score" : `Confidence Score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3.5" className="stroke-slate-200 dark:stroke-ink-600" />
        {score !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`} />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums text-navy-900 dark:text-white">
        {score === null ? "–" : score}
      </span>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-4 border-b border-slate-200 dark:border-ink-700 pb-2">
      <h2 className="font-serif text-xl font-semibold text-navy-900 dark:text-white">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-ink-600 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 dark:bg-ink-700 ${className}`} />;
}

export function Button({ variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-navy-800 text-white hover:bg-navy-700 dark:bg-sky-500 dark:text-navy-950 dark:hover:bg-sky-400",
    ghost: "border border-slate-300 dark:border-ink-600 hover:bg-slate-100 dark:hover:bg-ink-800",
    danger: "bg-bad text-white hover:opacity-90",
  }[variant];
  return <button {...props} className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${v} ${className}`} />;
}

export function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <input {...props} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 dark:border-ink-600 dark:bg-ink-900" />
    </label>
  );
}
