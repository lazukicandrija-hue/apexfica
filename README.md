# Fica 🏠🤖

Agent/scraper za **Apex Real Estate** (Novi Sad). Povezuje CRM (`crm.apexrealestate.rs`) sa portalima za nekretnine i traži stanove koji odgovaraju kriterijumima kupaca. Komunikacija sa timom ide preko Telegrama.

## Princip (zašto je jeftino)
- **Scraping + matching = čist kod** (besplatno). Ne provlači se HTML kroz LLM.
- **LLM (jeftin model)** se koristi samo da pretvori Isakovu poruku u slobodnom tekstu u filtere.

## Status
- [x] 4zida scraper (SSR + JSON-LD, bez browsera) — `src/portals/fourzida.ts`
- [x] Matching motor — `src/match.ts`
- [x] CLI za test — `src/cli.ts`
- [ ] CRM klijent (čita kupce sa `/api/bot/buyers`, upisuje nalaze; nikad ne briše)
- [ ] Telegram bot + parser slobodnog teksta (Haiku)
- [ ] Ostali portali (oglasi.rs, halooglasi, nekretnine.rs)

## Pokretanje (Node ≥ 22.6, bez instalacije)
```bash
npm run search -- --m2 50-60 --price 100000-120000
npm run search -- --location centar --m2 50-65 --price 100000-130000 --rooms 2 --tolerance 0.1
```
Filteri: `--location`, `--price min-max`, `--m2 min-max`, `--rooms min-max`, `--tolerance` (npr. 0.1 = 10% preko budžeta), `--max-pages`.

## Konfiguracija
Kopiraj `.env.example` u `.env` i popuni ključeve. **`.env` nikad ne ide u git** (repoi su javni).
