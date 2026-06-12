// CLI za brzi test: daš filtere -> Fica pretraži 4zida -> ispiše poklapanja.
// Primeri:
//   npm run search -- --m2 50-60 --price 100000-120000
//   npm run search -- --location centar --m2 50-65 --price 100000-130000 --rooms 2
import type { Criteria } from "./types.ts";
import { searchFourZida } from "./portals/fourzida.ts";
import { matchListings } from "./match.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// "100000-120000" -> [100000, 120000] ; "50" -> [50, 50]
function range(v: string | undefined): [number | undefined, number | undefined] {
  if (!v) return [undefined, undefined];
  if (v.includes("-")) {
    const [a, b] = v.split("-");
    return [a ? Number(a) : undefined, b ? Number(b) : undefined];
  }
  const n = Number(v);
  return [n, n];
}

const [priceMin, priceMax] = range(arg("price"));
const [areaMin, areaMax] = range(arg("m2"));
const [roomsMin, roomsMax] = range(arg("rooms"));
const tol = arg("tolerance");

const criteria: Criteria = {
  location: arg("location"),
  priceMin,
  priceMax,
  areaMin,
  areaMax,
  roomsMin,
  roomsMax,
  priceTolerance: tol ? Number(tol) : undefined,
};

const maxPages = arg("max-pages") ? Number(arg("max-pages")) : 10;

console.log("🔎 Kriterijumi:", JSON.stringify(criteria));
console.log("   (skupljam oglase sa 4zida — Novi Sad...)\n");

const all = await searchFourZida({
  maxPages,
  onPage: (p, t) => console.log(`   strana ${p} ... ukupno ${t} oglasa`),
});

const matches = matchListings(all, criteria);

console.log(`\n📦 Skupljeno ${all.length} oglasa | ✅ ${matches.length} poklapanja:\n`);
for (const m of matches) {
  const price =
    m.price != null ? `${m.price.toLocaleString("sr-RS")} ${m.currency ?? ""}`.trim() : "—";
  const area = m.area != null ? `${m.area} m²` : "—";
  const rooms = m.rooms != null ? `${m.rooms} soba` : "—";
  const ppm = m.pricePerM2 != null ? `${m.pricePerM2} €/m²` : "—";
  console.log(`  • ${price} | ${area} | ${rooms} | ${ppm}`);
  console.log(`    ${m.url}`);
}
if (matches.length === 0) {
  console.log("  (nema poklapanja za zadate filtere — probaj šire opsege)");
}
