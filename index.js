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
// memory[userId] = { name, goal, history, step }
// limits[userId] = { lastMessage, aiCount, day }

// ===== SETTINGS =====
const FLOOD_DELAY = 5000;
const DAILY_AI_LIMIT = 10;
const ALLOWED_REGEX = /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|здоров)/i;

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
  const text = message.text || "";
  const now = Date.now();

  // --- limits init ---
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

  // --- memory init ---
  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      goal: null,
      history: [],
      step: 0
    };
  }

  const userMemory = memory[userId];

  // ===== ONBOARDING =====
  if (userMemory.step === 0) {
    await sendVK(
      peerId,
      "Привет! Я ассистент по ПП питанию 🥗\nКак тебя зовут?"
    );
    userMemory.step = 1;
    return;
  }

  if (userMemory.step === 1) {
    userMemory.name = text.trim();
    await sendVK(
      peerId,
      `${userMemory.name}, приятно познакомиться 😊\nКакая у тебя цель?\n\n1️⃣ Похудеть\n2️⃣ ПП питание\n3️⃣ Поддерживать форму`
    );
    userMemory.step = 2;
    return;
  }

  if (userMemory.step === 2) {
    if (/1|похуд/i.test(text)) userMemory.goal = "похудение";
    else if (/2|пп/i.test(text)) userMemory.goal = "ПП питание";
    else userMemory.goal = "поддержание формы";

    await sendVK(
      peerId,
      `Отлично 👍 Я запомнил.\nМожешь спросить меня, например:\n— ПП ужин\n— Рецепт из продуктов\n— КБЖУ завтрака`
    );
    userMemory.step = 3;
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

  if (limits[userId].aiCount >= DAILY_AI_LIMIT) {
    await sendVK(
      peerId,
      "На сегодня я уже дал максимум персональных ответов 😊\nПродолжим завтра!"
    );
    return;
  }

  userMemory.history.push(text);
  if (userMemory.history.length > 6) userMemory.history.shift();

  startTyping(peerId);

  let answer = "Я пока не могу ответить 🤖";

  try {
    const systemPrompt = `
Ты — персональный ассистент по ПП питанию.
Имя: ${userMemory.name}
Цель: ${userMemory.goal}
Отвечай дружелюбно и по делу.
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
            ...userMemory.history.map(t => ({ role: "user", content: t }))
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
