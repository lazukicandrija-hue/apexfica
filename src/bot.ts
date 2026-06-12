// Telegram bot (long-polling). Pokretanje: npm run bot
import { loadEnv } from "./env.ts";
loadEnv();
import { handleText, runWatchCycle } from "./respond.ts";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const ALLOWED = (process.env.ALLOWED_TELEGRAM_USERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  return r.json();
}

async function main(): Promise<void> {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN nije postavljen u .env");
  const me = await tg("getMe");
  if (!me.ok) throw new Error("Telegram getMe nije uspeo: " + JSON.stringify(me));
  console.log(
    `🤖 Fica @${me.result.username} sluša. Dozvoljeni: ${ALLOWED.join(", ") || "⚠️ SVI (postavi ALLOWED_TELEGRAM_USERS!)"}`,
  );

  // Pozadinsko praćenje: na svakih N min pošalji NOVE oglase za sva /prati
  const CHECK_MIN = Number(process.env.FICA_CHECK_MINUTES) || 30;
  setInterval(() => {
    runWatchCycle((chatId, text) =>
      tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }).then(() => {}),
    ).catch((e) => console.error("watch cycle:", e?.message ?? e));
  }, CHECK_MIN * 60_000);
  console.log(`🔔 Praćenja se proveravaju svakih ${CHECK_MIN} min.`);

  let offset = 0;
  for (;;) {
    let res: any;
    try {
      res = await tg("getUpdates", { offset, timeout: 30 });
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
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
          text: "⛔ Nemaš pristup Fici. Javi se Andriji da te doda.",
        });
        continue;
      }

      await tg("sendMessage", { chat_id: msg.chat.id, text: "🔎 Tražim, momenat..." });
      try {
        const reply = await handleText(msg.text, user, msg.chat.id);
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: reply,
          disable_web_page_preview: true,
        });
      } catch (e) {
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: "⚠️ Greška: " + (e instanceof Error ? e.message : String(e)),
        });
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
