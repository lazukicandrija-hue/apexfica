// Trajno čuvanje: podešavanja, predlozi, praćenja (watches). Fajlovi pored .env.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Criteria } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
// "here" je .../dist (bundle) ili .../src (dev) → koren projekta je jedan nivo gore
const ROOT = here.endsWith("dist") || here.endsWith("src") ? join(here, "..") : here;
const SETTINGS_FILE = join(ROOT, "settings.json");
const SUGGESTIONS_FILE = join(ROOT, "predlozi.txt");
const EMPTY_LOG = join(ROOT, "prazne-pretrage.txt");
const WATCHES_FILE = join(ROOT, "watches.json");

// ── Podešavanja ──
export type Settings = {
  priceTolerance: number; // 0.1 = dozvoli +10% preko budžeta
  resultCount: number; // koliko rezultata prikazati
  maxPages: number; // dubina pretrage 4zida (broj strana)
};

const DEFAULTS: Settings = { priceTolerance: 0, resultCount: 8, maxPages: 18 };

export function getSettings(): Settings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) };
    }
  } catch {
    /* loš fajl → podrazumevano */
  }
  return { ...DEFAULTS };
}

export function setSetting(key: keyof Settings, value: number): void {
  const s = getSettings();
  s[key] = value;
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

// ── Predlozi ──
export function addSuggestion(user: string, text: string): void {
  appendFileSync(SUGGESTIONS_FILE, `[${new Date().toISOString()}] @${user}: ${text}\n`);
}

export function listSuggestions(limit = 20): string[] {
  try {
    if (!existsSync(SUGGESTIONS_FILE)) return [];
    return readFileSync(SUGGESTIONS_FILE, "utf8").trim().split("\n").filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}

export function logEmpty(who: string, query: string, criteria: unknown): void {
  try {
    appendFileSync(
      EMPTY_LOG,
      `[${new Date().toISOString()}] ${who} | "${query}" | ${JSON.stringify(criteria)}\n`,
    );
  } catch {
    /* ignoriši */
  }
}

// ── Praćenja (watches) ──
export type Watch = {
  id: string; // npr. "w1"
  label: string; // ime kupca ili tekst pretrage
  chatId: number; // kome se šalju alarmi (Telegram chat)
  criteria: Criteria;
  seen: string[]; // ID-jevi oglasa koji su već javljeni/zatečeni
  createdAt: string;
};

export function getWatches(): Watch[] {
  try {
    if (existsSync(WATCHES_FILE)) return JSON.parse(readFileSync(WATCHES_FILE, "utf8")) as Watch[];
  } catch {
    /* ignoriši */
  }
  return [];
}

function saveWatches(list: Watch[]): void {
  writeFileSync(WATCHES_FILE, JSON.stringify(list, null, 2));
}

export function addWatch(w: Omit<Watch, "id" | "createdAt">): Watch {
  const all = getWatches();
  const nums = all.map((x) => Number(x.id.replace(/\D/g, "")) || 0);
  const watch: Watch = { ...w, id: "w" + (Math.max(0, ...nums) + 1), createdAt: new Date().toISOString() };
  all.push(watch);
  saveWatches(all);
  return watch;
}

export function removeWatch(id: string): boolean {
  const all = getWatches();
  const next = all.filter((w) => w.id.toLowerCase() !== id.toLowerCase());
  if (next.length === all.length) return false;
  saveWatches(next);
  return true;
}

export function updateWatchSeen(id: string, seen: string[]): void {
  const all = getWatches();
  const w = all.find((x) => x.id === id);
  if (!w) return;
  w.seen = seen.slice(-300); // ograniči rast
  saveWatches(all);
}
