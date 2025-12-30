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

/* ================= LIMITS ================= */
const limits = {};
const FLOOD_DELAY = 4000;

const TARIFF_LIMITS = {
  free: { ai: 5, photo: 0, menu: 0 },
  base: { ai: 10, photo: 0, menu: 1 },
  advanced: { ai: 20, photo: 0, menu: 7 },
  vip: { ai: 100, photo: 100, menu: 30 }
};

/* ================= REGEX ================= */
const FOOD_REGEX =
  /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|завтрак|обед|ужин|меню|продукт|куриц|рыб|мяс|рис|греч|ел|ем|съел)/i;
const ABOUT_REGEX = /(ты кто|кто ты|как тебя зовут)/i;
const THANKS_REGEX = /(спасибо|благодарю)/i;

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
  const text = (message.text || "").trim();
  const textLower = text.toLowerCase();
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
    memory[userId] = {
      mode: "onboarding",
      tariff: "free",
      history: [] // 🧠 ПАМЯТЬ ДИАЛОГА
    };
    saveMemory();
  }

  const user = memory[userId];

  /* ================= PHOTO ================= */
  if (message.attachments?.some(a => a.type === "photo")) {
    if (!checkAccess(user, "photo", userId)) {
      return sendVK(
        peerId,
        "Я вижу фото 😊\nАнализ еды доступен в тарифе «Личный ассистент» 💚\nhttps://vk.com/pp_recepty_vk?w=donut_payment-" +
          VK_GROUP_ID
      );
    }
    user.mode = "dialog";
    saveMemory();
    return sendVK(peerId, "Фото принято 📸 Хочешь разобрать КБЖУ?");
  }

  /* ================= SERVICE ================= */
  if (ABOUT_REGEX.test(textLower)) {
    return sendVK(peerId, "Я Анна 😊 Нутрициолог. Помогаю с ПП и похудением 💚");
  }

  if (THANKS_REGEX.test(textLower)) {
    return sendVK(peerId, "Всегда рада помочь 💚");
  }

  /* ================= ONBOARDING ================= */
  if (user.mode === "onboarding") {
    user.mode = "dialog";
    saveMemory();
    return sendVK(peerId, "Привет 😊 Я Анна. Чем могу помочь по питанию?");
  }

  /* ================= AI LOGIC ================= */

  if (!checkAccess(user, "ai", userId)) {
    return sendVK(peerId, "На сегодня лимит ответов исчерпан 😊");
  }

  startTyping(peerId);

  // 🧠 сохраняем историю (последние 6 сообщений)
  user.history.push({ role: "user", content: text });
  user.history = user.history.slice(-6);
  saveMemory();

  let softRedirect = false;
  if (!FOOD_REGEX.test(textLower)) {
    softRedirect = true;
  }

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
        messages: [
          {
            role: "system",
            content: `
Ты Анна — живой нутрициолог.
Общайся естественно, как человек.
Помни контекст диалога.
Если пользователь уходит в оффтоп — мягко верни разговор к питанию,
но всегда отвечай на его сообщение.
Не повторяй одни и те же фразы.
`
          },
          ...user.history,
          ...(softRedirect
            ? [
                {
                  role: "system",
                  content:
                    "Пользователь ушёл в оффтоп. Мягко верни разговор к теме питания."
                }
              ]
            : [])
        ]
      })
    });

    const data = await r.json();
    answer = data.choices?.[0]?.message?.content || answer;
    limits[userId].ai++;

    user.history.push({ role: "assistant", content: answer });
    user.history = user.history.slice(-6);
    saveMemory();
  } catch (e) {
    console.error(e);
  }

  await sendVK(peerId, answer);
}

/* ================= ACCESS ================= */
function checkAccess(user, feature, userId) {
  const plan = TARIFF_LIMITS[user.tariff || "free"];
  if (!plan) return false;
  if (feature === "ai") return limits[userId].ai < plan.ai;
  if (feature === "photo") return plan.photo > 0;
  if (feature === "menu") return plan.menu > 0;
  return false;
}

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

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot started on port", PORT);
});
