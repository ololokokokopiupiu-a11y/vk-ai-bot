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
const VK_GROUP_ID = process.env.VK_GROUP_ID;

/* ================= DONUT ================= */
const DONUT_LINKS = {
  base: "https://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3255",
  advanced: "https://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3256",
  assistant: "https://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3257"
};

/* ================= LIMITS ================= */
const limits = {};
const FLOOD_DELAY = 4000;

const TARIFF_LIMITS = {
  free: { ai: 3, photo: 0, memory: false },
  base: { ai: 5, photo: 0, memory: false },
  advanced: { ai: 10, photo: 1, memory: true },
  assistant: { ai: 9999, photo: 9999, memory: true }
};

/* ================= REGEX ================= */
const FOOD_REGEX =
  /(пп|питани|калор|кбжу|рецепт|белк|жир|углев|куриц|рыб|мяс|рис|греч|ужин|обед|завтрак|калори)/i;

const TARIFF_REGEX = /(мой тариф|какой мой тариф|тариф)/i;

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

/* ================= MAIN ================= */
async function handleMessage(message) {
  const userId = message.from_id;
  const peerId = message.peer_id;
  const text = (message.text || "").trim().toLowerCase();
  const now = Date.now();

  if (!limits[userId]) {
    limits[userId] = { last: 0, ai: 0, day: today() };
  }

  if (now - limits[userId].last < FLOOD_DELAY) return;
  limits[userId].last = now;

  if (limits[userId].day !== today()) {
    limits[userId].ai = 0;
    limits[userId].day = today();
  }

  if (!memory[userId]) {
    memory[userId] = { tariff: "free", dialog: [] };
  }

  const user = memory[userId];

  /* ===== TARIFF ===== */
  user.tariff = await detectTariff(userId);
  saveMemory();

  /* ===== PHOTO EXTRACT ===== */
  const photo = message.attachments
    ?.filter(a => a.type === "photo")
    ?.map(a => a.photo.sizes.sort((a, b) => b.width - a.width)[0]?.url)[0];

  /* ===== PHOTO AI ===== */
  if (photo) {
    if (!hasAccess(user, "photo", userId)) {
      return sendVK(
        peerId,
        "📸 Анализ еды по фото доступен в тарифе «Личный ассистент» 💚\n" +
        DONUT_LINKS.assistant
      );
    }

    startTyping(peerId);

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
            {
              role: "system",
              content:
                "Ты нутрициолог. По фото еды оцени блюда, примерные граммовки и рассчитай калории и КБЖУ. Укажи, что расчёт приблизительный."
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Рассчитай КБЖУ по этому фото еды" },
                { type: "image_url", image_url: { url: photo } }
              ]
            }
          ]
        })
      });

      const data = await r.json();
      const answer =
        data.choices?.[0]?.message?.content ||
        "Не удалось распознать блюдо 😔";

      return sendVK(peerId, answer);
    } catch (e) {
      console.error(e);
      return sendVK(peerId, "Ошибка анализа фото 😔");
    }
  }

  /* ===== TARIFF COMMAND ===== */
  if (TARIFF_REGEX.test(text)) {
    return sendVK(
      peerId,
      `💚 Ваш тариф: «${tariffName(user.tariff)}»\n` +
      tariffDescription(user.tariff) +
      (user.tariff !== "assistant"
        ? `\n\nУлучшить тариф 👇\n${DONUT_LINKS.assistant}`
        : "")
    );
  }

  /* ===== FILTER ===== */
  if (!FOOD_REGEX.test(text)) {
    return sendVK(
      peerId,
      "Я по теме питания 😊\nМогу разобрать рацион, КБЖУ или еду по фото 💚"
    );
  }

  if (!hasAccess(user, "ai", userId)) {
    return sendVK(
      peerId,
      "😊 На сегодня лимит ответов исчерпан.\n\n" +
      "💚 Полный доступ 👇\n" +
      DONUT_LINKS.assistant
    );
  }

  startTyping(peerId);

  /* ===== MEMORY ===== */
  if (TARIFF_LIMITS[user.tariff].memory) {
    user.dialog.push({ role: "user", content: text });
    user.dialog = user.dialog.slice(-10);
  }

  let messages = [
    {
      role: "system",
      content:
        "Ты Анна — живой нутрициолог. Общайся естественно, как человек."
    },
    ...(user.dialog || []),
    { role: "user", content: text }
  ];

  let answer = "Секунду, думаю 😊";

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages
      })
    });

    const data = await r.json();
    answer = data.choices?.[0]?.message?.content || answer;

    limits[userId].ai++;

    if (TARIFF_LIMITS[user.tariff].memory) {
      user.dialog.push({ role: "assistant", content: answer });
    }

    saveMemory();
  } catch (e) {
    console.error(e);
  }

  await sendVK(peerId, answer);
}

/* ================= ACCESS ================= */
function hasAccess(user, feature, userId) {
  if (user.tariff === "assistant") return true;

  const plan = TARIFF_LIMITS[user.tariff] || TARIFF_LIMITS.free;

  if (feature === "ai") return limits[userId].ai < plan.ai;
  if (feature === "photo") return plan.photo > 0;

  return false;
}

/* ================= TARIFF ================= */
async function detectTariff(userId) {
  if (await isAdmin(userId)) return "assistant";

  try {
    const r = await fetch("https://api.vk.com/method/donut.getSubscription", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        owner_id: "-" + VK_GROUP_ID,
        user_id: userId,
        access_token: VK_TOKEN,
        v: "5.199"
      })
    });

    const data = await r.json();
    const level = data.response?.subscription?.level_id;

    if (level === 3257) return "assistant";
    if (level === 3256) return "advanced";
    if (level === 3255) return "base";
  } catch {}

  return "free";
}

async function isAdmin(userId) {
  try {
    const r = await fetch("https://api.vk.com/method/groups.getMembers", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        group_id: VK_GROUP_ID,
        filter: "managers",
        access_token: VK_TOKEN,
        v: "5.199"
      })
    });

    const data = await r.json();
    return data.response?.items?.some(m => m.id === userId);
  } catch {
    return false;
  }
}

/* ================= HELPERS ================= */
function tariffName(t) {
  return {
    free: "Бесплатный",
    base: "Базовый",
    advanced: "Продвинутый",
    assistant: "Личный ассистент"
  }[t];
}

function tariffDescription(t) {
  return {
    free: "Минимальные возможности",
    base: "Расширенные ответы",
    advanced: "КБЖУ + память",
    assistant: "Полный доступ без ограничений ✨"
  }[t];
}

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
  console.log("Bot v1.1 started on port", PORT);
});

