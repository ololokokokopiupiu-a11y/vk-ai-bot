import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// ===== FILE STORAGE =====
const MEMORY_FILE = "./memory.json";
let memory = fs.existsSync(MEMORY_FILE)
  ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"))
  : {};

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== DONUT LEVELS =====
const DONUT_LEVELS = {
  3255: "base",
  3256: "pro",
  3257: "vip"
};

// ===== TARIFF LINKS =====
const TARIFF_LINKS = {
  base: "https://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3255",
  pro: "https://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3256",
  vip: "https://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3257"
};

// ===== LIMITS =====
const DAILY_LIMITS = {
  base: 3,
  pro: 5,
  vip: Infinity
};

const limits = {};
const FLOOD_DELAY = 4000;

// ===== REGEX =====
const MENU_REGEX = /(меню на|меню|недел|месяц)/i;
const ALLOWED_REGEX = /(пп|питани|похуд|калор|кбжу|рецепт|продукт|меню)/i;

// ===== CALLBACK =====
app.post("/", async (req, res) => {
  const body = req.body;

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  res.send("ok");

  // ===== DONUT EVENTS =====
  if (body.type.startsWith("donut_")) {
    const userId = body.object.user_id;
    const levelId = body.object.level?.id;

    if (!memory[userId]) {
      memory[userId] = { name: null, goal: null, tariff: "base" };
    }

    if (body.type === "donut_subscription_expired" || body.type === "donut_subscription_cancelled") {
      memory[userId].tariff = "base";
    }

    if (levelId && DONUT_LEVELS[levelId]) {
      memory[userId].tariff = DONUT_LEVELS[levelId];
    }

    saveMemory();
    return;
  }

  // ===== MESSAGES =====
  if (body.type === "message_new") {
    handleMessage(body.object.message).catch(console.error);
  }
});

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  const userId = message.from_id;
  const peerId = message.peer_id;
  const text = (message.text || "").trim();
  const now = Date.now();

  if (!memory[userId]) {
    memory[userId] = { name: null, goal: null, tariff: "base" };
    saveMemory();
  }

  const user = memory[userId];

  // ===== FLOOD =====
  if (!limits[userId]) limits[userId] = { last: 0, count: 0, day: today() };

  if (now - limits[userId].last < FLOOD_DELAY) {
    await sendVK(peerId, "Я здесь 😊 Напиши чуть позже");
    return;
  }
  limits[userId].last = now;

  if (limits[userId].day !== today()) {
    limits[userId].count = 0;
    limits[userId].day = today();
  }

  // ===== MENU → VIP =====
  if (MENU_REGEX.test(text) && user.tariff !== "vip") {
    await sendVK(
      peerId,
      `Меню на неделю и месяц доступно в тарифе «Личный ассистент» 💚\n\n${TARIFF_LINKS.vip}`
    );
    return;
  }

  // ===== LIMIT =====
  if (limits[userId].count >= DAILY_LIMITS[user.tariff]) {
    const next = user.tariff === "base" ? "pro" : "vip";
    await sendVK(
      peerId,
      `Ты достиг лимита 😊\nХочешь больше возможностей?\n${TARIFF_LINKS[next]}`
    );
    return;
  }

  if (!ALLOWED_REGEX.test(text)) {
    await sendVK(peerId, "Я помогаю с ПП питанием и рецептами 🥗");
    return;
  }

  // ===== AI =====
  limits[userId].count++;
  startTyping(peerId);

  const ai = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Ты Анна, нутрициолог. Говори тепло и по-человечески." },
        { role: "user", content: text }
      ]
    })
  });

  const data = await ai.json();
  await sendVK(peerId, data.choices?.[0]?.message?.content || "Я рядом 😊");
}

// ===== HELPERS =====
function today() {
  return new Date().toISOString().slice(0, 10);
}

function startTyping(peer_id) {
  fetch("https://api.vk.com/method/messages.setActivity", {
    method: "POST",
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
    body: new URLSearchParams({
      peer_id,
      message: text,
      random_id: Date.now(),
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });
}

// ===== START =====
app.listen(process.env.PORT || 3000, () =>
  console.log("Bot with Donut auto-tariffs is running 🚀")
);
