import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

/* ================= STORAGE ================= */
const MEMORY_FILE = "./memory.json";
let memory = {};

if (fs.existsSync(MEMORY_FILE)) {
  try {
    memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    memory = {};
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

/* ================= ENV ================= */
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VK_GROUP_ID = process.env.VK_GROUP_ID; // для Donut

/* ================= LIMITS ================= */
const limits = {};
const FLOOD_DELAY = 4000;

/* лимиты по тарифам */
const TARIFF_LIMITS = {
  free: { ai: 5, photo: 0, menu: 0 },
  base: { ai: 10, photo: 0, menu: 1 },
  advanced: { ai: 20, photo: 0, menu: 7 },
  vip: { ai: 100, photo: 100, menu: 30 }
};

/* ================= REGEX ================= */
const MENU_REGEX = /(меню).*(день|недел|7|месяц|30)/i;
const ALLOWED_REGEX =
  /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|завтрак|обед|ужин|меню|продукт|что есть)/i;

const ABOUT_REGEX = /(ты кто|кто ты|как тебя зовут)/i;
const THANKS_REGEX = /(спасибо|благодарю)/i;

/* ================= CALLBACK ================= */
app.post("/", (req, res) => {
  const body = req.body;

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  res.send("ok");

  if (body.type === "message_new") {
    const msg = body.object.message;
    if (msg.from_id > 0) {
      handleMessage(msg).catch(console.error);
    }
  }
});

/* ================= MAIN HANDLER ================= */
async function handleMessage(message) {
  const userId = message.from_id;
  const peerId = message.peer_id;
  const text = (message.text || "").trim();
  const now = Date.now();

  /* ---- limits ---- */
  if (!limits[userId]) {
    limits[userId] = { last: 0, ai: 0, day: today() };
  }

  if (now - limits[userId].last < FLOOD_DELAY) return;
  limits[userId].last = now;

  if (limits[userId].day !== today()) {
    limits[userId].ai = 0;
    limits[userId].day = today();
  }

  /* ---- memory ---- */
  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      goal: null,
      step: 0,
      tariff: "free" // free | base | advanced | vip
    };
    saveMemory();
  }

  const user = memory[userId];

  /* ================= PHOTO CHECK ================= */
  if (message.attachments?.some(a => a.type === "photo")) {
    if (!checkAccess(user, "photo")) {
      return sendVK(
        peerId,
        "Я вижу фото 😊\nАнализ еды и КБЖУ по фото доступны в тарифе «Личный ассистент» 💚\nhttps://vk.com/pp_recepty_vk?w=donut_payment-" +
          VK_GROUP_ID +
          "&levelId=3257"
      );
    }
  }

  /* ================= HUMAN ANSWERS ================= */
  if (ABOUT_REGEX.test(text)) {
    return sendVK(peerId, "Я Анна 😊 Нутрициолог. Помогаю с ПП и похудением 💚");
  }

  if (THANKS_REGEX.test(text)) {
    return sendVK(peerId, "Всегда рада помочь 💚");
  }

  /* ================= ONBOARDING ================= */
  if (user.step === 0) {
    user.step = 1;
    saveMemory();
    return sendVK(peerId, "Привет 😊 Я Анна. Как тебя зовут?");
  }

  if (user.step === 1) {
    user.name = text;
    user.step = 2;
    saveMemory();
    return sendVK(
      peerId,
      `${user.name}, приятно познакомиться 💚\nКакая у тебя цель?\n1️⃣ Похудеть\n2️⃣ ПП питание\n3️⃣ Поддерживать форму`
    );
  }

  if (user.step === 2) {
    user.goal = text;
    user.step = 3;
    saveMemory();
    return sendVK(
      peerId,
      "Отлично 👍 Тогда пиши продукты или задавай вопросы — я рядом 🥗"
    );
  }

  /* ================= MENU ================= */
  if (MENU_REGEX.test(text)) {
    if (!checkAccess(user, "menu")) {
      return sendVK(
        peerId,
        "Меню доступно по подписке 💚\nhttps://vk.com/pp_recepty_vk?w=donut_payment-" +
          VK_GROUP_ID
      );
    }
  }

  /* ================= FILTER ================= */
  if (!ALLOWED_REGEX.test(text)) {
    return sendVK(peerId, "Я подсказываю только по ПП питанию 🥗");
  }

  if (!checkAccess(user, "ai")) {
    return sendVK(peerId, "На сегодня лимит ответов исчерпан 😊");
  }

  startTyping(peerId);

  /* ================= AI ================= */
  let answer = "Секунду, думаю 😊";

  try {
    const systemPrompt = `
Ты Анна — живой нутрициолог.
Говори тепло, коротко, по-человечески.
Если тариф ограничен — мягко объясняй.
Никакого официоза и списков ради списков.
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
     headers: {
  "Authorization": "Bearer " + OPENAI_API_KEY,
  "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ]
      })
    });

    const data = await r.json();
    answer = data.choices?.[0]?.message?.content || answer;
    limits[userId].ai++;
  } catch (e) {
    console.error("OpenAI error:", e);
  }

  await sendVK(peerId, answer);
}

/* ================= ACCESS CONTROL ================= */
function checkAccess(user, feature) {
  const tariff = user.tariff || "free";
  const limits = TARIFF_LIMITS[tariff];

  if (!limits) return false;

  if (feature === "ai") return limits.ai > 0;
  if (feature === "photo") return limits.photo > 0;
  if (feature === "menu") return limits.menu > 0;

  return false;
}

/* ================= HELPERS ================= */
function today() {
  return new Date().toISOString().slice(0, 10);
}

function startTyping(peer_id) {
  fetch("https://api.vk.com/method/messages.setActivity", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id,
      type: "typing",
      access_token: VK_TOKEN,
      v: "5.199"
    })
  }).catch(() => {});
}

async function sendVK(peer_id, text) {
  await fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id,
      message: text,
      random_id: Date.now().toString(),
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });
}

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot started on port", PORT);
});
