// nekretnine.rs portal: Next.js — podaci su u <script id="__NEXT_DATA__"> JSON-u.
// Vlasnik vs agencija se vidi po `advertiser` polju svakog oglasa.
import type { Listing } from "../types.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function deburr(s: string): string {
  const m: Record<string, string> = { č: "c", ć: "c", š: "s", ž: "z", đ: "dj" };
  return s.toLowerCase().replace(/[čćšžđ]/g, (c) => m[c] ?? c);
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function nextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export async function searchNekretnine(
  opts: { maxPages?: number; delayMs?: number } = {},
): Promise<Listing[]> {
  const maxPages = opts.maxPages ?? 12;
  const delayMs = opts.delayMs ?? 1200;

  const byId = new Map<string, Listing>();
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://www.nekretnine.rs/prodaja-stanova/novi-sad/?pag=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "sr" } });
    } catch {
      break;
    }
    if (!res.ok) break;

    const data = nextData(await res.text());
    const state = data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data;
    const results = state?.results;
    if (!Array.isArray(results) || !results.length) break;

    let added = 0;
    for (const it of results) {
      const re = it.realEstate ?? {};
      const prop = (re.properties ?? [{}])[0] ?? {};
      const loc = prop.location ?? {};
      const adv = re.advertiser ?? {};
      const isPrivate = !adv.agency && adv.supervisor?.type === "user";
      const urlAd: string = it.seo?.url ?? "";
      const id = String(re.id ?? urlAd);
      if (!urlAd || byId.has(id)) continue;

      const price = num(re.price?.value);
      const area = num(prop.surface);
      byId.set(id, {
        id,
        url: urlAd,
        price,
        currency: price ? "EUR" : null,
        area,
        rooms: num(prop.rooms),
        pricePerM2: price && area ? Math.round(price / area) : null,
        location: deburr(String(loc.microzone ?? loc.macrozone ?? "")).replace(/\s+/g, "-"),
        portal: "nekretnine.rs",
        seller: isPrivate ? "owner" : "agency",
      });
      added++;
    }

    const maxP = num(state.maxPages);
    if (maxP && page >= maxP) break;
    if (!added) break;
    if (page < maxPages) await sleep(delayMs);
  }
  return [...byId.values()];
}
