// Tipovi koje Fica koristi za oglase i kriterijume pretrage.

export type Listing = {
  id: string; // jedinstveni ID oglasa (poslednji segment URL-a)
  url: string; // pun link ka oglasu
  price: number | null; // cena
  currency: string | null; // valuta (skoro uvek EUR)
  area: number | null; // kvadratura u m²
  rooms: number | null; // broj soba (4zida koristi i 0.5 / 1.5 / 2.5 ...)
  pricePerM2: number | null; // €/m² (izračunato)
  location: string; // slug kvarta iz URL-a, npr. "novi-sad-centar-stari-grad-..."
  portal: string; // npr. "4zida"
};

export type Criteria = {
  location?: string; // tekst koji se traži u slug-u kvarta, npr. "centar", "liman"
  excludeLocations?: string[]; // kvartovi koje kupac NE želi, npr. ["telep","adice"]
  priceMin?: number;
  priceMax?: number;
  areaMin?: number; // m²
  areaMax?: number; // m²
  roomsMin?: number;
  roomsMax?: number;
  priceTolerance?: number; // npr. 0.1 = dozvoli 10% preko priceMax (Isak odlučuje)
};
