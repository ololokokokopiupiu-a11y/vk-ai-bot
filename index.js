import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ================= MEMORY ================= */
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

/* ================= TARIFFS ================= */
const TARIFFS = {
  free: { ai: 0, photo: 0, memory: 0 },
  base: { ai: 3, photo: 0, memory: 2 },
  advanced: { ai: 5, photo: 1, memory: 6 },
  assistant: { ai: Infinity, photo: Infinity, memory: 12 }
};

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

/* ================= CALLBACK ================= */
app.post("/", (req, res) => {
  const body = req.body;

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  res.send("ok");

  if (body.type === "message_new") {
    const msg = body.object.message;
    if (msg.from_id > 0) handleMessage(msg).catch(console.error);
  }
});

/* ================= MAIN ================= */
async function handleMessage(message) {
  const userId = message.from_id;
  const peerId = message.peer_id;
  const text = (message.text || "").trim();
  const lower = text.toLowerCase();
  const hasPhoto = message.attachments?.some(a => a.type === "photo");

  /* ===== INIT USER ===== */
  if (!memory[userId]) {
    memory[userId] = {
      tariff: "free",
      dialog: [],
      limits: { day: today(), ai: 0, photo: 0, upsell: false },
      profile: {
        name: null,
        goal: null,
        weight: null
      }
    };
  }

  const user = memory[userId];

  /* ===== DONUT AUTO TARIFF ===== */
  if (message.donut?.is_don) {
    user.tariff = "assistant";
  }

  const plan = TARIFFS[user.tariff];

  /* ===== RESET DAILY LIMITS ===== */
  if (user.limits.day !== today()) {
    user.limits = { day: today(), ai: 0, photo: 0, upsell: false };
  }

  /* ===== PROFILE CAPTURE ===== */
  if (/меня зовут/i.test(lower)) {
    user.profile.name = text.replace(/меня зовут/i, "").trim();
    saveMemory();
    return sendVK(peerId, `Приятно познакомиться, ${user.profile.name} 😊`);
  }

  if (/вешу|мой вес/i.test(lower)) {
    const w = lower.match(/\d{2,3}/);
    if (w) {
      user.profile.weight = w[0];
      saveMemory();
      return sendVK(peerId, `Отлично 💚 Запомнила вес: ${w[0]} кг`);
    }
  }

  if (/похуд|пп|форма/i.test(lower)) {
    user.profile.goal = text;
    saveMemory();
  }

  /* ===== LIMITS ===== */
  if (hasPhoto && user.limits.photo >= plan.photo) {
    return upsell(peerId, user);
  }

  if (user.limits.ai >= plan.ai) {
    return upsell(peerId, user);
  }

  /* ===== MODE DETECT ===== */
  let mode = "assistant";
  if (/рецепт|что приготовить/i.test(lower)) mode = "recipe";
  if (/кбжу|калор|анализ/i.test(lower) || hasPhoto) mode = "analysis";
  if (/прогресс|отчёт/i.test(lower)) mode = "progress";

  /* ===== SYSTEM PROMPT ===== */
  const systemPrompt = `
Ты Анна — живой нутрициолог и персональный ассистент.
Говори естественно, как человек.
Учитывай цель, вес и прошлый диалог.
Режим: ${mode}
`;

  let userContent = text;
  if (hasPhoto) {
    userContent += "\n[Пользователь прислал фото еды — оцени блюдо и КБЖУ.]";
    user.limits.photo++;
  }

  user.dialog.push({ role: "user", content: userContent });

  if (user.dialog.length > plan.memory) {
    user.dialog = user.dialog.slice(-plan.memory);
  }

  startTyping(peerId);

  let answer = "Секунду 😊";

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...user.dialog
        ],
        temperature: 0.7
      })
    });

    const data = await r.json();
    answer = data.choices?.[0]?.message?.content || answer;

    user.dialog.push({ role: "assistant", content: answer });
    user.limits.ai++;
    saveMemory();
  } catch (e) {
    console.error(e);
  }

  await sendVK(peerId, answer);
}

/* ================= UPSELL ================= */
function upsell(peerId, user) {
  if (user.limits.upsell) {
    return sendVK(peerId, "Продолжим завтра 💚");
  }

  user.limits.upsell = true;
  saveMemory();

  return sendVK(
    peerId,
    "💚 Хочешь без ограничений?\nТариф «Личный ассистент» — анализ фото, память диалога и персональные рекомендации 👇\nhttps://vk.com/donut"
  );
}

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot started on port", PORT);
});
