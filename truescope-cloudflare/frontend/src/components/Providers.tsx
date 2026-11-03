"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Country, User } from "@/lib/types";

type Theme = "system" | "light" | "dark";

interface AppState {
  user: User | null;
  userLoaded: boolean;
  setUser: (u: User | null) => void;
  refreshUser: () => Promise<void>;
  countries: Country[];
  selected: string[]; // [] = Global
  setSelected: (codes: string[]) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<AppState | null>(null);
const LS_COUNTRIES = "ts.countries";
const LS_THEME = "ts.theme";

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) – keep in memory */
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [selected, setSelectedState] = useState<string[]>([]);
  const [theme, setThemeState] = useState<Theme>("system");

  const refreshUser = useCallback(async () => {
    try {
      const u = await api<User>("/auth/me");
      setUser(u);
      if (u.preferences.preferred_countries.length) setSelectedState(u.preferences.preferred_countries);
    } catch {
      setUser(null);
    } finally {
      setUserLoaded(true);
    }
  }, []);

  useEffect(() => {
    setSelectedState(readLS<string[]>(LS_COUNTRIES, []));
    setThemeState(readLS<Theme>(LS_THEME, "system"));
    api<Country[]>("/countries").then(setCountries).catch(() => setCountries([]));
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const setSelected = useCallback(
    (codes: string[]) => {
      setSelectedState(codes);
      writeLS(LS_COUNTRIES, codes);
      if (user) {
        const p = user.preferences;
        api<User>("/me/preferences", {
          method: "PUT",
          json: { ...p, preferred_countries: codes, notification_settings: { enabled: true, breaking: true, countries: [], categories: [], min_status: "STRONGLY_CORROBORATED", ...p.notification_settings } },
        }).then(setUser).catch(() => undefined);
      }
    },
    [user],
  );

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writeLS(LS_THEME, t);
  }, []);

  const value = useMemo(
    () => ({ user, userLoaded, setUser, refreshUser, countries, selected, setSelected, theme, setTheme }),
    [user, userLoaded, refreshUser, countries, selected, setSelected, theme, setTheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside Providers");
  return v;
}

export function countriesParam(selected: string[]): string {
  return selected.length ? selected.join(",") : "GLOBAL";
}
