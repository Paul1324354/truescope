import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", display: "swap", weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "TrueScope – See Beyond the Headlines", template: "%s · TrueScope" },
  description: "KI-gestützte Nachrichtenplattform: Quellen vergleichen, Unabhängigkeit prüfen, Verifizierung transparent erklären.",
  applicationName: "TrueScope",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0B0D10" }, { media: "(prefers-color-scheme: light)", color: "#0A1A33" }],
  width: "device-width", initialScale: 1, viewportFit: "cover",
};

// Applies the stored theme before paint (no flash). Static string, no user input.
const themeScript = `try{var t=JSON.parse(localStorage.getItem('ts.theme')||'"system"');if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-screen font-sans">
        <Providers>
          <Suspense fallback={<div className="h-28" />}><Header /></Suspense>
          <main className="mx-auto max-w-7xl px-4 py-6 pb-24">{children}</main>
          <footer className="border-t border-slate-200 dark:border-ink-700">
            <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 px-4 py-8 text-xs text-slate-500">
              <span>© TrueScope – See Beyond the Headlines</span>
              <Link href="/methodology" className="hover:underline">Methodik & Bewertung</Link>
              <Link href="/sources" className="hover:underline">Überwachte Quellen</Link>
              <span className="w-full sm:w-auto">TrueScope garantiert keine absolute Wahrheit. Bewertungen sind nachvollziehbare Einordnungen auf Basis der verfügbaren Quellen.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
