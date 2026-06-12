// src/env.ts
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
function loadEnv() {
  const here2 = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here2, "..", ".env"), join(process.cwd(), ".env")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === void 0) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    return;
  }
}

// src/crm.ts
function crmBase() {
  return process.env.CRM_BASE_URL ?? "https://crm.apexrealestate.rs";
}
function authHeaders() {
  const key = process.env.CRM_API_KEY ?? "";
  if (!key) throw new Error("CRM_API_KEY nije postavljen u .env");
  return { Authorization: `Bearer ${key}` };
}
async function getBuyers(params = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.type) qs.set("type", params.type);
  const url = `${crmBase()}/api/bot/buyers${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`CRM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data.buyers ?? [];
}

// src/buyer-criteria.ts
var ROOMS = {
  garsonjera: 0.5,
  jednosoban: 1,
  jednoiposoban: 1.5,
  dvosoban: 2,
  dvoiposoban: 2.5,
  trosoban: 3,
  troiposoban: 3.5,
  cetvorosoban: 4,
  cetvoroiposoban: 4.5,
  petosoban: 5
};
function deburr(s) {
  const map = { \u010D: "c", \u0107: "c", \u0161: "s", \u017E: "z", \u0111: "dj" };
  return s.toLowerCase().replace(/[čćšžđ]/g, (m) => map[m] ?? m);
}
function roomsToNumber(s) {
  if (!s) return void 0;
  const t = deburr(s).trim();
  for (const [word, num] of Object.entries(ROOMS)) if (t.includes(word)) return num;
  const n = Number(t.replace(",", "."));
  return Number.isNaN(n) ? void 0 : n;
}

// src/parse.ts
var SYSTEM = `Ti si parser za agenciju za nekretnine u Novom Sadu. Iz teksta izvuci kriterijume pretrage stana i vrati ISKLJU\u010CIVO JSON (bez ikakvog obja\u0161njenja), ta\u010Dno po \u0161emi:
{
  "location": string|null,          // glavni tra\u017Eeni kvart malim slovima (npr. "centar","liman","grbavica") ili null
  "excludeLocations": string[],     // kvartovi koje NE \u017Eeli (npr. ["telep","adice","klisa"])
  "priceMin": number|null,          // EUR
  "priceMax": number|null,          // EUR (npr. "do 150.000" ili "bud\u017Eet 150k" => 150000)
  "areaMin": number|null,           // m\xB2
  "areaMax": number|null,           // m\xB2
  "roomsMin": number|null,          // 0.5=garsonjera, 1, 1.5, 2, 2.5, 3, 3.5, 4...
  "roomsMax": number|null,
  "floorNote": string|null,         // zahtevi za sprat/lift, npr. "bez lifta samo 1-2. sprat; ne poslednji"
  "mustHave": string[]              // ostali bitni zahtevi (npr. "upotrebna dozvola","bez tereta","nameSten")
}
Pravila:
- "oko N kvadrata" => areaMin = N-5, areaMax = N+10.
- Sobnost re\u010Dima: garsonjera=0.5, jednosoban=1, jednoiposoban=1.5, dvosoban=2, dvoiposoban=2.5, trosoban=3, troiposoban=3.5.
- Kvartove vrati malim slovima bez kva\u010Dica (\u0161->s, \u010D/\u0107->c, \u017E->z, \u0111->dj).
- Ako ne\u0161to nije navedeno, stavi null odnosno prazan niz.`;
async function parseCriteria(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.FICA_MODEL ?? "claude-haiku-4-5-20251001";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY nije postavljen u .env");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: text }]
    })
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data.content?.[0]?.text ?? "{}";
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

// src/resolve.ts
function deburr2(s) {
  const map = { \u010D: "c", \u0107: "c", \u0161: "s", \u017E: "z", \u0111: "dj" };
  return s.toLowerCase().replace(/[čćšžđ]/g, (m) => map[m] ?? m);
}
function toArray(s) {
  if (!s) return [];
  try {
    const a = JSON.parse(s);
    if (Array.isArray(a)) return a.map(String);
  } catch {
  }
  return String(s).split(",").map((x) => x.trim()).filter(Boolean);
}
function roomsRange(s) {
  const nums = toArray(s).map((x) => roomsToNumber(x)).filter((n) => n != null);
  if (!nums.length) return {};
  return { min: Math.min(...nums), max: Math.max(...nums) };
}
function locationSlugs(s) {
  return toArray(s).map((x) => deburr2(x).trim().replace(/\s+/g, "-")).filter(Boolean);
}
async function resolveBuyerCriteria(b) {
  const rooms = roomsRange(b.desired_rooms);
  const locations = locationSlugs(b.preferred_locations);
  const text = [b.location, b.notes].filter(Boolean).join(". ").trim();
  let parsed = {};
  if (text.length > 8) {
    try {
      parsed = await parseCriteria(text);
    } catch {
    }
  }
  return {
    locations: locations.length ? locations : parsed.location ? [parsed.location] : void 0,
    excludeLocations: parsed.excludeLocations,
    priceMin: parsed.priceMin ?? void 0,
    priceMax: parsed.priceMax ?? (b.budget ?? void 0),
    areaMin: parsed.areaMin ?? void 0,
    areaMax: parsed.areaMax ?? void 0,
    roomsMin: rooms.min,
    roomsMax: rooms.max
  };
}
async function criteriaFromText(text) {
  const p = await parseCriteria(text);
  return {
    location: p.location ?? void 0,
    excludeLocations: p.excludeLocations,
    priceMin: p.priceMin ?? void 0,
    priceMax: p.priceMax ?? void 0,
    areaMin: p.areaMin ?? void 0,
    areaMax: p.areaMax ?? void 0,
    roomsMin: p.roomsMin ?? void 0,
    roomsMax: p.roomsMax ?? void 0
  };
}

// src/portals/fourzida.ts
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var BASE = "https://www.4zida.rs";
var CACHE_TTL_MS = 5 * 60 * 1e3;
var cache = /* @__PURE__ */ new Map();
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function toNum(v) {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}
function locationFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => p === "prodaja-stanova" || p === "novogradnja");
    return i >= 0 && parts[i + 1] ? parts[i + 1] : "";
  } catch {
    return "";
  }
}
function parseListings(html) {
  const blocks = [
    ...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)
  ].map((m) => m[1]);
  const out = [];
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    collect(data, out);
  }
  return out;
}
function collect(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node;
  if (o["@type"] === "ListItem" && o.item && typeof o.item === "object") {
    const it = o.item;
    const offers = it.offers ?? {};
    const itemOffered = it.itemOffered ?? {};
    const floorSize = itemOffered.floorSize ?? {};
    const url = typeof it.url === "string" ? it.url : null;
    const price = toNum(offers.price);
    const isListing = url != null && (price !== null || floorSize.value != null || itemOffered.numberOfRooms != null);
    if (url && isListing) {
      const area = toNum(floorSize.value);
      out.push({
        id: url.split("/").filter(Boolean).pop() ?? url,
        url,
        price,
        currency: typeof offers.priceCurrency === "string" ? offers.priceCurrency : null,
        area,
        rooms: toNum(itemOffered.numberOfRooms),
        pricePerM2: price && area ? Math.round(price / area) : null,
        location: locationFromUrl(url),
        portal: "4zida"
      });
    }
  }
  for (const v of Object.values(o)) collect(v, out);
}
async function searchFourZida(opts = {}) {
  const locationSlug = opts.locationSlug ?? "novi-sad";
  const maxPages = opts.maxPages ?? 10;
  const delayMs = opts.delayMs ?? 600;
  const cacheKey = `${locationSlug}:${maxPages}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const byId = /* @__PURE__ */ new Map();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/prodaja-stanova/${locationSlug}${page > 1 ? `?strana=${page}` : ""}`;
    let res;
    try {
      res = await fetch(url, { headers: { "user-agent": UA } });
    } catch {
      break;
    }
    if (!res.ok) break;
    const listings = parseListings(await res.text());
    if (listings.length === 0) break;
    let added = 0;
    for (const l of listings) {
      if (!byId.has(l.id)) {
        byId.set(l.id, l);
        added++;
      }
    }
    opts.onPage?.(page, byId.size);
    if (added === 0) break;
    if (page < maxPages) await sleep(delayMs);
  }
  const data = [...byId.values()];
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

// src/match.ts
function matchListings(listings, c) {
  const effectiveMax = c.priceMax != null ? c.priceMax * (1 + (c.priceTolerance ?? 0)) : null;
  return listings.filter((l) => {
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
  }).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

// src/store.ts
import { readFileSync as readFileSync2, writeFileSync, existsSync as existsSync2, appendFileSync } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { dirname as dirname2, join as join2 } from "node:path";
var here = dirname2(fileURLToPath2(import.meta.url));
var ROOT = here.endsWith("dist") || here.endsWith("src") ? join2(here, "..") : here;
var SETTINGS_FILE = join2(ROOT, "settings.json");
var SUGGESTIONS_FILE = join2(ROOT, "predlozi.txt");
var EMPTY_LOG = join2(ROOT, "prazne-pretrage.txt");
var WATCHES_FILE = join2(ROOT, "watches.json");
var MONITOR_FILE = join2(ROOT, "buyer-monitor.json");
var DEFAULTS = { priceTolerance: 0, resultCount: 8, maxPages: 18, autoChatId: 0 };
function getSettings() {
  try {
    if (existsSync2(SETTINGS_FILE)) {
      return { ...DEFAULTS, ...JSON.parse(readFileSync2(SETTINGS_FILE, "utf8")) };
    }
  } catch {
  }
  return { ...DEFAULTS };
}
function setSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}
function addSuggestion(user, text) {
  appendFileSync(SUGGESTIONS_FILE, `[${(/* @__PURE__ */ new Date()).toISOString()}] @${user}: ${text}
`);
}
function listSuggestions(limit = 20) {
  try {
    if (!existsSync2(SUGGESTIONS_FILE)) return [];
    return readFileSync2(SUGGESTIONS_FILE, "utf8").trim().split("\n").filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}
function logEmpty(who, query, criteria) {
  try {
    appendFileSync(
      EMPTY_LOG,
      `[${(/* @__PURE__ */ new Date()).toISOString()}] ${who} | "${query}" | ${JSON.stringify(criteria)}
`
    );
  } catch {
  }
}
function getWatches() {
  try {
    if (existsSync2(WATCHES_FILE)) return JSON.parse(readFileSync2(WATCHES_FILE, "utf8"));
  } catch {
  }
  return [];
}
function saveWatches(list) {
  writeFileSync(WATCHES_FILE, JSON.stringify(list, null, 2));
}
function addWatch(w) {
  const all = getWatches();
  const nums = all.map((x) => Number(x.id.replace(/\D/g, "")) || 0);
  const watch = { ...w, id: "w" + (Math.max(0, ...nums) + 1), createdAt: (/* @__PURE__ */ new Date()).toISOString() };
  all.push(watch);
  saveWatches(all);
  return watch;
}
function removeWatch(id) {
  const all = getWatches();
  const next = all.filter((w) => w.id.toLowerCase() !== id.toLowerCase());
  if (next.length === all.length) return false;
  saveWatches(next);
  return true;
}
function updateWatchSeen(id, seen) {
  const all = getWatches();
  const w = all.find((x) => x.id === id);
  if (!w) return;
  w.seen = seen.slice(-300);
  saveWatches(all);
}
function getBuyerMonitor() {
  try {
    if (existsSync2(MONITOR_FILE)) {
      return JSON.parse(readFileSync2(MONITOR_FILE, "utf8"));
    }
  } catch {
  }
  return {};
}
function saveBuyerMonitor(map) {
  writeFileSync(MONITOR_FILE, JSON.stringify(map, null, 2));
}

// src/respond.ts
var HELP = `\u{1F44B} Ja sam Fica. Tra\u017Eim stanove na 4zida.

\u{1F50E} Slobodna pretraga: "dvosoban Liman do 130k" \xB7 "stan 50-60m2 centar do 120000, ne Telep"
\u{1F464} Po kupcu: "za Smiljka" \xB7 /kupac Smiljka \xB7 /kupci

\u{1F916} Auto-pra\u0107enje HOT/MED kupaca:
   /auto on \u2014 Fica sam prati sve hot/med kupce i javlja OVDE \u010Dim isko\u010Di novo
   /auto off \xB7 /auto (status)

\u{1F514} Ru\u010Dno pra\u0107enje:
   /prati Smiljka \xB7 /prati dvosoban centar 130000-150000 \xB7 /pratnje \xB7 /prekini w1

\u2699\uFE0F /podesavanja \xB7 /podesi tolerancija 10 \xB7 /podesi rezultata 12 \xB7 /podesi dubina 25
\u{1F4DD} /predlog <ideja> \xB7 /predlozi`;
function fmtCriteria(c) {
  const p = [];
  const locs = c.locations?.length ? c.locations.join(", ") : c.location;
  if (locs) p.push(`\u{1F4CD} ${locs}`);
  if (c.excludeLocations?.length) p.push(`\u26D4 ${c.excludeLocations.join(", ")}`);
  if (c.priceMin != null || c.priceMax != null) p.push(`\u{1F4B6} ${c.priceMin ?? 0}\u2013${c.priceMax ?? "\u221E"}\u20AC`);
  if (c.areaMin != null || c.areaMax != null) p.push(`\u{1F4D0} ${c.areaMin ?? 0}\u2013${c.areaMax ?? "\u221E"}m\xB2`);
  if (c.roomsMin != null) p.push(`\u{1F6AA} ${c.roomsMin}${c.roomsMax && c.roomsMax !== c.roomsMin ? "\u2013" + c.roomsMax : ""} sob`);
  return p.join(" \xB7 ") || "(bez filtera)";
}
function fmtListing(m) {
  const price = m.price != null ? `${m.price.toLocaleString("sr-RS")}\u20AC` : "\u2014";
  return `${price} \xB7 ${m.area ?? "\u2014"}m\xB2 \xB7 ${m.rooms ?? "\u2014"} sob \xB7 ${m.pricePerM2 ?? "\u2014"}\u20AC/m\xB2
${m.url}`;
}
function formatReply(who, c, poolSize, matches, n) {
  const head = `\u{1F3E0} ${who}
${fmtCriteria(c)}

\u2705 ${matches.length} poklapanja (od ${poolSize} pregledanih):`;
  const lines = matches.slice(0, n).map((m, i) => `

${i + 1}. ${fmtListing(m)}`);
  let msg = head + lines.join("");
  if (matches.length > n) msg += `

\u2026i jo\u0161 ${matches.length - n}. Suzi kriterijume za precizniju listu.`;
  if (!matches.length) msg += `
(nema pogodaka \u2014 probaj \u0161ire opsege ili drugi kvart)`;
  return msg.slice(0, 4e3);
}
function handleSettings(t) {
  if (/^\/podesavanja\b/i.test(t)) {
    const s = getSettings();
    return `\u2699\uFE0F Trenutna pode\u0161avanja:
\u2022 tolerancija bud\u017Eeta: +${Math.round(s.priceTolerance * 100)}%
\u2022 broj rezultata: ${s.resultCount}
\u2022 dubina pretrage: ${s.maxPages} strana
\u2022 auto-pra\u0107enje HOT/MED: ${s.autoChatId ? "uklju\u010Deno" : "isklju\u010Deno"}

Promena: /podesi tolerancija 10 \xB7 /podesi rezultata 12 \xB7 /podesi dubina 25`;
  }
  const m = t.match(/^\/podesi\s+(\w+)\s+(\d+)/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const val = Number(m[2]);
  if (key.startsWith("toleranc")) {
    const pct = Math.min(val, 100);
    setSetting("priceTolerance", pct / 100);
    return `\u2705 Tolerancija bud\u017Eeta: +${pct}%`;
  }
  if (key.startsWith("rezultat")) {
    const n = Math.max(1, Math.min(val, 30));
    setSetting("resultCount", n);
    return `\u2705 Broj rezultata: ${n}`;
  }
  if (key.startsWith("dubin")) {
    const n = Math.max(1, Math.min(val, 40));
    setSetting("maxPages", n);
    return `\u2705 Dubina pretrage: ${n} strana`;
  }
  return `Ne znam pode\u0161avanje "${key}". Probaj: tolerancija, rezultata, dubina.`;
}
async function resolveTarget(arg) {
  const buyers = await getBuyers({ status: "Aktivan" }).catch(() => []);
  const b = buyers.find((x) => `${x.first_name} ${x.last_name}`.toLowerCase().includes(arg.toLowerCase()));
  if (b) return { criteria: await resolveBuyerCriteria(b), label: `${b.first_name} ${b.last_name}` };
  return { criteria: await criteriaFromText(arg), label: arg };
}
async function handleWatch(t, chatId) {
  const add = t.match(/^\/prati\s+(.+)/is);
  if (add) {
    if (chatId == null) return "Ne mogu da postavim pra\u0107enje (nedostaje chat).";
    const { criteria, label } = await resolveTarget(add[1].trim());
    criteria.priceTolerance = getSettings().priceTolerance;
    const all = await searchFourZida({ maxPages: getSettings().maxPages });
    const current = matchListings(all, criteria);
    const w = addWatch({ label, chatId, criteria, seen: current.map((m) => m.id) });
    return `\u{1F514} Pratim "${label}" (${fmtCriteria(criteria)}).
Trenutno aktivnih: ${current.length} (njih ne brojim kao nove). Javi\u0107u \u010Dim isko\u010Di NOV oglas.
ID: ${w.id} \u2014 zaustavi sa /prekini ${w.id}`;
  }
  if (/^\/pratnje\b/i.test(t)) {
    const ws = getWatches();
    return ws.length ? "\u{1F514} Aktivna pra\u0107enja:\n" + ws.map((w) => `\u2022 ${w.id}: ${w.label} (${fmtCriteria(w.criteria)})`).join("\n") + "\n\nStop: /prekini <id>" : "Nema ru\u010Dnih pra\u0107enja. Dodaj: /prati <kupac ili opis>";
  }
  const stop = t.match(/^\/prekini\s+(\w+)/i);
  if (stop) {
    return removeWatch(stop[1]) ? `\u2705 Pra\u0107enje ${stop[1]} zaustavljeno.` : `Nema pra\u0107enja "${stop[1]}". /pratnje za listu.`;
  }
  return null;
}
function buyerText(b) {
  return [b.location, b.notes, b.desired_rooms, b.preferred_locations, b.budget].join("|");
}
async function activeHotMed() {
  const buyers = await getBuyers({ status: "Aktivan" }).catch(() => []);
  return buyers.filter((b) => ["hot", "medium"].includes(String(b.priority ?? "").toLowerCase()));
}
async function baselineBuyers() {
  const buyers = await activeHotMed();
  const all = await searchFourZida({ maxPages: getSettings().maxPages });
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
async function handleAuto(t, chatId) {
  const m = t.match(/^\/auto\b\s*(\w+)?/i);
  if (!m) return null;
  const arg = (m[1] ?? "").toLowerCase();
  if (arg === "on") {
    if (chatId == null) return "Ne mogu (nedostaje chat).";
    setSetting("autoChatId", chatId);
    const n = await baselineBuyers();
    return `\u2705 Auto-pra\u0107enje uklju\u010Deno. Pratim ${n} HOT/MED kupaca; alarmi sti\u017Eu OVDE. Javi\u0107u za svaki NOV oglas (zate\u010Dene ne brojim kao nove).`;
  }
  if (arg === "off") {
    setSetting("autoChatId", 0);
    return "Auto-pra\u0107enje HOT/MED kupaca isklju\u010Deno.";
  }
  const cur = getSettings().autoChatId;
  return cur ? "Auto-pra\u0107enje je UKLJU\u010CENO. /auto off da isklju\u010Di\u0161." : "Auto-pra\u0107enje je isklju\u010Deno. /auto on da uklju\u010Di\u0161 (alarmi sti\u017Eu u chat gde to ukuca\u0161).";
}
async function buyerCycle(all, chatId, send) {
  const buyers = await activeHotMed();
  const tol = getSettings().priceTolerance;
  const monitor = getBuyerMonitor();
  for (const b of buyers) {
    let entry = monitor[b.id];
    if (!entry || entry.text !== buyerText(b)) {
      const criteria = await resolveBuyerCriteria(b);
      criteria.priceTolerance = tol;
      monitor[b.id] = { text: buyerText(b), criteria, seen: matchListings(all, criteria).map((m) => m.id) };
      continue;
    }
    entry.criteria.priceTolerance = tol;
    const fresh = matchListings(all, entry.criteria).filter((m) => !entry.seen.includes(m.id));
    for (const m of fresh.slice(0, 10)) {
      await send(chatId, `\u{1F514} NOVO za kupca ${b.first_name} ${b.last_name} (${String(b.priority ?? "").toUpperCase()})
${fmtListing(m)}`);
    }
    if (fresh.length) entry.seen = [...entry.seen, ...fresh.map((m) => m.id)].slice(-300);
  }
  const ids = new Set(buyers.map((b) => b.id));
  for (const id of Object.keys(monitor)) if (!ids.has(id)) delete monitor[id];
  saveBuyerMonitor(monitor);
}
async function handleText(text, user, chatId) {
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
    return "\u{1F4DD} Zabele\u017Eeno, hvala! Predlog je sa\u010Duvan.";
  }
  if (/^\/predlozi\b/i.test(t)) {
    const list = listSuggestions(20);
    return list.length ? "\u{1F4CB} Predlozi:\n" + list.join("\n") : "Nema zabele\u017Eenih predloga jo\u0161.";
  }
  if (/^\/kupci\b/i.test(t)) {
    const buyers = await getBuyers({ status: "Aktivan" });
    return `\u{1F465} Aktivnih kupaca: ${buyers.length}
` + buyers.slice(0, 40).map((b) => `\u2022 ${b.first_name} ${b.last_name}`).join("\n");
  }
  let criteria;
  let who;
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
  const all = await searchFourZida({ maxPages: s.maxPages });
  const matches = matchListings(all, criteria);
  if (!matches.length) logEmpty(who, t, criteria);
  return formatReply(who, criteria, all.length, matches, s.resultCount);
}
async function runWatchCycle(send) {
  const watches = getWatches();
  const auto = getSettings().autoChatId;
  if (!watches.length && !auto) return;
  const all = await searchFourZida({ maxPages: getSettings().maxPages });
  for (const w of watches) {
    const fresh = matchListings(all, w.criteria).filter((m) => !w.seen.includes(m.id));
    if (!fresh.length) continue;
    for (const m of fresh.slice(0, 10)) await send(w.chatId, `\u{1F514} NOVO za "${w.label}"
${fmtListing(m)}`);
    updateWatchSeen(w.id, [...w.seen, ...fresh.map((m) => m.id)]);
  }
  if (auto) await buyerCycle(all, auto, send);
}

// src/bot.ts
loadEnv();
var TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
var ALLOWED = (process.env.ALLOWED_TELEGRAM_USERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
var API = `https://api.telegram.org/bot${TOKEN}`;
async function tg(method, params = {}) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params)
  });
  return r.json();
}
async function main() {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN nije postavljen u .env");
  const me = await tg("getMe");
  if (!me.ok) throw new Error("Telegram getMe nije uspeo: " + JSON.stringify(me));
  console.log(
    `\u{1F916} Fica @${me.result.username} slu\u0161a. Dozvoljeni: ${ALLOWED.join(", ") || "\u26A0\uFE0F SVI (postavi ALLOWED_TELEGRAM_USERS!)"}`
  );
  const CHECK_MIN = Number(process.env.FICA_CHECK_MINUTES) || 30;
  setInterval(() => {
    runWatchCycle(
      (chatId, text) => tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }).then(() => {
      })
    ).catch((e) => console.error("watch cycle:", e?.message ?? e));
  }, CHECK_MIN * 6e4);
  setTimeout(() => {
    runWatchCycle(
      (chatId, text) => tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }).then(() => {
      })
    ).catch((e) => console.error("watch cycle (init):", e?.message ?? e));
  }, 25e3);
  console.log(`\u{1F514} Pra\u0107enja se proveravaju svakih ${CHECK_MIN} min.`);
  let offset = 0;
  for (; ; ) {
    let res;
    try {
      res = await tg("getUpdates", { offset, timeout: 30 });
    } catch {
      await new Promise((r) => setTimeout(r, 2e3));
      continue;
    }
    for (const u of res.result ?? []) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg?.text) continue;
      const user = (msg.from?.username ?? "").toLowerCase();
      if (ALLOWED.length && !ALLOWED.includes(user)) {
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: "\u26D4 Nema\u0161 pristup Fici. Javi se Andriji da te doda."
        });
        continue;
      }
      await tg("sendMessage", { chat_id: msg.chat.id, text: "\u{1F50E} Tra\u017Eim, momenat..." });
      try {
        const reply = await handleText(msg.text, user, msg.chat.id);
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: reply,
          disable_web_page_preview: true
        });
      } catch (e) {
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: "\u26A0\uFE0F Gre\u0161ka: " + (e instanceof Error ? e.message : String(e))
        });
      }
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
