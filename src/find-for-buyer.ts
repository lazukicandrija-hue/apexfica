// End-to-end: pročitaj kupca iz CRM-a -> kriterijumi -> pretraži 4zida -> poklapanja.
// Pokretanje:
//   npm run find -- --buyer "Marko"        (traži po imenu/prezimenu)
//   npm run find -- --id <uuid>            (tačan kupac)
//   npm run find                           (prvi aktivni kupac)
import { getBuyers } from "./crm.ts";
import { buyerToCriteria } from "./buyer-criteria.ts";
import { searchFourZida } from "./portals/fourzida.ts";
import { matchListings } from "./match.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const idArg = arg("id");
const nameArg = arg("buyer");
const maxPages = arg("max-pages") ? Number(arg("max-pages")) : 12;

const buyers = await getBuyers({ status: "Aktivan" });
console.log(`👥 Aktivnih kupaca u CRM-u: ${buyers.length}`);

let buyer =
  buyers.find(
    (b) =>
      (idArg && b.id === idArg) ||
      (nameArg && `${b.first_name} ${b.last_name}`.toLowerCase().includes(nameArg.toLowerCase())),
  ) ?? (!idArg && !nameArg ? buyers[0] : undefined);

if (!buyer) {
  console.log("Nije nađen kupac (probaj: --buyer Ime  ili  --id <uuid>).");
  process.exit(0);
}

const criteria = buyerToCriteria(buyer);
console.log(
  `\n🧑 ${buyer.first_name} ${buyer.last_name} | tip=${buyer.desired_type ?? "—"} | sobnost=${buyer.desired_rooms ?? "—"} | budžet=${buyer.budget ?? "—"} | lok=${buyer.location ?? buyer.preferred_locations ?? "—"}`,
);
console.log(`   napomene: ${buyer.notes ?? "—"}`);
console.log(`🔎 Kriterijumi: ${JSON.stringify(criteria)}\n`);

const all = await searchFourZida({
  maxPages,
  onPage: (p, t) => console.log(`   strana ${p} ... ${t} oglasa`),
});
const matches = matchListings(all, criteria);

console.log(`\n📦 ${all.length} oglasa | ✅ ${matches.length} poklapanja:\n`);
for (const m of matches.slice(0, 20)) {
  const price =
    m.price != null ? `${m.price.toLocaleString("sr-RS")} ${m.currency ?? ""}`.trim() : "—";
  console.log(
    `  • ${price} | ${m.area ?? "—"} m² | ${m.rooms ?? "—"} soba | ${m.pricePerM2 ?? "—"} €/m²\n    ${m.url}`,
  );
}
if (!matches.length) {
  console.log("  (nema poklapanja — verovatno treba ublažiti kriterijume ili proširiti kvart)");
}
