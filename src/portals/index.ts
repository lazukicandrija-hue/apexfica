// Skupljač: skuplja sa svih portala paralelno, primeni "samo vlasnik", izbaci duplikate.
import type { Listing } from "../types.ts";
import { searchFourZida } from "./fourzida.ts";
import { searchOglasi } from "./oglasi.ts";
import { searchNekretnine } from "./nekretnine.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: Listing[] }>();

export type AggOptions = { ownerOnly?: boolean; maxPages?: number };

export async function searchAllPortals(opts: AggOptions = {}): Promise<Listing[]> {
  const ownerOnly = opts.ownerOnly ?? true; // Isak: samo vlasnički oglasi
  const maxPages = opts.maxPages ?? 18;

  const key = `${ownerOnly}:${maxPages}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const portalMax = Math.min(maxPages, 12);
  const settled = await Promise.allSettled([
    searchFourZida({ maxPages }),
    searchOglasi({ ownerOnly, maxPages: portalMax }),
    searchNekretnine({ maxPages: portalMax }),
  ]);

  let all: Listing[] = [];
  for (const r of settled) if (r.status === "fulfilled") all = all.concat(r.value);

  // "samo vlasnik": izbaci poznate agencijske; nepoznato (4zida) zadrži (best-effort)
  if (ownerOnly) all = all.filter((l) => l.seller !== "agency");

  // dedup preko portala: isti stan (kvadratura + sobe + cena) = jedna stavka
  const seen = new Set<string>();
  const out: Listing[] = [];
  for (const l of all) {
    const k = `${l.area ?? "?"}|${l.rooms ?? "?"}|${l.price ?? "?"}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }

  cache.set(key, { at: Date.now(), data: out });
  return out;
}
