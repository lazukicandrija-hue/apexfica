// Spaja strukturisana polja kupca + Haiku parsiranje slobodnog teksta u finalne kriterijume.
import type { Buyer } from "./crm.ts";
import type { Criteria } from "./types.ts";
import { roomsToNumber } from "./buyer-criteria.ts";
import { parseCriteria } from "./parse.ts";

function deburr(s: string): string {
  const map: Record<string, string> = { č: "c", ć: "c", š: "s", ž: "z", đ: "dj" };
  return s.toLowerCase().replace(/[čćšžđ]/g, (m) => map[m] ?? m);
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
  return toArray(s)
    .map((x) => deburr(x).trim().replace(/\s+/g, "-"))
    .filter(Boolean);
}

// Kupac iz CRM-a -> kriterijumi. Sobnost = raspon iz desired_rooms; kvartovi = svi iz
// preferred_locations (poklapanje ako je u bilo kom); ostalo (kvadratura, isključenja,
// nijansa cene, sprat) iz slobodnog teksta preko Haiku.
export async function resolveBuyerCriteria(b: Buyer): Promise<Criteria> {
  const rooms = roomsRange(b.desired_rooms);
  const locations = locationSlugs(b.preferred_locations);
  const text = [b.location, b.notes].filter(Boolean).join(". ").trim();

  let parsed: Partial<Criteria> & { location?: string } = {};
  if (text.length > 8) {
    try {
      parsed = await parseCriteria(text);
    } catch {
      /* ako LLM zakaže, oslanjamo se na strukturisana polja */
    }
  }

  return {
    locations: locations.length ? locations : parsed.location ? [parsed.location] : undefined,
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
    location: p.location ?? undefined,
    excludeLocations: p.excludeLocations,
    priceMin: p.priceMin ?? undefined,
    priceMax: p.priceMax ?? undefined,
    areaMin: p.areaMin ?? undefined,
    areaMax: p.areaMax ?? undefined,
    roomsMin: p.roomsMin ?? undefined,
    roomsMax: p.roomsMax ?? undefined,
  };
}
