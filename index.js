import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VK_GROUP_ID = process.env.VK_GROUP_ID;

/* ================= LIMITS ================= */
const limits = {};
const FLOOD_DELAY = 3000;

const TARIFF_LIMITS = {
  free: { ai: 5, photo: 0 },
  base: { ai: 10, photo: 0 },
  advanced: { ai: 20, photo: 1 },
  assistant: { ai: 9999, photo: 9999 }
};

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
  const textRaw = (message.text || "").trim();
  const now = Date.now();

  if (!limits[userId]) {
    limits[userId] = { last: 0, ai: 0, photo: 0, day: today() };
  }

  if (now - limits[userId].last < FLOOD_DELAY) return;
  limits[userId].last = now;

  if (limits[userId].day !== today()) {
    limits[userId].ai = 0;
    limits[userId].photo = 0;
    limits[userId].day = today();
  }

  const tariff = await detectTariff(userId);
  const plan = TARIFF_LIMITS[tariff];

  /* ===== GET PHOTO (OWN OR FORWARDED) ===== */
  const photo = getPhotoFromMessage(message);

  if (photo) {
    if (limits[userId].photo >= plan.photo) {
      return sendVK(
        peerId,
        "📸 Анализ фото доступен в тарифе «Личный ассистент» 💚"
      );
    }

    limits[userId].photo++;
    return analyzePhoto(photo, textRaw, peerId);
  }

  /* ===== TEXT ===== */
  if (limits[userId].ai >= plan.ai) {
    return sendVK(
      peerId,
      "😊 Лимит сообщений на сегодня исчерпан.\nХочешь без ограничений — «Личный ассистент» 💚"
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
              "Ты Анна — живой нутрициолог. Отвечай полезно и по делу."
          },
          { role: "user", content: textRaw }
        ]
      })
    });

    const data = await r.json();
    const answer =
      data.choices?.[0]?.message?.content ||
      "Не смогла ответить 😕";

    limits[userId].ai++;
    await sendVK(peerId, answer);
  } catch {
    await sendVK(peerId, "Ошибка ответа 😕");
  }
}

/* ================= PHOTO ================= */
async function analyzePhoto(photo, text, peerId) {
  const sizes = photo.photo.sizes || [];
  const best = sizes.reduce(
    (m, s) => (!m || s.width > m.width ? s : m),
    null
  );

  if (!best?.url) {
    return sendVK(peerId, "Не удалось получить фото 😕");
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
              "Ты Анна — нутрициолог. Определи продукты на фото и рассчитай КБЖУ."
          },
          {
            role: "user",
            content: [
              { type: "text", text: text || "Проанализируй еду" },
              { type: "image_url", image_url: { url: best.url } }
            ]
          }
        ]
      })
    });

    const data = await r.json();
    const answer =
      data.choices?.[0]?.message?.content ||
      "Не смогла разобрать фото 😕";

    await sendVK(peerId, answer);
  } catch {
    await sendVK(peerId, "Ошибка анализа фото 😕");
  }
}

/* ================= HELPERS ================= */
function getPhotoFromMessage(message) {
  const direct = message.attachments?.find(a => a.type === "photo");
  if (direct) return direct;

  for (const fwd of message.fwd_messages || []) {
    const p = fwd.attachments?.find(a => a.type === "photo");
    if (p) return p;
  }

  return null;
}

async function detectTariff(userId) {
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
  console.log("Bot v1.3.1 STABLE started on port", PORT);
});
