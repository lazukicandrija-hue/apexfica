// oglasi.rs portal: server HTML + schema.org microdata. Filter za vlasnike: ?rt=vlasnik.
import type { Listing } from "../types.ts";
import { roomsToNumber } from "../buyer-criteria.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://www.oglasi.rs";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function deburr(s: string): string {
  const m: Record<string, string> = { č: "c", ć: "c", š: "s", ž: "z", đ: "dj" };
  return s.toLowerCase().replace(/[čćšžđ]/g, (c) => m[c] ?? c);
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseListings(html: string): Listing[] {
  const out: Listing[] = [];
  const blocks = html
    .split(/(?=<article itemprop="itemListElement")/)
    .filter((b) => b.startsWith("<article"));

  for (const a of blocks) {
    const href = a.match(/href="(\/oglas\/[^"]+)"/);
    if (!href) continue;
    const url = BASE + href[1];
    const id = href[1].match(/\/oglas\/([0-9-]+)\//)?.[1] ?? url;

    const priceM = a.match(/itemprop="price"[^>]*content="([\d.]+)"/);
    const price = priceM ? Math.round(Number(priceM[1])) : null;
    const curM = a.match(/itemprop="priceCurrency"[^>]*content="([A-Z]+)"/);

    const areaM = a.match(/Kvadratura:[\s\S]*?<strong>\s*([\d.,]+)\s*m/);
    const area = areaM ? Number(areaM[1].replace(/\./g, "").replace(",", ".")) : null;

    const roomsM = a.match(/Sobnost:[\s\S]*?<strong>\s*([^<]+?)\s*<\/strong>/);
    const rooms = roomsM ? roomsToNumber(decode(roomsM[1]).trim()) ?? null : null;

    const cats = [...a.matchAll(/itemprop="category"[^>]*>([^<]+)<\/a>/g)].map((m) => decode(m[1]).trim());
    const locationName = cats.length ? cats[cats.length - 1] : "";

    const citeM = a.match(/<cite>\s*([\s\S]*?)\s*<\/cite>/);
    const cite = citeM ? decode(citeM[1].replace(/\s+/g, " ")).trim() : "";
    const seller: "owner" | "agency" = /agencij|reg\.\s*br|reg\.\s*pos|d\.?o\.?o/i.test(cite)
      ? "agency"
      : "owner";

    out.push({
      id,
      url,
      price,
      currency: curM ? curM[1] : price ? "EUR" : null,
      area: area && !Number.isNaN(area) ? area : null,
      rooms,
      pricePerM2: price && area ? Math.round(price / area) : null,
      location: deburr(locationName).replace(/\s+/g, "-"),
      portal: "oglasi.rs",
      seller,
    });
  }
  return out;
}

export async function searchOglasi(
  opts: { ownerOnly?: boolean; maxPages?: number; delayMs?: number } = {},
): Promise<Listing[]> {
  const ownerOnly = opts.ownerOnly ?? true;
  const maxPages = opts.maxPages ?? 12;
  const delayMs = opts.delayMs ?? 1500;

  const byId = new Map<string, Listing>();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/nekretnine/prodaja-stanova/novi-sad?${ownerOnly ? "rt=vlasnik&" : ""}p=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "sr,en;q=0.9" } });
    } catch {
      break;
    }
    if (!res.ok) break;

    const html = await res.text();
    const listings = parseListings(html);
    if (!listings.length) break;

    let added = 0;
    for (const l of listings) if (!byId.has(l.id)) (byId.set(l.id, l), added++);
    if (!added) break;

    const totalM = html.match(/stranica\s*\d+\s*od\s*(\d+)/i);
    if (totalM && page >= Number(totalM[1])) break;
    if (page < maxPages) await sleep(delayMs);
  }
  return [...byId.values()];
}
