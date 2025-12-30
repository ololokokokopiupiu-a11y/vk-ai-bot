import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// ===== STORAGE =====
const MEMORY_FILE = "./memory.json";
let memory = fs.existsSync(MEMORY_FILE)
  ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"))
  : {};

const saveMemory = () =>
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== LIMITS =====
const limits = {};
const DAILY_AI_LIMIT = 10;
const FLOOD_DELAY = 4000;

// ===== REGEX =====
const MENU_REGEX = /(меню).*(недел|7)/i;
const ALLOWED_REGEX =
  /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|завтрак|обед|ужин|меню|продукт|фото)/i;

const ABOUT_REGEX = /(ты кто|кто ты|как тебя зовут)/i;
const THANKS_REGEX = /(спасибо|благодарю)/i;

// ===== CALLBACK =====
app.post("/", async (req, res) => {
  const body = req.body;

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  res.send("ok");

  // ===== VK DONUT EVENTS =====
  if (body.type?.startsWith("donut_")) {
    handleDonutEvent(body);
    return;
  }

  if (body.type === "message_new") {
    const msg = body.object.message;
    if (msg.from_id > 0) {
      handleMessage(msg).catch(console.error);
    }
  }
});

// ===== DONUT HANDLER =====
function handleDonutEvent(body) {
  const userId = body.object.user_id;
  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      step: 0,
      tariff: "vip"
    };
  }

  if (body.type === "donut_subscription_create") {
    memory[userId].tariff = "vip";
    sendVK(userId, "💚 Спасибо за подписку!\nТеперь тебе доступен «Личный ассистент» 👑");
  }

  if (
    body.type === "donut_subscription_expired" ||
    body.type === "donut_subscription_cancelled"
  ) {
    memory[userId].tariff = "base";
    sendVK(
      userId,
      "Подписка завершилась 😊\nТы всегда можешь снова подключить «Личный ассистент» 💚"
    );
  }

  saveMemory();
}

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  const userId = message.from_id;
  const peerId = message.peer_id;
  const text = (message.text || "").trim();
  const now = Date.now();

  // ===== LIMITS =====
  if (!limits[userId]) {
    limits[userId] = { last: 0, count: 0, day: today() };
  }

  if (now - limits[userId].last < FLOOD_DELAY) return;
  limits[userId].last = now;

  if (limits[userId].day !== today()) {
    limits[userId].count = 0;
    limits[userId].day = today();
  }

  // ===== MEMORY =====
  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      step: 0,
      tariff: "base"
    };
    saveMemory();
  }

  const user = memory[userId];
  const hasPhoto = message.attachments?.some(a => a.type === "photo");

  // ===== PHOTO (VIP ONLY) =====
  if (hasPhoto && user.tariff !== "vip") {
    return sendVK(
      peerId,
      "📸 Анализ еды по фото доступен в тарифе «Личный ассистент» 💚\nhttps://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3257"
    );
  }

  // ===== HUMAN =====
  if (ABOUT_REGEX.test(text)) {
    return sendVK(peerId, "Я Анна 😊 Нутрициолог. Помогаю с ПП и похудением 💚");
  }

  if (THANKS_REGEX.test(text)) {
    return sendVK(peerId, "Всегда рада помочь 💚");
  }

  // ===== ONBOARDING =====
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
    user.step = 3;
    saveMemory();
    return sendVK(
      peerId,
      "Отлично 🔥 Пиши продукты или задавай вопросы — я рядом 🥗"
    );
  }

  // ===== MENU =====
  if (MENU_REGEX.test(text) && user.tariff !== "vip") {
    return sendVK(
      peerId,
      "Меню на неделю доступно в тарифе «Личный ассистент» 💚\nhttps://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3257"
    );
  }

  // ===== FILTER =====
  if (!ALLOWED_REGEX.test(text)) {
    return sendVK(peerId, "Я подсказываю только по ПП питанию 🥗");
  }

  if (limits[userId].count >= DAILY_AI_LIMIT) {
    return sendVK(peerId, "На сегодня лимит ответов исчерпан 😊");
  }

  startTyping(peerId);

  // ===== AI =====
  let answer = "Секунду, думаю 😊";

  try {
    const systemPrompt = `
Ты Анна — живой нутрициолог.
Отвечай тепло, по-человечески.
VIP — без ограничений.
FREE — мягко подталкивай к подписке.
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: \`Bearer \${OPENAI_API_KEY}\`,
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
    limits[userId].count++;
  } catch (e) {
    console.error(e);
  }

  return sendVK(peerId, answer);
}

// ===== HELPERS =====
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
      random_id: Date.now(),
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });
}

// ===== START =====
app.listen(process.env.PORT || 3000, () =>
  console.log("Bot started with VK Donut")
);
