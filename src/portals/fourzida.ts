// 4zida portal: pretraga preko SSR stranica + parsiranje JSON-LD podataka.
// Bez headless browsera, bez reverse-engineeringa internog API-ja.
import type { Listing } from "../types.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://www.4zida.rs";

// Keš rezultata po lokaciji (5 min) — bot ne mora da re-skuplja na svaku poruku.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: Listing[] }>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

// slug kvarta = segment posle "prodaja-stanova" u putanji oglasa
function locationFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    // oglasi su pod /prodaja-stanova/<kvart>/... ili /novogradnja/<kvart>/...
    const i = parts.findIndex((p) => p === "prodaja-stanova" || p === "novogradnja");
    return i >= 0 && parts[i + 1] ? parts[i + 1] : "";
  } catch {
    return "";
  }
}

// Izvuče sve oglase iz JSON-LD blokova jedne SSR strane.
export function parseListings(html: string): Listing[] {
  const blocks = [
    ...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs),
  ].map((m) => m[1]);

  const out: Listing[] = [];
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    collect(data, out);
  }
  return out;
}

function collect(node: unknown, out: Listing[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  if (!node || typeof node !== "object") return;

  const o = node as Record<string, unknown>;
  if (o["@type"] === "ListItem" && o.item && typeof o.item === "object") {
    const it = o.item as Record<string, unknown>;
    const offers = (it.offers ?? {}) as Record<string, unknown>;
    const itemOffered = (it.itemOffered ?? {}) as Record<string, unknown>;
    const floorSize = (itemOffered.floorSize ?? {}) as Record<string, unknown>;
    const url = typeof it.url === "string" ? it.url : null;
    const price = toNum(offers.price);

    // Pravi oglas (ne "breadcrumb" navigacija) ima cenu ili kvadraturu/sobe.
    const isListing =
      url != null &&
      (price !== null || floorSize.value != null || itemOffered.numberOfRooms != null);

    if (url && isListing) {
      const area = toNum(floorSize.value);
      out.push({
        id: url.split("/").filter(Boolean).pop() ?? url,
        url,
        price,
        currency: typeof offers.priceCurrency === "string" ? offers.priceCurrency : null,
        area,
        rooms: toNum(itemOffered.numberOfRooms),
        pricePerM2: price && area ? Math.round(price / area) : null,
        location: locationFromUrl(url),
        portal: "4zida",
      });
    }
  }

  for (const v of Object.values(o)) collect(v, out);
}

export type SearchOptions = {
  locationSlug?: string; // putanja pretrage, default "novi-sad" (ceo NS)
  maxPages?: number; // bezbednosna granica broja strana
  delayMs?: number; // pauza između strana (ljubazno prema 4zida)
  onPage?: (page: number, total: number) => void;
};

// Prolazi kroz strane SSR pretrage i vraća deduplikovane oglase.
export async function searchFourZida(opts: SearchOptions = {}): Promise<Listing[]> {
  const locationSlug = opts.locationSlug ?? "novi-sad";
  const maxPages = opts.maxPages ?? 10;
  const delayMs = opts.delayMs ?? 600;

  const cacheKey = `${locationSlug}:${maxPages}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const byId = new Map<string, Listing>();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/prodaja-stanova/${locationSlug}${page > 1 ? `?strana=${page}` : ""}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { "user-agent": UA } });
    } catch {
      break;
    }
    if (!res.ok) break;

    const listings = parseListings(await res.text());
    if (listings.length === 0) break;

    let added = 0;
    for (const l of listings) {
      if (!byId.has(l.id)) {
        byId.set(l.id, l);
        added++;
      }
    }
    opts.onPage?.(page, byId.size);

    if (added === 0) break; // lista se ponavlja => kraj rezultata
    if (page < maxPages) await sleep(delayMs);
  }

  const data = [...byId.values()];
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

// 4zida ne otkriva tip prodavca u pretrazi — proveri sa detaljne strane oglasa.
// advertiserType: 4 = Vlasnik; 1/2/3 = Agencija/Firma/Investitor (= nije vlasnik).
const sellerCache = new Map<string, "owner" | "agency" | null>();

export async function getFourZidaSeller(url: string): Promise<"owner" | "agency" | null> {
  const cached = sellerCache.get(url);
  if (cached !== undefined) return cached;
  let seller: "owner" | "agency" | null = null;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.ok) {
      const m = (await res.text()).match(/advertiserType[\\"\s]*:[\\"\s]*(\d+)/);
      if (m) seller = m[1] === "4" ? "owner" : "agency";
    }
  } catch {
    /* mreža — ostavi null */
  }
  sellerCache.set(url, seller);
  return seller;
}
