// Parsira SLOBODAN TEKST (kupčeve kriterijume iz CRM-a ili Telegram poruku) u
// strukturne filtere — koristeći jeftin Claude model (Haiku).
// Ovo je JEDINO mesto gde se koristi LLM (i to malo tokena => par centi).
import type { Criteria } from "./types.ts";

const SYSTEM = `Ti si parser za agenciju za nekretnine u Novom Sadu. Iz teksta izvuci kriterijume pretrage stana i vrati ISKLJUČIVO JSON (bez ikakvog objašnjenja), tačno po šemi:
{
  "location": string|null,          // glavni traženi kvart malim slovima (npr. "centar","liman","grbavica") ili null
  "excludeLocations": string[],     // kvartovi koje NE želi (npr. ["telep","adice","klisa"])
  "priceMin": number|null,          // EUR
  "priceMax": number|null,          // EUR (npr. "do 150.000" ili "budžet 150k" => 150000)
  "areaMin": number|null,           // m²
  "areaMax": number|null,           // m²
  "roomsMin": number|null,          // 0.5=garsonjera, 1, 1.5, 2, 2.5, 3, 3.5, 4...
  "roomsMax": number|null,
  "floorNote": string|null,         // zahtevi za sprat/lift, npr. "bez lifta samo 1-2. sprat; ne poslednji"
  "mustHave": string[]              // ostali bitni zahtevi (npr. "upotrebna dozvola","bez tereta","nameSten")
}
Pravila:
- "oko N kvadrata" => areaMin = N-5, areaMax = N+10.
- Sobnost rečima: garsonjera=0.5, jednosoban=1, jednoiposoban=1.5, dvosoban=2, dvoiposoban=2.5, trosoban=3, troiposoban=3.5.
- Kvartove vrati malim slovima bez kvačica (š->s, č/ć->c, ž->z, đ->dj).
- Ako nešto nije navedeno, stavi null odnosno prazan niz.`;

export type ParsedCriteria = Criteria & {
  floorNote?: string | null;
  mustHave?: string[];
};

export async function parseCriteria(text: string): Promise<ParsedCriteria> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.FICA_MODEL ?? "claude-haiku-4-5-20251001";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY nije postavljen u .env");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = (await res.json()) as { content?: { text?: string }[] };
  const raw = data.content?.[0]?.text ?? "{}";
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return JSON.parse(json) as ParsedCriteria;
}
