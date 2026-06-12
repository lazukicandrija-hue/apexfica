// Mozak bota: tekst poruke -> (komande / CRM / parse) -> 4zida -> formatiran odgovor.
// Plus aktivno praćenje (watches): runWatchCycle() proverava i šalje NOVE oglase.
import type { Criteria, Listing } from "./types.ts";
import { getBuyers } from "./crm.ts";
import { resolveBuyerCriteria, criteriaFromText } from "./resolve.ts";
import { searchFourZida } from "./portals/fourzida.ts";
import { matchListings } from "./match.ts";
import {
  getSettings,
  setSetting,
  addSuggestion,
  listSuggestions,
  logEmpty,
  getWatches,
  addWatch,
  removeWatch,
  updateWatchSeen,
} from "./store.ts";

const HELP = `👋 Ja sam Fica. Tražim stanove na 4zida.

🔎 Slobodna pretraga — opiši šta tražiš:
   "dvosoban Liman do 130k"
   "stan 50-60m2 centar, budžet 120000, ne Telep"

👤 Po kupcu iz CRM-a:
   "za Smiljka"  ·  /kupac Smiljka  ·  /kupci (lista)

🔔 Aktivno praćenje (javim čim iskoči NOV oglas):
   /prati Smiljka — prati kupca iz CRM-a
   /prati dvosoban centar 130000-150000 — slobodno
   /pratnje (lista)  ·  /prekini w1 (stop)

⚙️ Podešavanja:
   /podesavanja  ·  /podesi tolerancija 10  ·  /podesi rezultata 12  ·  /podesi dubina 25

📝 Predlozi:
   /predlog <šta bi voleo da Fica radi>  ·  /predlozi`;

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

function fmtListing(m: Listing): string {
  const price = m.price != null ? `${m.price.toLocaleString("sr-RS")}€` : "—";
  return `${price} · ${m.area ?? "—"}m² · ${m.rooms ?? "—"} sob · ${m.pricePerM2 ?? "—"}€/m²\n${m.url}`;
}

function formatReply(who: string, c: Criteria, poolSize: number, matches: Listing[], n: number): string {
  const head = `🏠 ${who}\n${fmtCriteria(c)}\n\n✅ ${matches.length} poklapanja (od ${poolSize} pregledanih):`;
  const lines = matches.slice(0, n).map((m, i) => `\n\n${i + 1}. ${fmtListing(m)}`);
  let msg = head + lines.join("");
  if (matches.length > n) msg += `\n\n…i još ${matches.length - n}. Suzi kriterijume za precizniju listu.`;
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
   /podesi tolerancija 10  ·  /podesi rezultata 12  ·  /podesi dubina 25`;
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

// Pretvori argument (ime kupca ili slobodan tekst) u kriterijume + labelu.
async function resolveTarget(arg: string): Promise<{ criteria: Criteria; label: string }> {
  const buyers = await getBuyers({ status: "Aktivan" }).catch(() => []);
  const b = buyers.find((x) =>
    `${x.first_name} ${x.last_name}`.toLowerCase().includes(arg.toLowerCase()),
  );
  if (b) return { criteria: await resolveBuyerCriteria(b), label: `${b.first_name} ${b.last_name}` };
  return { criteria: await criteriaFromText(arg), label: arg };
}

async function handleWatch(t: string, chatId?: number): Promise<string | null> {
  // /prati <kupac ili tekst>
  const add = t.match(/^\/prati\s+(.+)/is);
  if (add) {
    if (chatId == null) return "Ne mogu da postavim praćenje (nedostaje chat).";
    const { criteria, label } = await resolveTarget(add[1].trim());
    criteria.priceTolerance = getSettings().priceTolerance;
    const all = await searchFourZida({ maxPages: getSettings().maxPages });
    const current = matchListings(all, criteria);
    const w = addWatch({ label, chatId, criteria, seen: current.map((m) => m.id) });
    return `🔔 Pratim "${label}" (${fmtCriteria(criteria)}).
Trenutno aktivnih: ${current.length} (njih ne brojim kao nove). Javiću čim iskoči NOV oglas.
ID: ${w.id} — zaustavi sa /prekini ${w.id}`;
  }
  if (/^\/pratnje\b/i.test(t)) {
    const ws = getWatches();
    return ws.length
      ? "🔔 Aktivna praćenja:\n" +
          ws.map((w) => `• ${w.id}: ${w.label} (${fmtCriteria(w.criteria)})`).join("\n") +
          "\n\nStop: /prekini <id>"
      : "Nema aktivnih praćenja. Dodaj sa: /prati <kupac ili opis>";
  }
  const stop = t.match(/^\/prekini\s+(\w+)/i);
  if (stop) {
    return removeWatch(stop[1])
      ? `✅ Praćenje ${stop[1]} zaustavljeno.`
      : `Nema praćenja "${stop[1]}". /pratnje za listu.`;
  }
  return null;
}

export async function handleText(text: string, user?: string, chatId?: number): Promise<string> {
  const t = text.trim();
  if (!t || /^\/(start|help)\b/i.test(t)) return HELP;

  const settingsReply = handleSettings(t);
  if (settingsReply) return settingsReply;

  const watchReply = await handleWatch(t, chatId);
  if (watchReply) return watchReply;

  const sug = t.match(/^\/predlog\s+([\s\S]+)/i);
  if (sug) {
    addSuggestion(user ?? "?", sug[1].trim());
    return "📝 Zabeleženo, hvala! Predlog je sačuvan.";
  }
  if (/^\/predlozi\b/i.test(t)) {
    const list = listSuggestions(20);
    return list.length ? "📋 Predlozi:\n" + list.join("\n") : "Nema zabeleženih predloga još.";
  }

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
    const { criteria: c, label } = await resolveTarget(byBuyer[1].trim());
    criteria = c;
    who = label;
  } else {
    criteria = await criteriaFromText(t);
    who = "Slobodna pretraga";
  }

  const s = getSettings();
  criteria.priceTolerance = s.priceTolerance;
  const all = await searchFourZida({ maxPages: s.maxPages });
  const matches = matchListings(all, criteria);
  if (!matches.length) logEmpty(who, t, criteria);
  return formatReply(who, criteria, all.length, matches, s.resultCount);
}

// Pozadinska provera svih praćenja: pošalji samo NOVE oglase (preko `send`).
export async function runWatchCycle(
  send: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  const watches = getWatches();
  if (!watches.length) return;
  const all = await searchFourZida({ maxPages: getSettings().maxPages }); // keš: jedan obilazak za sve
  for (const w of watches) {
    const matches = matchListings(all, w.criteria);
    const fresh = matches.filter((m) => !w.seen.includes(m.id));
    if (!fresh.length) continue;
    for (const m of fresh.slice(0, 10)) {
      await send(w.chatId, `🔔 NOVO za "${w.label}"\n${fmtListing(m)}`);
    }
    updateWatchSeen(w.id, [...w.seen, ...fresh.map((m) => m.id)]);
  }
}
