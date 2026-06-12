// Mozak bota: tekst poruke -> (CRM/parse) -> 4zida -> formatiran odgovor.
import type { Criteria, Listing } from "./types.ts";
import { getBuyers } from "./crm.ts";
import { resolveBuyerCriteria, criteriaFromText } from "./resolve.ts";
import { searchFourZida } from "./portals/fourzida.ts";
import { matchListings } from "./match.ts";

const HELP = `👋 Ja sam Fica. Mogu da tražim stanove na 4zida.

• Slobodna pretraga — samo opiši šta tražiš:
   "dvosoban Liman do 130k"
   "stan 50-60m2 centar, budžet 120000, ne Telep"

• Po kupcu iz CRM-a:
   "za Smiljka"   ili   /kupac Smiljka

• /kupci — lista aktivnih kupaca`;

function fmtCriteria(c: Criteria): string {
  const p: string[] = [];
  if (c.location) p.push(`📍 ${c.location}`);
  if (c.excludeLocations?.length) p.push(`⛔ ${c.excludeLocations.join(", ")}`);
  if (c.priceMin != null || c.priceMax != null)
    p.push(`💶 ${c.priceMin ?? 0}–${c.priceMax ?? "∞"}€`);
  if (c.areaMin != null || c.areaMax != null)
    p.push(`📐 ${c.areaMin ?? 0}–${c.areaMax ?? "∞"}m²`);
  if (c.roomsMin != null) p.push(`🚪 ${c.roomsMin} sob`);
  return p.join(" · ") || "(bez filtera)";
}

function formatReply(who: string, c: Criteria, poolSize: number, matches: Listing[]): string {
  const head = `🏠 ${who}\n${fmtCriteria(c)}\n\n✅ ${matches.length} poklapanja (od ${poolSize} pregledanih):`;
  const lines = matches.slice(0, 8).map((m, i) => {
    const price = m.price != null ? `${m.price.toLocaleString("sr-RS")}€` : "—";
    return `\n\n${i + 1}. ${price} · ${m.area ?? "—"}m² · ${m.rooms ?? "—"} sob · ${m.pricePerM2 ?? "—"}€/m²\n${m.url}`;
  });
  let msg = head + lines.join("");
  if (matches.length > 8) msg += `\n\n…i još ${matches.length - 8}. Suzi kriterijume za precizniju listu.`;
  if (!matches.length) msg += `\n(nema pogodaka — probaj šire opsege ili drugi kvart)`;
  return msg.slice(0, 4000);
}

export async function handleText(text: string): Promise<string> {
  const t = text.trim();
  if (!t || /^\/(start|help)\b/i.test(t)) return HELP;

  if (/^\/kupci\b/i.test(t)) {
    const buyers = await getBuyers({ status: "Aktivan" });
    return (
      `👥 Aktivnih kupaca: ${buyers.length}\n` +
      buyers.slice(0, 40).map((b) => `• ${b.first_name} ${b.last_name}`).join("\n")
    );
  }

  let criteria: Criteria;
  let who: string;

  const byBuyer = t.match(/^(?:\/kupac\s+|za\s+)(.+)/i);
  if (byBuyer) {
    const name = byBuyer[1].trim();
    const buyers = await getBuyers({ status: "Aktivan" });
    const b = buyers.find((x) =>
      `${x.first_name} ${x.last_name}`.toLowerCase().includes(name.toLowerCase()),
    );
    if (!b) return `Ne nađoh aktivnog kupca "${name}". Probaj /kupci za listu.`;
    criteria = await resolveBuyerCriteria(b);
    who = `${b.first_name} ${b.last_name}`;
  } else {
    criteria = await criteriaFromText(t);
    who = "Slobodna pretraga";
  }

  const all = await searchFourZida({ maxPages: 18 });
  const matches = matchListings(all, criteria);
  return formatReply(who, criteria, all.length, matches);
}
