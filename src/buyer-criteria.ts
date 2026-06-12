// Pretvara kupca iz CRM-a u filtere za pretragu portala.
// NAPOMENA: parsiranje `notes` (kvadratura/cena) je PRVA VERZIJA — doteraćemo
// kad vidimo kako Isak/Maja stvarno pišu napomene na pravim podacima.
import type { Buyer } from "./crm.ts";
import type { Criteria } from "./types.ts";

// Srpski nazivi sobnosti -> broj (kao 4zida numberOfRooms)
const ROOMS: Record<string, number> = {
  garsonjera: 0.5,
  jednosoban: 1,
  jednoiposoban: 1.5,
  dvosoban: 2,
  dvoiposoban: 2.5,
  trosoban: 3,
  troiposoban: 3.5,
  cetvorosoban: 4,
  cetvoroiposoban: 4.5,
  petosoban: 5,
};

// Srpska latinica -> ASCII (kao u 4zida slug-ovima: đ -> dj, š -> s ...)
function deburr(s: string): string {
  const map: Record<string, string> = { č: "c", ć: "c", š: "s", ž: "z", đ: "dj" };
  return s.toLowerCase().replace(/[čćšžđ]/g, (m) => map[m] ?? m);
}

export function roomsToNumber(s?: string | null): number | undefined {
  if (!s) return undefined;
  const t = deburr(s).trim();
  for (const [word, num] of Object.entries(ROOMS)) if (t.includes(word)) return num;
  const n = Number(t.replace(",", "."));
  return Number.isNaN(n) ? undefined : n;
}

// Kvadratura iz napomena: "50m2", "50-60 kvadrata", "oko 55 kv"
function parseAreaFromNotes(notes?: string | null): { areaMin?: number; areaMax?: number } {
  if (!notes) return {};
  const t = deburr(notes);
  const range = t.match(/(\d{2,3})\s*(?:-|–|do)\s*(\d{2,3})\s*(?:m2|m²|kv|kvadrat)/);
  if (range) return { areaMin: Number(range[1]), areaMax: Number(range[2]) };
  const single = t.match(/(\d{2,3})\s*(?:m2|m²|kv|kvadrat)/);
  if (single) {
    const a = Number(single[1]);
    return { areaMin: a - 5, areaMax: a + 10 }; // tolerancija oko tražene kvadrature
  }
  return {};
}

// Raspon cene iz napomena: "100-120k", "100.000-120.000"
function parsePriceFromNotes(notes?: string | null): { priceMin?: number; priceMax?: number } {
  if (!notes) return {};
  const t = deburr(notes).replace(/\./g, "");
  const k = t.match(/(\d{2,3})\s*(?:-|–)\s*(\d{2,3})\s*k/);
  if (k) return { priceMin: Number(k[1]) * 1000, priceMax: Number(k[2]) * 1000 };
  const range = t.match(/(\d{5,7})\s*(?:-|–)\s*(\d{5,7})/);
  if (range) return { priceMin: Number(range[1]), priceMax: Number(range[2]) };
  return {};
}

function firstPreferredLocation(b: Buyer): string | undefined {
  if (b.preferred_locations) {
    try {
      const arr = JSON.parse(b.preferred_locations);
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch {
      /* nije JSON */
    }
  }
  return b.location ?? undefined;
}

export function buyerToCriteria(b: Buyer): Criteria {
  const rooms = roomsToNumber(b.desired_rooms);
  const area = parseAreaFromNotes(b.notes);
  const price = parsePriceFromNotes(b.notes);
  const loc = firstPreferredLocation(b);

  return {
    location: loc ? deburr(loc).replace(/\s+/g, "-") : undefined,
    priceMin: price.priceMin,
    priceMax: price.priceMax ?? (b.budget ?? undefined), // budžet = maksimum
    areaMin: area.areaMin,
    areaMax: area.areaMax,
    roomsMin: rooms,
    roomsMax: rooms,
  };
}
