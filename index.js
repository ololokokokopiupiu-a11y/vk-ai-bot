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

const ALLOWED_REGEX =
  /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|перекус|ужин|еда)/i;

// 🔴 Триггеры здоровья → дисклеймер
const HEALTH_REGEX =
  /(здоров|болезн|давлен|диабет|гастрит|жкт|гормон|анализ|боль|противопоказ)/i;

// ===== SMART ANSWERS =====
const SMART_ANSWERS = [
  {
    regex: /(что.*вечером|ужин.*пп)/i,
    answers: [
      "Для ПП ужина подойдут: омлет с овощами, рыба с салатом, творог с ягодами.",
      "Лучший ужин — белок и овощи: курица, яйца, рыба, зелень."
    ]
  },
  {
    regex: /(перекус|что поесть)/i,
    answers: [
      "Хороший перекус: яблоко, йогурт без сахара, яйцо, творог.",
      "Для перекуса выбирай белок + клетчатку."
    ]
  }
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
    await sendVK(peerId, "Подожди пару секунд 🙂");
    return;
  }
  limits[userId].lastMessage = now;

  if (limits[userId].day !== today()) {
    limits[userId].aiCount = 0;
    limits[userId].day = today();
  }

  // --- memory ---
  if (!memory[userId]) {
    memory[userId] = { step: 0, name: null, goal: null };
  }

  const userMemory = memory[userId];

  // ===== ONBOARDING =====
  if (userMemory.step === 0) {
    await sendVK(peerId, "Привет! Я ассистент по ПП питанию. Как тебя зовут?");
    userMemory.step = 1;
    return;
  }

  if (userMemory.step === 1) {
    userMemory.name = text;
    await sendVK(
      peerId,
      `${userMemory.name}, приятно познакомиться.\nКакая цель?\n1 — похудеть\n2 — ПП питание\n3 — поддерживать форму`
    );
    userMemory.step = 2;
    return;
  }

  if (userMemory.step === 2) {
    userMemory.goal =
      /1|похуд/i.test(text)
        ? "похудение"
        : /2|пп/i.test(text)
        ? "ПП питание"
        : "поддержание формы";

    await sendVK(
      peerId,
      "Отлично. Можешь спрашивать про питание, рецепты и КБЖУ."
    );
    userMemory.step = 3;
    return;
  }

  // ===== TOPIC FILTER =====
  if (!ALLOWED_REGEX.test(text)) {
    await sendVK(
      peerId,
      "Я помогаю только с ПП питанием и здоровым образом жизни."
    );
    return;
  }

  // ===== SMART ANSWERS =====
  for (const item of SMART_ANSWERS) {
    if (item.regex.test(text)) {
      let reply =
        item.answers[Math.floor(Math.random() * item.answers.length)];

      if (HEALTH_REGEX.test(text)) {
        reply +=
          "\n\n⚠️ Я не врач, а диетолог-ассистент. При наличии заболеваний обязательно проконсультируйтесь с врачом.";
      }

      await sendVK(peerId, reply);
      return;
    }
  }

  // ===== AI =====
  if (limits[userId].aiCount >= DAILY_AI_LIMIT) {
    await sendVK(peerId, "Лимит персональных ответов на сегодня исчерпан.");
    return;
  }

  startTyping(peerId);

  let answer = "Я уточню и отвечу.";
  try {
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
            {
              role: "system",
              content: `Ты ассистент по ПП питанию. Не давай медицинских диагнозов.`
            },
            { role: "user", content: text }
          ]
        })
      }
    );

    const aiData = await aiResponse.json();
    answer = aiData.choices?.[0]?.message?.content || answer;
    limits[userId].aiCount++;

    if (HEALTH_REGEX.test(text)) {
      answer +=
        "\n\n⚠️ Я не врач, а диетолог-ассистент. При наличии проблем со здоровьем обязательно обратитесь к врачу.";
    }
  } catch (e) {
    console.error("AI error:", e);
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
