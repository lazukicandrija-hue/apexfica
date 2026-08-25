// Spaja strukturisana polja kupca + Haiku parsiranje slobodnog teksta u finalne kriterijume.
import type { Buyer } from "./crm.ts";
import type { Criteria } from "./types.ts";
import { roomsToNumber } from "./buyer-criteria.ts";
import { parseCriteria } from "./parse.ts";

function deburr(s: string): string {
  const map: Record<string, string> = { č: "c", ć: "c", š: "s", ž: "z", đ: "dj" };
  return s.toLowerCase().replace(/[čćšžđ]/g, (m) => map[m] ?? m);
}

// Rimski broj na kraju lokacije → arapski (Liman I → Liman 1; portali koriste "liman-1")
function romanToArabic(s: string): string {
  const map: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6" };
  return s.replace(/\s+(i{1,3}|iv|vi{0,3}|v)\s*$/i, (_, r) => " " + (map[r.toLowerCase()] ?? r));
}

// Normalizuj lokaciju u slug: rimski→arapski, bez kvačica, razmak→crtica
function normLoc(x: string): string {
  return deburr(romanToArabic(x)).trim().replace(/\s+/g, "-");
}

// Prihvata JSON niz ('["Dvosoban","Jednoiposoban"]'), zarezom razdvojeno ("1.5, 2"), ili jednu vrednost.
function toArray(s?: string | null): string[] {
  if (!s) return [];
  try {
    const a = JSON.parse(s);
    if (Array.isArray(a)) return a.map(String);
  } catch {
    /* nije JSON */
  }
  return String(s)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// "1.5, 2" / ["Jednoiposoban","Dvosoban"] -> { min: 1.5, max: 2 }
function roomsRange(s?: string | null): { min?: number; max?: number } {
  const nums = toArray(s)
    .map((x) => roomsToNumber(x))
    .filter((n): n is number => n != null);
  if (!nums.length) return {};
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function locationSlugs(s?: string | null): string[] {
  return toArray(s).map(normLoc).filter(Boolean);
}

// Kupac iz CRM-a -> kriterijumi. Sobnost = raspon iz desired_rooms; kvartovi = svi iz
// preferred_locations (poklapanje ako je u bilo kom); ostalo (kvadratura, isključenja,
// nijansa cene, sprat) iz slobodnog teksta preko Haiku.
export async function resolveBuyerCriteria(b: Buyer): Promise<Criteria> {
  const rooms = roomsRange(b.desired_rooms);
  const locations = locationSlugs(b.preferred_locations);
  const text = [b.location, b.notes].filter(Boolean).join(". ").trim();

  let parsed: Partial<Criteria> = {};
  if (text.length > 8) {
    try {
      parsed = await parseCriteria(text);
    } catch {
      /* ako LLM zakaže, oslanjamo se na strukturisana polja */
    }
  }

  return {
    locations: locations.length ? locations : parsed.locations?.length ? parsed.locations : undefined,
    excludeLocations: parsed.excludeLocations,
    priceMin: parsed.priceMin ?? undefined,
    priceMax: parsed.priceMax ?? (b.budget ?? undefined),
    areaMin: parsed.areaMin ?? undefined,
    areaMax: parsed.areaMax ?? undefined,
    roomsMin: rooms.min,
    roomsMax: rooms.max,
  };
}

// Slobodan tekst (Telegram poruka) -> kriterijumi.
export async function criteriaFromText(text: string): Promise<Criteria> {
  const p = await parseCriteria(text);
  return {
    locations: p.locations?.length ? p.locations.map(normLoc) : undefined,
    excludeLocations: p.excludeLocations,
    priceMin: p.priceMin ?? undefined,
    priceMax: p.priceMax ?? undefined,
    areaMin: p.areaMin ?? undefined,
    areaMax: p.areaMax ?? undefined,
    roomsMin: p.roomsMin ?? undefined,
    roomsMax: p.roomsMax ?? undefined,
  };
}
