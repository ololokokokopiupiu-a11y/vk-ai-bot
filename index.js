import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== LOG =====
console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");
console.log("OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");

// ===== MEMORY & LIMITS =====
const memory = {};
const limits = {};

// ===== SETTINGS =====
const FLOOD_DELAY = 4000;
const DAILY_AI_LIMIT = 10;

// ===== CALLBACK =====
app.post("/", (req, res) => {
  const body = req.body;

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  res.send("ok");

  if (body.type === "message_new") {
    const message = body.object.message;
    if (message.from_id <= 0) return;
    handleMessage(message).catch(console.error);
  }
});

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  const userId = message.from_id;
  const peerId = message.peer_id;
  const text = (message.text || "").trim();
  const now = Date.now();

  // ---- limits ----
  if (!limits[userId]) {
    limits[userId] = { last: 0, count: 0, day: today() };
  }

  if (now - limits[userId].last < FLOOD_DELAY) {
    await sendVK(peerId, "Подожди пару секунд 🙂");
    return;
  }
  limits[userId].last = now;

  if (limits[userId].day !== today()) {
    limits[userId].count = 0;
    limits[userId].day = today();
  }

  // ---- memory ----
  if (!memory[userId]) {
    memory[userId] = { name: null, goal: null, step: 0, history: [] };
  }

  const user = memory[userId];

  // ===== ONBOARDING =====
  if (user.step === 0) {
    await sendVK(peerId, "Привет! Я ассистент по правильному питанию.\nКак тебя зовут?");
    user.step = 1;
    return;
  }

  if (user.step === 1) {
    user.name = text;
    await sendVK(
      peerId,
      `${user.name}, приятно познакомиться.\nКакая цель?\n1 — похудеть\n2 — ПП питание\n3 — поддерживать форму`
    );
    user.step = 2;
    return;
  }

  if (user.step === 2) {
    if (/1|похуд/i.test(text)) user.goal = "похудение";
    else if (/2|пп/i.test(text)) user.goal = "ПП питание";
    else user.goal = "поддержание формы";

    await sendVK(peerId, "Отлично 👍 Можешь писать продукты, рецепты или вопросы по питанию.");
    user.step = 3;
    return;
  }

  // ===== ПОСЛЕ ОНБОРДИНГА =====

  if (limits[userId].count >= DAILY_AI_LIMIT) {
    await sendVK(peerId, "На сегодня лимит ответов исчерпан. Продолжим завтра 🙂");
    return;
  }

  // ---- Определяем список продуктов ----
  const isProductList =
    text.includes(",") ||
    text.split(" ").length <= 7;

  user.history.push(text);
  if (user.history.length > 5) user.history.shift();

  startTyping(peerId);

  let answer = "Я помогу с ПП питанием.";

  try {
    const systemPrompt = `
Ты — дружелюбный персональный ассистент по ПП питанию.

Имя пользователя: ${user.name}
Цель: ${user.goal}

ПРАВИЛА:
- Ты отвечаешь ТОЛЬКО про питание, рецепты, похудение и здоровье
- Если пользователь перечисляет продукты — предложи ПП-рецепт
- Отвечай живо, тепло, не сухо
- Если вопрос не по теме — мягко переведи в питание
- В конце можно задать 1 уточняющий вопрос

СТИЛЬ:
- как живой диетолог
- без отказов
- без фраз "я не могу"
`;

    const aiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: isProductList ? `У меня есть: ${text}. Что можно приготовить?` : text }
          ]
        })
      }
    );

    const aiData = await aiResponse.json();
    answer = aiData.choices?.[0]?.message?.content || answer;
    limits[userId].count++;

  } catch (e) {
    console.error(e);
  }

  await sendVK(peerId, answer);
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
      random_id: Date.now().toString(),
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });
}

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
