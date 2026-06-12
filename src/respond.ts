// Mozak bota: tekst poruke -> (komande / CRM / parse) -> 4zida -> formatiran odgovor.
import type { Criteria, Listing } from "./types.ts";
import { getBuyers } from "./crm.ts";
import { resolveBuyerCriteria, criteriaFromText } from "./resolve.ts";
import { searchFourZida } from "./portals/fourzida.ts";
import { matchListings } from "./match.ts";
import { getSettings, setSetting, addSuggestion, listSuggestions, logEmpty } from "./store.ts";

const HELP = `👋 Ja sam Fica. Tražim stanove na 4zida.

🔎 Slobodna pretraga — opiši šta tražiš:
   "dvosoban Liman do 130k"
   "stan 50-60m2 centar, budžet 120000, ne Telep"

👤 Po kupcu iz CRM-a:
   "za Smiljka"  ·  /kupac Smiljka  ·  /kupci (lista)

⚙️ Podešavanja (menjaš sam):
   /podesavanja — prikaži trenutna
   /podesi tolerancija 10 — dozvoli +10% preko budžeta
   /podesi rezultata 12  ·  /podesi dubina 25

📝 Predlozi:
   /predlog <šta bi voleo da Fica radi>
   /predlozi — lista zabeleženih`;

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

function formatReply(
  who: string,
  c: Criteria,
  poolSize: number,
  matches: Listing[],
  resultCount: number,
): string {
  const head = `🏠 ${who}\n${fmtCriteria(c)}\n\n✅ ${matches.length} poklapanja (od ${poolSize} pregledanih):`;
  const lines = matches.slice(0, resultCount).map((m, i) => {
    const price = m.price != null ? `${m.price.toLocaleString("sr-RS")}€` : "—";
    return `\n\n${i + 1}. ${price} · ${m.area ?? "—"}m² · ${m.rooms ?? "—"} sob · ${m.pricePerM2 ?? "—"}€/m²\n${m.url}`;
  });
  let msg = head + lines.join("");
  if (matches.length > resultCount)
    msg += `\n\n…i još ${matches.length - resultCount}. Suzi kriterijume za precizniju listu.`;
  if (!matches.length) msg += `\n(nema pogodaka — probaj šire opsege ili drugi kvart)`;
  return msg.slice(0, 4000);
}

function handleSettings(t: string): string | null {
  if (/^\/podesavanja\b/i.test(t)) {
    const s = getSettings();
    return `⚙️ Trenutna podešavanja:
• tolerancija budžeta: +${Math.round(s.priceTolerance * 100)}%
• broj rezultata: ${s.resultCount}
• dubina pretrage: ${s.maxPages} strana

Promena: /podesi <ime> <broj>
   /podesi tolerancija 10
   /podesi rezultata 12
   /podesi dubina 25`;
  }
  const m = t.match(/^\/podesi\s+(\w+)\s+(\d+)/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const val = Number(m[2]);
  if (key.startsWith("toleranc")) {
    const pct = Math.min(val, 100);
    setSetting("priceTolerance", pct / 100);
    return `✅ Tolerancija budžeta: +${pct}%`;
  }
  if (key.startsWith("rezultat")) {
    const n = Math.max(1, Math.min(val, 30));
    setSetting("resultCount", n);
    return `✅ Broj rezultata: ${n}`;
  }
  if (key.startsWith("dubin")) {
    const n = Math.max(1, Math.min(val, 40));
    setSetting("maxPages", n);
    return `✅ Dubina pretrage: ${n} strana`;
  }
  return `Ne znam podešavanje "${key}". Probaj: tolerancija, rezultata, dubina.`;
}

export async function handleText(text: string, user?: string): Promise<string> {
  const t = text.trim();
  if (!t || /^\/(start|help)\b/i.test(t)) return HELP;

  // ⚙️ podešavanja
  const settingsReply = handleSettings(t);
  if (settingsReply) return settingsReply;

  // 📝 predlozi
  const sug = t.match(/^\/predlog\s+([\s\S]+)/i);
  if (sug) {
    addSuggestion(user ?? "?", sug[1].trim());
    return "📝 Zabeleženo, hvala! Predlog je sačuvan.";
  }
  if (/^\/predlozi\b/i.test(t)) {
    const list = listSuggestions(20);
    return list.length ? "📋 Predlozi:\n" + list.join("\n") : "Nema zabeleženih predloga još.";
  }

  // 👥 lista kupaca
  if (/^\/kupci\b/i.test(t)) {
    const buyers = await getBuyers({ status: "Aktivan" });
    return (
      `👥 Aktivnih kupaca: ${buyers.length}\n` +
      buyers.slice(0, 40).map((b) => `• ${b.first_name} ${b.last_name}`).join("\n")
    );
  }

  // sastavi kriterijume
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

  // primeni podešavanja
  const s = getSettings();
  criteria.priceTolerance = s.priceTolerance;
  const all = await searchFourZida({ maxPages: s.maxPages });
  const matches = matchListings(all, criteria);
  if (!matches.length) logEmpty(who, t, criteria);
  return formatReply(who, criteria, all.length, matches, s.resultCount);
}
