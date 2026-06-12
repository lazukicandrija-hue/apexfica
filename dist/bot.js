// src/env.ts
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", ".env"), join(process.cwd(), ".env")];
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
function firstFromJsonArray(s) {
  if (!s) return void 0;
  try {
    const a = JSON.parse(s);
    if (Array.isArray(a) && a.length) return String(a[0]);
  } catch {
  }
  return s;
}
async function resolveBuyerCriteria(b) {
  const rooms = roomsToNumber(firstFromJsonArray(b.desired_rooms));
  const text = [b.location, b.notes].filter(Boolean).join(". ").trim();
  let parsed = {};
  if (text.length > 8) {
    try {
      parsed = await parseCriteria(text);
    } catch {
    }
  }
  return {
    location: parsed.location ?? void 0,
    excludeLocations: parsed.excludeLocations,
    priceMin: parsed.priceMin ?? void 0,
    priceMax: parsed.priceMax ?? (b.budget ?? void 0),
    areaMin: parsed.areaMin ?? void 0,
    areaMax: parsed.areaMax ?? void 0,
    roomsMin: rooms ?? parsed.roomsMin ?? void 0,
    roomsMax: rooms ?? parsed.roomsMax ?? void 0
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
    if (c.location) {
      if (!l.location.toLowerCase().includes(c.location.toLowerCase())) return false;
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

// src/respond.ts
var HELP = `\u{1F44B} Ja sam Fica. Mogu da tra\u017Eim stanove na 4zida.

\u2022 Slobodna pretraga \u2014 samo opi\u0161i \u0161ta tra\u017Ei\u0161:
   "dvosoban Liman do 130k"
   "stan 50-60m2 centar, bud\u017Eet 120000, ne Telep"

\u2022 Po kupcu iz CRM-a:
   "za Smiljka"   ili   /kupac Smiljka

\u2022 /kupci \u2014 lista aktivnih kupaca`;
function fmtCriteria(c) {
  const p = [];
  if (c.location) p.push(`\u{1F4CD} ${c.location}`);
  if (c.excludeLocations?.length) p.push(`\u26D4 ${c.excludeLocations.join(", ")}`);
  if (c.priceMin != null || c.priceMax != null)
    p.push(`\u{1F4B6} ${c.priceMin ?? 0}\u2013${c.priceMax ?? "\u221E"}\u20AC`);
  if (c.areaMin != null || c.areaMax != null)
    p.push(`\u{1F4D0} ${c.areaMin ?? 0}\u2013${c.areaMax ?? "\u221E"}m\xB2`);
  if (c.roomsMin != null) p.push(`\u{1F6AA} ${c.roomsMin} sob`);
  return p.join(" \xB7 ") || "(bez filtera)";
}
function formatReply(who, c, poolSize, matches) {
  const head = `\u{1F3E0} ${who}
${fmtCriteria(c)}

\u2705 ${matches.length} poklapanja (od ${poolSize} pregledanih):`;
  const lines = matches.slice(0, 8).map((m, i) => {
    const price = m.price != null ? `${m.price.toLocaleString("sr-RS")}\u20AC` : "\u2014";
    return `

${i + 1}. ${price} \xB7 ${m.area ?? "\u2014"}m\xB2 \xB7 ${m.rooms ?? "\u2014"} sob \xB7 ${m.pricePerM2 ?? "\u2014"}\u20AC/m\xB2
${m.url}`;
  });
  let msg = head + lines.join("");
  if (matches.length > 8) msg += `

\u2026i jo\u0161 ${matches.length - 8}. Suzi kriterijume za precizniju listu.`;
  if (!matches.length) msg += `
(nema pogodaka \u2014 probaj \u0161ire opsege ili drugi kvart)`;
  return msg.slice(0, 4e3);
}
async function handleText(text) {
  const t = text.trim();
  if (!t || /^\/(start|help)\b/i.test(t)) return HELP;
  if (/^\/kupci\b/i.test(t)) {
    const buyers = await getBuyers({ status: "Aktivan" });
    return `\u{1F465} Aktivnih kupaca: ${buyers.length}
` + buyers.slice(0, 40).map((b) => `\u2022 ${b.first_name} ${b.last_name}`).join("\n");
  }
  let criteria;
  let who;
  const byBuyer = t.match(/^(?:\/kupac\s+|za\s+)(.+)/i);
  if (byBuyer) {
    const name = byBuyer[1].trim();
    const buyers = await getBuyers({ status: "Aktivan" });
    const b = buyers.find(
      (x) => `${x.first_name} ${x.last_name}`.toLowerCase().includes(name.toLowerCase())
    );
    if (!b) return `Ne na\u0111oh aktivnog kupca "${name}". Probaj /kupci za listu.`;
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
        const reply = await handleText(msg.text);
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
