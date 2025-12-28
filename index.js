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

const ALLOWED_REGEX =
  /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|завтрак|обед|ужин|продукт|есть дома)/i;

const ABOUT_BOT_REGEX =
  /(ты кто|кто ты|тебя зовут|как тебя зовут|ты бот|ты анна)/i;

const THANKS_REGEX =
  /(спасибо|благодарю|thanks|сенкс)/i;

const BYE_REGEX =
  /(пока|до свидания|увидимся|спокойной ночи)/i;

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
    limits[userId] = { last: 0, count: 0, day: today() };
  }

  if (now - limits[userId].last < FLOOD_DELAY) {
    await sendVK(peerId, "Я здесь 😊 Напиши чуть позже");
    return;
  }
  limits[userId].last = now;

  if (limits[userId].day !== today()) {
    limits[userId].count = 0;
    limits[userId].day = today();
  }

  // --- memory ---
  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      goal: null,
      history: [],
      step: 0
    };
  }

  const user = memory[userId];

  // ===== ABOUT BOT =====
  if (ABOUT_BOT_REGEX.test(text)) {
    await sendVK(
      peerId,
      "Меня зовут Анна 😊\nЯ виртуальный нутрициолог и помогаю с ПП питанием, рецептами и полезными привычками.\n\nХочешь — подберу рецепт из твоих продуктов 🥗"
    );
    return;
  }

  // ===== THANKS =====
  if (THANKS_REGEX.test(text)) {
    await sendVK(
      peerId,
      "Пожалуйста 😊 Рада быть полезной. Если понадобится помощь с питанием — я рядом 🥗"
    );
    return;
  }

  // ===== GOODBYE =====
  if (BYE_REGEX.test(text)) {
    await sendVK(
      peerId,
      "Хорошего дня 😊 Береги себя и питайся с заботой ❤️"
    );
    return;
  }

  // ===== ONBOARDING =====
  if (user.step === 0) {
    await sendVK(peerId, "Привет! Я Анна — нутрициолог 😊 Как тебя зовут?");
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
    if (/1|похуд/i.test(text)) user.goal = "похудение";
    else if (/2|пп/i.test(text)) user.goal = "ПП питание";
    else user.goal = "поддержание формы";

    await sendVK(
      peerId,
      "Отлично 👍 Я запомнила.\nНапиши, какие продукты есть дома, или задай вопрос по ПП 🥗"
    );
    user.step = 3;
    return;
  }

  // ===== AFTER ONBOARDING =====
  if (!ALLOWED_REGEX.test(text)) {
    await sendVK(
      peerId,
      "Я помогаю только с ПП питанием и похудением 🥗"
    );
    return;
  }

  if (limits[userId].count >= DAILY_AI_LIMIT) {
    await sendVK(
      peerId,
      "На сегодня лимит персональных ответов исчерпан 😊 Продолжим завтра!"
    );
    return;
  }

  user.history.push(text);
  if (user.history.length > 6) user.history.shift();

  startTyping(peerId);

  let answer = "Секунду, думаю над ответом 😊";

  try {
    const systemPrompt = `
Ты — Анна, виртуальный нутрициолог.
Говори тепло, по-человечески.
Помогай с ПП питанием, рецептами, КБЖУ.
Если перечислены продукты — предложи рецепт из них.
Если вопрос о здоровье — добавь дисклеймер, что ты не врач.
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
    limits[userId].count++;

  } catch (e) {
    console.error("OpenAI error:", e);
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
