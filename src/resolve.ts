// Spaja strukturisana polja kupca + Haiku parsiranje slobodnog teksta u finalne kriterijume.
import type { Buyer } from "./crm.ts";
import type { Criteria } from "./types.ts";
import { roomsToNumber } from "./buyer-criteria.ts";
import { parseCriteria } from "./parse.ts";

function firstFromJsonArray(s?: string | null): string | undefined {
  if (!s) return undefined;
  try {
    const a = JSON.parse(s);
    if (Array.isArray(a) && a.length) return String(a[0]);
  } catch {
    /* nije JSON niz */
  }
  return s;
}

// Kupac iz CRM-a -> kriterijumi (sobnost iz strukture, ostalo iz slobodnog teksta preko Haiku).
export async function resolveBuyerCriteria(b: Buyer): Promise<Criteria> {
  const rooms = roomsToNumber(firstFromJsonArray(b.desired_rooms));
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
    location: parsed.location ?? undefined,
    excludeLocations: parsed.excludeLocations,
    priceMin: parsed.priceMin ?? undefined,
    priceMax: parsed.priceMax ?? (b.budget ?? undefined),
    areaMin: parsed.areaMin ?? undefined,
    areaMax: parsed.areaMax ?? undefined,
    roomsMin: rooms ?? parsed.roomsMin ?? undefined,
    roomsMax: rooms ?? parsed.roomsMax ?? undefined,
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
