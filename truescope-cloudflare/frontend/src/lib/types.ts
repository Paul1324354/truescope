export type Status =
  | "VERIFIED"
  | "STRONGLY_CORROBORATED"
  | "DEVELOPING"
  | "DISPUTED"
  | "UNCONFIRMED"
  | "FALSE"
  | "RETRACTED";

export interface Country { code: string; name: string; name_en: string; flag: string }
export interface Category { slug: string; name: string; name_en: string }

export interface EventCard {
  id: number;
  title: string;
  summary: string;
  image_url: string | null;
  event_date: string;
  last_updated_at: string;
  status: Status;
  score: number | null;
  independent_sources: number;
  article_count: number;
  is_breaking: boolean;
  countries: { code: string; relation: "location" | "mentioned" | "source" }[];
  categories: string[];
  sources: string[];
  manual_override: boolean;
  is_demo: boolean;
}

export interface Claim { kind: string; value: number; type: string; evidence: string }

export interface SourceArticle {
  article_id: number;
  title: string;
  url: string;
  teaser: string;
  published_at: string;
  source: string;
  source_type: string;
  source_country: string | null;
  source_website: string;
  owner_group: string | null;
  wire_origin: string | null;
  is_opinion: boolean;
  hedged: boolean;
  claims: Claim[];
}

export interface Factor { key: string; label: string; value: number; max: number; detail: string }

export interface EventDetail extends EventCard {
  facts: { what: string | null; where: string[]; when: string | null; who: string[] };
  confirmed: string[];
  unclear: string[];
  contradictions: { kind: string; label: string; description: string }[];
  explanation: string;
  factors: Factor[];
  last_verified_at: string | null;
  generated_by: string;
  source_groups: { group: string; articles: SourceArticle[] }[];
  history: { status: Status; score: number | null; trigger: string; created_at: string; explanation: string }[];
}

export interface HomeData {
  top: EventCard[];
  latest: EventCard[];
  verified: EventCard[];
  breaking: EventCard[];
  international: EventCard[];
  by_category: Record<string, EventCard[]>;
  developing: EventCard[];
  trending: EventCard[];
  verification_overview: Partial<Record<Status, number>>;
  generated_at: string;
}

export interface NotificationSettings {
  enabled: boolean;
  breaking: boolean;
  countries: string[];
  categories: string[];
  min_status: Status;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: "user" | "editor" | "admin";
  created_at: string;
  preferences: {
    preferred_countries: string[];
    preferred_categories: string[];
    notification_settings: Partial<NotificationSettings>;
    theme: "system" | "light" | "dark";
  };
}

export interface Paged<T> { items: T[]; next_cursor: number | null; total?: number }
