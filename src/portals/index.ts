// Skupljač: skuplja sa svih portala paralelno, primeni "samo vlasnik", izbaci duplikate.
import type { Listing } from "../types.ts";
import { searchFourZida, getFourZidaSeller } from "./fourzida.ts";
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
  // Redosled: portali sa poznatim vlasnikom prvi → kod duplikata oni pobeđuju.
  const settled = await Promise.allSettled([
    searchOglasi({ ownerOnly, maxPages: portalMax }),
    searchNekretnine({ maxPages: portalMax }),
    searchFourZida({ maxPages }),
  ]);

  let all: Listing[] = [];
  for (const r of settled) if (r.status === "fulfilled") all = all.concat(r.value);

  // "samo vlasnik": izbaci poznate agencijske; 4zida (nepoznato) se proverava kasnije (confirmOwners)
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

// Potvrdi vlasnike za 4zida oglase (proverom detaljne strane) i izbaci agencije.
// Poziva se SAMO na mali skup (rezultati za prikaz / novi oglasi) — i keširano.
export async function confirmOwners(listings: Listing[], cap = 30): Promise<Listing[]> {
  const out: Listing[] = [];
  let checks = 0;
  for (const l of listings) {
    if (l.portal === "4zida" && l.seller == null) {
      if (checks >= cap) continue; // preko limita → ne možemo potvrditi vlasnika → izbaci
      checks++;
      l.seller = await getFourZidaSeller(l.url);
      if (l.seller !== "owner") continue; // provereno: agencija/novogradnja/greška → izbaci
      out.push(l);
      continue;
    }
    if (l.seller !== "agency") out.push(l); // vlasnik (oglasi/nekretnine)
  }
  return out;
}
