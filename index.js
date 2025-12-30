import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// ===== FILE STORAGE =====
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

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== LIMITS =====
const limits = {};

// ===== SETTINGS =====
const FLOOD_DELAY = 4000;
const DAILY_AI_LIMIT = 10;

const ALLOWED_REGEX =
  /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|завтрак|обед|ужин|продукт|есть дома)/i;

const PROGRESS_REGEX =
  /(похуд|минус|сброс|стал лучше|держусь|не срываюсь|ем пп|результат)/i;

const ABOUT_BOT_REGEX =
  /(ты кто|кто ты|тебя зовут|как тебя зовут|ты бот|ты анна)/i;

const THANKS_REGEX =
  /(спасибо|благодарю|thanks|сенкс)/i;

const BYE_REGEX =
  /(пока|до свидания|увидимся|спокойной ночи)/i;

// ===== NAME VALIDATION =====
const BAD_NAMES = ["привет", "йцукен", "asdf", "qwerty", "да", "нет", "ок"];

function isValidName(text) {
  if (!text) return false;
  const name = text.trim().toLowerCase();
  if (name.length < 2 || name.length > 20) return false;
  if (!/^[a-zа-яё]+$/i.test(name)) return false;
  if (BAD_NAMES.includes(name)) return false;
  return true;
}

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
      step: 0,
      tariff: "base", // base | vip
      progressNotes: [],
      lastProgressAsk: 0,
      lastWeeklyReport: 0
    };
    saveMemory();
  }

  const user = memory[userId];

  // ===== ABOUT BOT =====
  if (ABOUT_BOT_REGEX.test(text)) {
    await sendVK(peerId, "Меня зовут Анна 😊 Я нутрициолог и помогаю с ПП питанием 🥗");
    return;
  }

  // ===== THANKS =====
  if (THANKS_REGEX.test(text)) {
    await sendVK(peerId, "Пожалуйста 😊 Я рядом, если понадобится помощь 🥗");
    return;
  }

  // ===== GOODBYE =====
  if (BYE_REGEX.test(text)) {
    await sendVK(peerId, "Хорошего дня 😊 Продолжай заботиться о себе ❤️");
    return;
  }

  // ===== ONBOARDING =====
  if (user.step === 0) {
    await sendVK(peerId, "Привет! Я Анна — нутрициолог 😊 Как тебя зовут?");
    user.step = 1;
    saveMemory();
    return;
  }

  if (user.step === 1) {
    if (!isValidName(text)) {
      await sendVK(peerId, "Подскажи, пожалуйста, именно имя 😊");
      return;
    }
    user.name = text;
    user.step = 2;
    saveMemory();
    await sendVK(
      peerId,
      `${user.name}, приятно познакомиться 😊\nКакая у тебя цель?\n1️⃣ Похудеть\n2️⃣ ПП питание\n3️⃣ Поддерживать форму`
    );
    return;
  }

  if (user.step === 2) {
    if (/1|похуд/i.test(text)) user.goal = "похудение";
    else if (/2|пп/i.test(text)) user.goal = "ПП питание";
    else user.goal = "поддержание формы";

    user.step = 3;
    saveMemory();
    await sendVK(
      peerId,
      "Отлично 👍 Я запомнила.\nПиши продукты или задавай вопросы 🥗"
    );
    return;
  }

  // ===== PROGRESS MESSAGE =====
  if (PROGRESS_REGEX.test(text)) {
    user.progressNotes.push({
      text,
      date: new Date().toISOString()
    });
    user.lastProgressAsk = Date.now();
    saveMemory();

    await sendVK(
      peerId,
      `${user.name}, это очень круто 💚 Я правда рада твоему прогрессу!`
    );
    return;
  }

  // ===== AFTER ONBOARDING =====
  if (!ALLOWED_REGEX.test(text)) {
    await sendVK(peerId, "Я помогаю только с ПП питанием 🥗");
    return;
  }

  if (limits[userId].count >= DAILY_AI_LIMIT) {
    await sendVK(peerId, "На сегодня лимит ответов исчерпан 😊");
    return;
  }

  startTyping(peerId);

  let answer = "Секунду, думаю 😊";

  try {
    const systemPrompt = `
Ты — Анна, нутрициолог.
Говори тепло и поддерживающе.
Если пользователь уже добивался прогресса — мягко хвали.
Помогай с ПП питанием, рецептами и КБЖУ.
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
            { role: "user", content: text }
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

// ===== BACKGROUND CHECKS =====
setInterval(async () => {
  const now = Date.now();

  for (const userId in memory) {
    const user = memory[userId];

    // 🔔 Progress reminder (every 3 days)
    if (
      user.step >= 3 &&
      now - user.lastProgressAsk > 3 * 24 * 60 * 60 * 1000
    ) {
      await sendVK(
        userId,
        `${user.name || "Привет"} 😊 Как у тебя сейчас дела с питанием? Есть ли небольшие результаты?`
      );
      user.lastProgressAsk = now;
    }

    // 👑 Weekly report for VIP
    if (
      user.tariff === "vip" &&
      now - user.lastWeeklyReport > 7 * 24 * 60 * 60 * 1000
    ) {
      await sendVK(
        userId,
        `${user.name}, подведём итоги недели 💚\nТы держишь фокус на цели «${user.goal}». Продолжай — результат обязательно будет 🙌`
      );
      user.lastWeeklyReport = now;
    }
  }

  saveMemory();
}, 60 * 60 * 1000); // проверка раз в час

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
