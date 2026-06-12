// Klijent za Apex CRM bot API. Čita kupce; (kasnije) upisuje nalaze — NIKAD ne briše.
import type { Criteria } from "./types.ts";

function crmBase(): string {
  return process.env.CRM_BASE_URL ?? "https://crm.apexrealestate.rs";
}

export type Buyer = {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  email?: string | null;
  desired_type?: string | null; // JSON niz, npr. '["Stan"]'
  desired_rooms?: string | null; // JSON niz, npr. '["Dvosoban"]'
  budget?: number | null; // EUR (jedan broj — tretiramo kao maksimum)
  location?: string | null; // često sadrži ceo slobodan tekst kriterijuma
  preferred_locations?: string | null; // JSON niz kvartova
  financing?: string | null;
  notes?: string | null;
  status?: string | null; // Aktivan | Pauzirana Potraga | Kupio Stan
  priority?: string | null;
};

function authHeaders(): Record<string, string> {
  const key = process.env.CRM_API_KEY ?? "";
  if (!key) throw new Error("CRM_API_KEY nije postavljen u .env");
  return { Authorization: `Bearer ${key}` };
}

export async function getBuyers(
  params: { status?: string; type?: string } = {},
): Promise<Buyer[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.type) qs.set("type", params.type);
  const url = `${crmBase()}/api/bot/buyers${qs.toString() ? `?${qs}` : ""}`;

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`CRM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { buyers?: Buyer[] };
  return data.buyers ?? [];
}

export type { Criteria };
