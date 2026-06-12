// Tipovi koje Fica koristi za oglase i kriterijume pretrage.

export type Listing = {
  id: string; // jedinstveni ID oglasa (poslednji segment URL-a)
  url: string; // pun link ka oglasu
  price: number | null; // cena
  currency: string | null; // valuta (skoro uvek EUR)
  area: number | null; // kvadratura u m²
  rooms: number | null; // broj soba (4zida koristi i 0.5 / 1.5 / 2.5 ...)
  pricePerM2: number | null; // €/m² (izračunato)
  location: string; // slug kvarta (mala slova, bez kvačica), npr. "grbavica", "liman-4"
  portal: string; // "4zida" | "oglasi.rs" | "nekretnine.rs"
  seller?: "owner" | "agency" | null; // tip prodavca (null = nepoznato, npr. 4zida)
};

export type Criteria = {
  location?: string; // jedan kvart (slobodna pretraga)
  locations?: string[]; // više kvartova — poklapanje ako je u BILO KOM (preferirane lokacije kupca)
  excludeLocations?: string[]; // kvartovi koje kupac NE želi, npr. ["telep","adice"]
  priceMin?: number;
  priceMax?: number;
  areaMin?: number; // m²
  areaMax?: number; // m²
  roomsMin?: number;
  roomsMax?: number;
  priceTolerance?: number; // npr. 0.1 = dozvoli 10% preko priceMax (Isak odlučuje)
};
