// Filtriranje oglasa po kriterijumima kupca.
import type { Criteria, Listing } from "./types.ts";

// 4zida je primarni portal → prvi; pa oglasi.rs, pa nekretnine.rs.
function portalRank(p: string): number {
  return p === "4zida" ? 0 : p === "oglasi.rs" ? 1 : p === "nekretnine.rs" ? 2 : 3;
}

// Vraća oglase koji odgovaraju kriterijumima — sortirane: 4zida prvi, pa po ceni rastuće.
export function matchListings(listings: Listing[], c: Criteria): Listing[] {
  const effectiveMax =
    c.priceMax != null ? c.priceMax * (1 + (c.priceTolerance ?? 0)) : null;

  return listings
    .filter((l) => {
      const wantLocs = c.locations?.length ? c.locations : c.location ? [c.location] : [];
      if (wantLocs.length) {
        const slug = l.location.toLowerCase();
        if (!wantLocs.some((x) => slug.includes(x.toLowerCase()))) return false;
      }
      if (c.excludeLocations?.length) {
        const slug = l.location.toLowerCase();
        if (c.excludeLocations.some((x) => slug.includes(x.toLowerCase()))) return false;
      }
      if (c.priceMin != null && (l.price == null || l.price < c.priceMin)) return false;
      if (effectiveMax != null && (l.price == null || l.price > effectiveMax)) return false;
      if (c.areaMin != null && (l.area == null || l.area < c.areaMin)) return false;
      if (c.areaMax != null && (l.area == null || l.area > c.areaMax)) return false;
      if (c.roomsMin != null && (l.rooms == null || l.rooms < c.roomsMin)) return false;
      if (c.roomsMax != null && (l.rooms == null || l.rooms > c.roomsMax)) return false;
      return true;
    })
    .sort(
      (a, b) =>
        portalRank(a.portal) - portalRank(b.portal) ||
        (a.price ?? Infinity) - (b.price ?? Infinity),
    );
}
