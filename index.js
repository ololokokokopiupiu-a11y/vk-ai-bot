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

/* ================= DONUT LINKS ================= */
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
  advanced: { ai: 10, photo: 0, memory: true },
  assistant: { ai: 9999, photo: 9999, memory: true }
};

/* ================= REGEX ================= */
const FOOD_REGEX =
  /(пп|питани|калор|кбжу|рецепт|белк|жир|углев|куриц|рыб|мяс|рис|греч|ужин|обед|завтрак)/i;
const MY_TARIFF_REGEX = /(мой тариф|подписк)/i;

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

  /* ===== AUTO TARIFF ===== */
  user.tariff = await detectTariff(userId);
  saveMemory();

  /* ===== МОЙ ТАРИФ ===== */
  if (MY_TARIFF_REGEX.test(text)) {
    return sendVK(
      peerId,
      tariffText(user.tariff),
      tariffKeyboard(user.tariff)
    );
  }

  /* ===== PHOTO ===== */
  if (message.attachments?.some(a => a.type === "photo")) {
    if (!hasAccess(user, "photo", userId)) {
      return sendVK(
        peerId,
        "📸 Анализ еды по фото доступен в тарифе «Личный ассистент» 💚",
        assistantKeyboard()
      );
    }
  }

  if (!FOOD_REGEX.test(text)) {
    return sendVK(
      peerId,
      "Я помогаю по питанию 🥗\nМожем разобрать рацион или КБЖУ 💚"
    );
  }

  if (!hasAccess(user, "ai", userId)) {
    return sendVK(
      peerId,
      "😊 Лимит ответов на сегодня исчерпан",
      upgradeKeyboard(user.tariff)
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
        "Ты Анна — живой нутрициолог. Общайся тепло, логично и по делу."
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

    const level = (await r.json()).response?.subscription?.level_id;
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

    return (await r.json()).response?.items?.some(m => m.id === userId);
  } catch {
    return false;
  }
}

/* ================= UI ================= */
function tariffText(tariff) {
  return {
    free: "Ваш тариф: Бесплатный\n• 3 ответа в день",
    base: "Ваш тариф: Базовый\n• 5 ответов в день",
    advanced: "Ваш тариф: Продвинутый\n• 10 ответов\n• Память диалога",
    assistant: "💚 Личный ассистент\n• Без ограничений\n• Анализ фото"
  }[tariff];
}

function upgradeKeyboard(tariff) {
  if (tariff === "assistant") return null;
  return {
    inline: true,
    buttons: [
      [
        {
          action: {
            type: "open_link",
            link: DONUT_LINKS.advanced,
            label: "✨ Продвинутый"
          }
        }
      ],
      [
        {
          action: {
            type: "open_link",
            link: DONUT_LINKS.assistant,
            label: "💚 Личный ассистент"
          }
        }
      ]
    ]
  };
}

function assistantKeyboard() {
  return {
    inline: true,
    buttons: [
      [
        {
          action: {
            type: "open_link",
            link: DONUT_LINKS.assistant,
            label: "💚 Подключить ассистента"
          }
        }
      ]
    ]
  };
}

function tariffKeyboard(tariff) {
  return upgradeKeyboard(tariff);
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

async function sendVK(peer_id, text, keyboard = null) {
  await fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id,
      message: text,
      random_id: Date.now().toString(),
      access_token: VK_TOKEN,
      v: "5.199",
      ...(keyboard ? { keyboard: JSON.stringify(keyboard) } : {})
    })
  });
}

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot started on port", PORT);
});

