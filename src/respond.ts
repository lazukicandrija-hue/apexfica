// Mozak bota: tekst poruke -> (komande / CRM / parse) -> 4zida -> formatiran odgovor.
// + ručno praćenje (/prati) i auto-praćenje HOT/MED kupaca (/auto) sa alarmima za NOVE oglase.
import type { Criteria, Listing } from "./types.ts";
import type { Buyer } from "./crm.ts";
import { getBuyers } from "./crm.ts";
import { resolveBuyerCriteria, criteriaFromText } from "./resolve.ts";
import { searchAllPortals, confirmOwners } from "./portals/index.ts";
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
  getBuyerMonitor,
  saveBuyerMonitor,
} from "./store.ts";

type Send = (chatId: number, text: string) => Promise<void>;

const HELP = `👋 Ja sam Fica. Tražim stanove na 4zida.

🔎 Slobodna pretraga: "dvosoban Liman do 130k" · "stan 50-60m2 centar do 120000, ne Telep"
👤 Po kupcu: "za Smiljka" · /kupac Smiljka · /kupci

🤖 Auto-praćenje HOT/MED kupaca:
   /auto on — Fica sam prati sve hot/med kupce i javlja OVDE čim iskoči novo
   /auto off · /auto (status)

🔔 Ručno praćenje:
   /prati Smiljka · /prati dvosoban centar 130000-150000 · /pratnje · /prekini w1

⚙️ /podesavanja · /podesi tolerancija 10 · /podesi rezultata 12 · /podesi dubina 25
📝 /predlog <ideja> · /predlozi`;

function fmtCriteria(c: Criteria): string {
  const p: string[] = [];
  const locs = c.locations?.length ? c.locations.join(", ") : c.location;
  if (locs) p.push(`📍 ${locs}`);
  if (c.excludeLocations?.length) p.push(`⛔ ${c.excludeLocations.join(", ")}`);
  if (c.priceMin != null || c.priceMax != null) p.push(`💶 ${c.priceMin ?? 0}–${c.priceMax ?? "∞"}€`);
  if (c.areaMin != null || c.areaMax != null) p.push(`📐 ${c.areaMin ?? 0}–${c.areaMax ?? "∞"}m²`);
  if (c.roomsMin != null) p.push(`🚪 ${c.roomsMin}${c.roomsMax && c.roomsMax !== c.roomsMin ? "–" + c.roomsMax : ""} sob`);
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
• auto-praćenje HOT/MED: ${s.autoChatId ? "uključeno" : "isključeno"}

Promena: /podesi tolerancija 10 · /podesi rezultata 12 · /podesi dubina 25`;
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

async function resolveTarget(arg: string): Promise<{ criteria: Criteria; label: string }> {
  const buyers = await getBuyers({ status: "Aktivan" }).catch(() => []);
  const b = buyers.find((x) => `${x.first_name} ${x.last_name}`.toLowerCase().includes(arg.toLowerCase()));
  if (b) return { criteria: await resolveBuyerCriteria(b), label: `${b.first_name} ${b.last_name}` };
  return { criteria: await criteriaFromText(arg), label: arg };
}

async function handleWatch(t: string, chatId?: number): Promise<string | null> {
  const add = t.match(/^\/prati\s+(.+)/is);
  if (add) {
    if (chatId == null) return "Ne mogu da postavim praćenje (nedostaje chat).";
    const { criteria, label } = await resolveTarget(add[1].trim());
    criteria.priceTolerance = getSettings().priceTolerance;
    const all = await searchAllPortals({ maxPages: getSettings().maxPages });
    const current = matchListings(all, criteria);
    const w = addWatch({ label, chatId, criteria, seen: current.map((m) => m.id) });
    return `🔔 Pratim "${label}" (${fmtCriteria(criteria)}).
Trenutno aktivnih: ${current.length} (njih ne brojim kao nove). Javiću čim iskoči NOV oglas.
ID: ${w.id} — zaustavi sa /prekini ${w.id}`;
  }
  if (/^\/pratnje\b/i.test(t)) {
    const ws = getWatches();
    return ws.length
      ? "🔔 Aktivna praćenja:\n" + ws.map((w) => `• ${w.id}: ${w.label} (${fmtCriteria(w.criteria)})`).join("\n") + "\n\nStop: /prekini <id>"
      : "Nema ručnih praćenja. Dodaj: /prati <kupac ili opis>";
  }
  const stop = t.match(/^\/prekini\s+(\w+)/i);
  if (stop) {
    return removeWatch(stop[1]) ? `✅ Praćenje ${stop[1]} zaustavljeno.` : `Nema praćenja "${stop[1]}". /pratnje za listu.`;
  }
  return null;
}

// ── Auto-praćenje HOT/MED kupaca ──
function buyerText(b: Buyer): string {
  return [b.location, b.notes, b.desired_rooms, b.preferred_locations, b.budget].join("|");
}

async function activeHotMed(): Promise<Buyer[]> {
  const buyers = await getBuyers({ status: "Aktivan" }).catch(() => []);
  return buyers.filter((b) => ["hot", "medium"].includes(String(b.priority ?? "").toLowerCase()));
}

// Inicijalno "zapamti zatečeno" za sve hot/med kupce — bez slanja.
async function baselineBuyers(): Promise<number> {
  const buyers = await activeHotMed();
  const all = await searchAllPortals({ maxPages: getSettings().maxPages });
  const tol = getSettings().priceTolerance;
  const monitor = getBuyerMonitor();
  for (const b of buyers) {
    const criteria = await resolveBuyerCriteria(b);
    criteria.priceTolerance = tol;
    monitor[b.id] = { text: buyerText(b), criteria, seen: matchListings(all, criteria).map((m) => m.id) };
  }
  const ids = new Set(buyers.map((b) => b.id));
  for (const id of Object.keys(monitor)) if (!ids.has(id)) delete monitor[id];
  saveBuyerMonitor(monitor);
  return buyers.length;
}

async function handleAuto(t: string, chatId?: number): Promise<string | null> {
  const m = t.match(/^\/auto\b\s*(\w+)?/i);
  if (!m) return null;
  const arg = (m[1] ?? "").toLowerCase();
  if (arg === "on") {
    if (chatId == null) return "Ne mogu (nedostaje chat).";
    setSetting("autoChatId", chatId);
    const n = await baselineBuyers();
    return `✅ Auto-praćenje uključeno. Pratim ${n} HOT/MED kupaca; alarmi stižu OVDE. Javiću za svaki NOV oglas (zatečene ne brojim kao nove).`;
  }
  if (arg === "off") {
    setSetting("autoChatId", 0);
    return "Auto-praćenje HOT/MED kupaca isključeno.";
  }
  const cur = getSettings().autoChatId;
  return cur
    ? "Auto-praćenje je UKLJUČENO. /auto off da isključiš."
    : "Auto-praćenje je isključeno. /auto on da uključiš (alarmi stižu u chat gde to ukucaš).";
}

// Pozadinski prolaz kroz hot/med kupce — pošalji samo NOVE oglase.
async function buyerCycle(all: Listing[], chatId: number, send: Send, silent: boolean): Promise<void> {
  const buyers = await activeHotMed();
  const tol = getSettings().priceTolerance;
  const monitor = getBuyerMonitor();
  for (const b of buyers) {
    let entry = monitor[b.id];
    const changed = !entry || entry.text !== buyerText(b);
    if (changed) {
      // nov kupac ili promenjeni kriterijumi → re-parsiraj (Haiku)
      const criteria = await resolveBuyerCriteria(b);
      criteria.priceTolerance = tol;
      entry = { text: buyerText(b), criteria, seen: [] };
    }
    entry.criteria.priceTolerance = tol;
    const matches = matchListings(all, entry.criteria);
    if (silent || changed) {
      entry.seen = matches.map((m) => m.id); // samo baseline, bez slanja
    } else {
      const freshAll = matches.filter((m) => !entry.seen.includes(m.id));
      const fresh = await confirmOwners(freshAll); // proveri 4zida vlasnike samo na novim
      for (const m of fresh.slice(0, 10)) {
        await send(chatId, `🔔 NOVO za kupca ${b.first_name} ${b.last_name} (${String(b.priority ?? "").toUpperCase()})\n${fmtListing(m)}`);
      }
      if (freshAll.length) entry.seen = [...entry.seen, ...freshAll.map((m) => m.id)].slice(-300);
    }
    monitor[b.id] = entry;
  }
  const ids = new Set(buyers.map((b) => b.id));
  for (const id of Object.keys(monitor)) if (!ids.has(id)) delete monitor[id];
  saveBuyerMonitor(monitor);
}

export async function handleText(text: string, user?: string, chatId?: number): Promise<string> {
  const t = text.trim();
  if (!t || /^\/(start|help)\b/i.test(t)) return HELP;

  const settingsReply = handleSettings(t);
  if (settingsReply) return settingsReply;

  const autoReply = await handleAuto(t, chatId);
  if (autoReply) return autoReply;

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
    return `👥 Aktivnih kupaca: ${buyers.length}\n` + buyers.slice(0, 40).map((b) => `• ${b.first_name} ${b.last_name}`).join("\n");
  }

  let criteria: Criteria;
  let who: string;
  const byBuyer = t.match(/^(?:\/kupac\s+|za\s+)(.+)/i);
  if (byBuyer) {
    const r = await resolveTarget(byBuyer[1].trim());
    criteria = r.criteria;
    who = r.label;
  } else {
    criteria = await criteriaFromText(t);
    who = "Slobodna pretraga";
  }

  const s = getSettings();
  criteria.priceTolerance = s.priceTolerance;
  const all = await searchAllPortals({ maxPages: s.maxPages });
  const matches = await confirmOwners(matchListings(all, criteria));
  if (!matches.length) logEmpty(who, t, criteria);
  return formatReply(who, criteria, all.length, matches, s.resultCount);
}

// Pozadinska provera: ručna praćenja + auto HOT/MED kupci. Šalje samo NOVE oglase.
let primed = false;

export async function runWatchCycle(send: Send): Promise<void> {
  const watches = getWatches();
  const auto = getSettings().autoChatId;
  if (!watches.length && !auto) return;
  const all = await searchAllPortals({ maxPages: getSettings().maxPages });

  // Prvi prolaz po startu (npr. posle deploy-a / promene skupa portala):
  // samo "zapamti zatečeno", bez slanja — da ne zatrpa alarmima.
  const silent = !primed;
  primed = true;

  for (const w of watches) {
    const matches = matchListings(all, w.criteria);
    if (silent) {
      updateWatchSeen(w.id, matches.map((m) => m.id));
      continue;
    }
    const freshAll = matches.filter((m) => !w.seen.includes(m.id));
    if (!freshAll.length) continue;
    const fresh = await confirmOwners(freshAll);
    for (const m of fresh.slice(0, 10)) await send(w.chatId, `🔔 NOVO za "${w.label}"\n${fmtListing(m)}`);
    updateWatchSeen(w.id, [...w.seen, ...freshAll.map((m) => m.id)]);
  }

  if (auto) await buyerCycle(all, auto, send, silent);
}
