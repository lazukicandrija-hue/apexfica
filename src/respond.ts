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
  getNoviSeen,
  setNoviSeen,
  getAllowedExtra,
  addAllowed,
  removeAllowed,
  getAutoAgents,
  setAutoAgent,
  removeAutoAgent,
} from "./store.ts";

type Send = (chatId: number, text: string) => Promise<void>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const HELP = `👋 Ja sam Fica. Tražim stanove na 4zida.

🔎 Slobodna pretraga: "dvosoban Liman do 130k" · "stan 50-60m2 centar do 120000, ne Telep"
👤 Po kupcu: "za Smiljka" · /kupac Smiljka · /kupci

🤖 Auto-praćenje kupaca (šalje stanove po parametrima kupca):
   /agent <ime tvog kupca> — dobijaj SAMO svoje kupce (npr. /agent Danka)
   /agent svi — admin: dobijaj SVE kupce (i tuđe)
   /auto (status) · /auto off

🆕 Najnoviji vlasnički oglasi (feed):
   /novi on — šalji svaki NOV vlasnički oglas (sa svih portala) · /novi off · /novi

🔔 Ručno praćenje:
   /prati Smiljka · /prati dvosoban centar 130000-150000 · /pratnje · /prekini w1

⚙️ /podesavanja · /podesi tolerancija 10 · /podesi rezultata 12 · /podesi dubina 25
📝 /predlog <ideja> · /predlozi
👥 Pristup: /dodaj @username · /ukloni @username · /korisnici`;

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

// Vraća SVE pogotke, podeljene u više poruka (Telegram limit ~4096 znakova).
// Max oglasa po jednoj pretrazi — zaštita od poplave/zaglavljivanja (npr. preširoki kriterijumi).
const SEARCH_CAP = 60;

function formatReplies(who: string, c: Criteria, poolSize: number, matches: Listing[]): string[] {
  const extra = matches.length - SEARCH_CAP;
  const shown = matches.slice(0, SEARCH_CAP);
  const head =
    `🏠 ${who}\n${fmtCriteria(c)}\n\n✅ ${matches.length} poklapanja (od ${poolSize} pregledanih)` +
    (extra > 0 ? `, prikazujem prvih ${SEARCH_CAP}` : "") +
    ":";
  if (!matches.length) return [head + "\n(nema pogodaka — probaj šire opsege ili drugi kvart)"];

  const chunks: string[] = [];
  let cur = head;
  shown.forEach((m, i) => {
    const line = `${i + 1}. ${fmtListing(m)}`;
    if ((cur + "\n\n" + line).length > 3900) {
      chunks.push(cur);
      cur = line;
    } else {
      cur += "\n\n" + line;
    }
  });
  chunks.push(cur);
  if (extra > 0) chunks.push(`… i još ${extra}. Suzi kriterijume (cena, kvart, sobnost ili kvadratura) za uži spisak.`);
  return chunks;
}

// Ima li pretraga bar jedan stvaran filter? Bez ovoga prazni kriterijumi poklope SVE → poplava.
function hasRealCriteria(c: Criteria): boolean {
  return (
    c.priceMin != null ||
    c.priceMax != null ||
    c.areaMin != null ||
    c.areaMax != null ||
    c.roomsMin != null ||
    c.roomsMax != null ||
    (c.locations?.length ?? 0) > 0
  );
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

// ── Auto-praćenje svih aktivnih kupaca ──
function buyerText(b: Buyer): string {
  return [b.location, b.notes, b.desired_rooms, b.preferred_locations, b.budget].join("|");
}

async function activeBuyers(): Promise<Buyer[]> {
  return await getBuyers({ status: "Aktivan" }).catch(() => []);
}

// Inicijalno "zapamti zatečeno" za sve hot/med kupce — bez slanja.
async function baselineBuyers(): Promise<number> {
  const buyers = await activeBuyers();
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

// /agent <ime kupca> → prepoznaj agenta iz tog kupca, veži ovaj chat za njega, uključi auto
async function handleAgent(t: string, chatId?: number): Promise<string | null> {
  const m = t.match(/^\/agent\s+(.+)/is);
  if (!m) return null;
  if (chatId == null) return "Ne mogu (nedostaje chat).";
  const name = m[1].trim();
  if (/^(svi|sve|all)$/i.test(name)) {
    setAutoAgent(chatId, "ALL");
    return `✅ Admin režim — pratim SVE kupce (i tvoje i tuđe), po imenu kupca.
🔔 Auto-praćenje UKLJUČENO. (isključi: /auto off)`;
  }
  const buyers = await getBuyers({ status: "Aktivan" }).catch(() => []);
  const b = buyers.find((x) => `${x.first_name} ${x.last_name}`.toLowerCase().includes(name.toLowerCase()));
  if (!b) return `Ne nađoh aktivnog kupca "${name}". Napiši ime jednog TVOG kupca iz CRM-a (npr. /agent Danka).`;
  if (!b.agent_id)
    return `Kupac ${b.first_name} ${b.last_name} nema dodeljenog agenta u CRM-u — probaj drugog svog kupca (ili se dodeli kao agent tom kupcu u CRM-u).`;
  setAutoAgent(chatId, b.agent_id);
  const mine = buyers.filter((x) => x.agent_id === b.agent_id);
  const names = mine.slice(0, 8).map((x) => `${x.first_name} ${x.last_name}`).join(", ");
  return `✅ Prepoznat si kao agent za ${mine.length} kupaca: ${names}${mine.length > 8 ? "…" : ""}.
🔔 Auto-praćenje UKLJUČENO — šaljem ti SAMO tvoje kupce, čim iskoči nov oglas. (isključi: /auto off)`;
}

// /auto — status / isključivanje (uključivanje ide preko /agent)
function handleAuto(t: string, chatId?: number): string | null {
  const m = t.match(/^\/auto\b\s*(\w+)?/i);
  if (!m) return null;
  const arg = (m[1] ?? "").toLowerCase();
  const on = chatId != null && getAutoAgents()[String(chatId)] != null;
  if (arg === "off") {
    if (chatId != null) removeAutoAgent(chatId);
    return "Auto-praćenje isključeno za ovaj chat.";
  }
  if (arg === "on") {
    if (chatId == null) return "Ne mogu (nedostaje chat).";
    setAutoAgent(chatId, "ALL");
    return `✅ Auto-praćenje UKLJUČENO — dobijaš SVE kupce i njihove nove oglase (po parametrima: cena, lokacija, sobnost, kvadratura). Za samo svoje: /agent <ime tvog kupca>.`;
  }
  return on
    ? "Auto-praćenje je UKLJUČENO — dobijaš samo svoje kupce. /auto off da isključiš."
    : "Auto-praćenje je isključeno. Uključi sa: /agent <ime tvog kupca>.";
}

// Feed "Najnoviji vlasnički oglasi" — svaki NOV vlasnički oglas (nezavisno od kupca).
async function handleNovi(t: string, chatId?: number): Promise<string | null> {
  const m = t.match(/^\/novi\b\s*(\w+)?/i);
  if (!m) return null;
  const arg = (m[1] ?? "").toLowerCase();
  if (arg === "on") {
    if (chatId == null) return "Ne mogu (nedostaje chat).";
    setSetting("noviChatId", chatId);
    return `🆕 Feed "Najnoviji vlasnički oglasi" UKLJUČEN — za koji minut ti šaljem zadnjih par vlasničkih oglasa, pa onda svaki novi čim se pojavi.`;
  }
  if (arg === "off") {
    setSetting("noviChatId", 0);
    return "Feed najnovijih oglasa isključen.";
  }
  return getSettings().noviChatId
    ? "Feed najnovijih vlasničkih oglasa je UKLJUČEN. /novi off da isključiš."
    : "Feed je isključen. /novi on da uključiš (oglasi stižu u chat gde to ukucaš).";
}

// Pozadinski prolaz kroz hot/med kupce — pošalji samo NOVE oglase.
async function buyerCycle(all: Listing[], send: Send, silent: boolean): Promise<void> {
  const autoAgents = getAutoAgents(); // {chatIdStr: agentId | "ALL"}
  const chatIds = Object.keys(autoAgents);
  if (!chatIds.length) return;

  const buyers = await activeBuyers();
  const tol = getSettings().priceTolerance;
  const monitor = getBuyerMonitor(); // {chatIdStr: {buyerId: entry}} — svaki chat prati nezavisno

  for (const chatIdStr of chatIds) {
    const scope = autoAgents[chatIdStr];
    const chatId = Number(chatIdStr);
    const myBuyers =
      scope === "ALL" ? buyers : buyers.filter((b) => String(b.agent_id ?? "") === scope);
    const chatMon = monitor[chatIdStr] ?? {};
    const watched = new Set<string>();

    for (const b of myBuyers) {
      watched.add(b.id);
      let entry = chatMon[b.id];
      const isNew = !entry;
      const textChanged = !isNew && entry.text !== buyerText(b);
      if (isNew || textChanged) {
        const criteria = await resolveBuyerCriteria(b);
        criteria.priceTolerance = tol;
        entry = { text: buyerText(b), criteria, seen: [] };
      }
      entry.criteria.priceTolerance = tol;
      const matches = matchListings(all, entry.criteria);
      const prio = b.priority ? ` (${b.priority.toUpperCase()})` : "";
      if (isNew) {
        // prvi put → catch-up: do 3 trenutna VLASNIČKA (oglasi/nekretnine, već potvrđeni),
        // bez 4zida detaljne provere da ne hameruje (4zida nove hvata redovni prolaz)
        const owners = matches.filter((m) => m.seller === "owner");
        for (const m of owners.slice(0, 3)) {
          await send(chatId, `🏠 Za kupca ${b.first_name} ${b.last_name}${prio}\n${fmtListing(m)}`);
          await sleep(350);
        }
        entry.seen = matches.map((m) => m.id);
      } else if (silent || textChanged) {
        entry.seen = matches.map((m) => m.id); // restart ili promena kriterijuma → tiho
      } else {
        const freshAll = matches.filter((m) => !entry.seen.includes(m.id));
        const fresh = await confirmOwners(freshAll);
        for (const m of fresh) {
          await send(chatId, `🔔 NOVO za kupca ${b.first_name} ${b.last_name}${prio}\n${fmtListing(m)}`);
          await sleep(350);
        }
        if (freshAll.length) entry.seen = [...entry.seen, ...freshAll.map((m) => m.id)].slice(-300);
      }
      chatMon[b.id] = entry;
    }
    for (const id of Object.keys(chatMon)) if (!watched.has(id)) delete chatMon[id];
    monitor[chatIdStr] = chatMon;
  }
  // ukloni chatove koji više nisu registrovani (i stare "flat" ključeve iz ranije verzije)
  for (const cid of Object.keys(monitor)) if (!autoAgents[cid]) delete monitor[cid];
  saveBuyerMonitor(monitor);
}

export async function handleText(text: string, user?: string, chatId?: number): Promise<string | string[]> {
  const t = text.trim();
  if (!t || /^\/(start|help)\b/i.test(t)) return HELP;

  const settingsReply = handleSettings(t);
  if (settingsReply) return settingsReply;

  const agentReply = await handleAgent(t, chatId);
  if (agentReply) return agentReply;

  const autoReply = handleAuto(t, chatId);
  if (autoReply) return autoReply;

  const noviReply = await handleNovi(t, chatId);
  if (noviReply) return noviReply;

  // 👥 upravljanje pristupom
  const addU = t.match(/^\/dodaj\s+@?(\w+)/i);
  if (addU) return `✅ Dodat pristup: @${addAllowed(addU[1])}. Odmah može da koristi Ficu (bez restarta).`;
  const rmU = t.match(/^\/ukloni\s+@?(\w+)/i);
  if (rmU) return `✅ Uklonjen pristup: @${removeAllowed(rmU[1])}. (Originalne iz .env ne uklanja ova komanda.)`;
  if (/^\/korisnici\b/i.test(t)) {
    const base = (process.env.ALLOWED_TELEGRAM_USERS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const extra = getAllowedExtra();
    return (
      "👥 Pristup Fici imaju:\n" +
      [...base, ...extra].map((u) => `• @${u}`).join("\n") +
      "\n\nDodaj: /dodaj @username · Ukloni: /ukloni @username"
    );
  }

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

  // Zaštita: bez ijednog stvarnog filtera ne pretražuj — inače se poklopi SVE i zatrpa chat.
  if (!hasRealCriteria(criteria)) {
    logEmpty(who, t, criteria);
    return byBuyer
      ? `🤔 Za "${who}" nemam dovoljno kriterijuma — ili ime nije u CRM-u, ili kupac nema zadate parametre. ` +
          `Probaj tačno ime iz CRM-a, ili ukucaj kriterijume: npr. „Liman do 150000 trosoban".`
      : `🤔 Treba mi bar jedan kriterijum: cena, kvart, sobnost ili kvadratura. Npr: „Grbavica do 120000 dvosoban".`;
  }

  const s = getSettings();
  criteria.priceTolerance = s.priceTolerance;
  const all = await searchAllPortals({ maxPages: s.maxPages });
  const matches = await confirmOwners(matchListings(all, criteria));
  if (!matches.length) logEmpty(who, t, criteria);
  return formatReplies(who, criteria, all.length, matches);
}

// Pozadinska provera: ručna praćenja + auto HOT/MED kupci. Šalje samo NOVE oglase.
let primed = false;

export async function runWatchCycle(send: Send): Promise<void> {
  const watches = getWatches();
  const hasAuto = Object.keys(getAutoAgents()).length > 0;
  const novi = getSettings().noviChatId;
  if (!watches.length && !hasAuto && !novi) return;
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
    for (const m of fresh) await send(w.chatId, `🔔 NOVO za "${w.label}"\n${fmtListing(m)}`);
    updateWatchSeen(w.id, [...w.seen, ...freshAll.map((m) => m.id)]);
  }

  if (hasAuto) await buyerCycle(all, send, silent);

  // Feed "Najnoviji vlasnički oglasi": svaki NOV vlasnički oglas (nezavisno od kupca)
  if (novi) {
    const seenArr = getNoviSeen();
    const seen = new Set(seenArr);
    const freshAll = all.filter((l) => !seen.has(l.id));
    if (freshAll.length) {
      const owners = await confirmOwners(freshAll);
      // prvi put (nema baseline-a): pošalji zadnjih ~15 da se ODMAH vidi da radi; posle samo nove
      const toSend = seenArr.length === 0 ? owners.slice(0, 15) : owners;
      for (const m of toSend) await send(novi, `🆕 Nov vlasnički oglas (${m.portal})\n${fmtListing(m)}`);
      setNoviSeen([...seenArr, ...freshAll.map((l) => l.id)]);
    }
  }
}
