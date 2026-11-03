import type { Claim, Contradiction } from "./claims.ts";

export const STATUSES = ["VERIFIED", "STRONGLY_CORROBORATED", "DEVELOPING", "DISPUTED", "UNCONFIRMED", "FALSE", "RETRACTED"] as const;
export type Status = (typeof STATUSES)[number];

export const SOURCE_TYPES = ["wire_agency", "public_broadcaster", "national_newspaper", "regional_news", "broadcaster", "investigative",
  "official", "press_release", "aggregator", "other"] as const;

export interface SourceProfile {
  id: number;
  name: string;
  source_type: string;
  country_code: string | null;
  owner_group: string | null;
  base_reliability: number;
  corrections_90d: number;
  wire_key: string | null;
}

export interface ArticleInput {
  id: number;
  title: string;
  summary: string;
  url: string;
  source: SourceProfile;
  published_at: number; // epoch ms
  feed_categories: string[];
}

/** Stored per article in D1 (JSON). Compact on purpose. */
export interface Analysis {
  tt: string[];          // title tokens
  bt: string[];          // body tokens
  wire: string | null;
  opinion: boolean;
  hedged: boolean;
  retraction: boolean;
  debunk: boolean;
  official: boolean;
  countries: string[];
  places: string[];
  entities: string[];
  categories: string[];
  claims: Claim[];
  injection: string[];
}

export interface Factor { key: string; label: string; value: number; max: number; detail: string }

export interface Assessment {
  status: Status;
  score: number | null;
  explanation: string;
  factors: Factor[];
  groups: Record<string, number[]>;
  credible: number;
  contradictions: Contradiction[];
  confirmed: string[];
  unclear: string[];
  breaking: boolean;
}
