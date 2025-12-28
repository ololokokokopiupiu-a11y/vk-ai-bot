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
const FLOOD_DELAY = 5000;
const DAILY_AI_LIMIT = 10;
const ALLOWED_REGEX = /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|здоров|продукт)/i;
const THANKS_REGEX = /(спасибо|благодар|thanks)/i;
const BYE_REGEX = /(пока|до свид|увидимся)/i;

// ===== PHRASES =====
const greetings = [
  "Привет! Я Анна, нутрициолог 😊",
  "Рада тебя видеть! Я Анна 🌿",
  "Привет! Давай разберёмся с питанием вместе 🥗"
];

const thanksReplies = [
  "Пожалуйста! Рада была помочь 💚",
  "Всегда рада помочь 😊",
  "Обращайся, если появятся вопросы 🌿"
];

const byeReplies = [
  "Хорошего дня! Береги себя 💚",
  "До связи! Я рядом, если что 😊",
  "Удачи тебе и лёгкого ПП дня 🥗"
];

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

  // --- limits ---
  if (!limits[userId]) {
    limits[userId] = { lastMessage: 0, aiCount: 0, day: today() };
  }

  if (now - limits[userId].lastMessage < FLOOD_DELAY) {
    await sendVK(peerId, "Дай мне пару секунд 😊");
    return;
  }
  limits[userId].lastMessage = now;

  if (limits[userId].day !== today()) {
    limits[userId].aiCount = 0;
    limits[userId].day = today();
  }

  // --- memory ---
  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      goal: null,
      history: [],
      step: 0,
      tariff: "FREE"
    };
  }

  const user = memory[userId];

  // ===== THANKS / BYE =====
  if (THANKS_REGEX.test(text)) {
    await sendVK(peerId, random(thanksReplies));
    return;
  }

  if (BYE_REGEX.test(text)) {
    await sendVK(peerId, random(byeReplies));
    return;
  }

  // ===== ONBOARDING =====
  if (user.step === 0) {
    await sendVK(peerId, random(greetings) + "\nКак тебя зовут?");
    user.step = 1;
    return;
  }

  if (user.step === 1) {
    user.name = text;
    await sendVK(
      peerId,
      `${user.name}, приятно познакомиться 😊\nКакая у тебя цель?\n1️⃣ Похудеть\n2️⃣ ПП питание\n3️⃣ Поддерживать форму`
    );
    user.step = 2;
    return;
  }

  if (user.step === 2) {
    user.goal = /1|похуд/i.test(text)
      ? "похудение"
      : /2|пп/i.test(text)
      ? "ПП питание"
      : "поддержание формы";

    await sendVK(
      peerId,
      "Отлично 💚\nМожешь писать продукты, блюда или задавать вопросы по ПП"
    );
    user.step = 3;
    return;
  }

  // ===== LIMIT CHECK =====
  if (limits[userId].aiCount >= DAILY_AI_LIMIT) {
    await sendVK(
      peerId,
      "На сегодня я дала максимум ответов 😊\nВ расширенных тарифах лимитов больше — если будет интересно, расскажу 💚"
    );
    return;
  }

  if (!ALLOWED_REGEX.test(text)) {
    await sendVK(
      peerId,
      "Я помогаю только с ПП питанием и здоровыми привычками 🌿"
    );
    return;
  }

  user.history.push(text);
  if (user.history.length > 6) user.history.shift();

  startTyping(peerId);

  let answer = "Сейчас подумаю 😊";

  try {
    const systemPrompt = `
Ты — Анна, девушка-нутрициолог с практическим опытом.
Общайся как живой человек, тепло и поддерживающе.

Пользователь:
Имя: ${user.name}
Цель: ${user.goal}
Тариф: ${user.tariff}

Правила:
— отвечай развернуто, но понятно
— если перечислены продукты — предложи рецепт
— если вопрос о здоровье — добавь дисклеймер
— не выходи за тему ПП
— можешь мягко упоминать расширенные возможности тарифов
— НЕ будь сухой

Дисклеймер:
Ты не врач. При проблемах со здоровьем советуй обратиться к врачу.
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
            ...user.history.map(t => ({ role: "user", content: t }))
          ]
        })
      }
    );

    const aiData = await aiResponse.json();
    answer = aiData.choices?.[0]?.message?.content || answer;
    limits[userId].aiCount++;
  } catch (e) {
    console.error("OpenAI error:", e);
  }

  await sendVK(peerId, answer);
}

// ===== HELPERS =====
function today() {
  return new Date().toISOString().slice(0, 10);
}

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function startTyping(peer_id) {
  fetch("https://api.vk.com/method/messages.setActivity", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id: peer_id.toString(),
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
      peer_id: peer_id.toString(),
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
