import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ================= CALLBACK ================= */
app.post("/", async (req, res) => {
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
  const peerId = message.peer_id;
  const textRaw = (message.text || "").trim();

  /* ===== PHOTO PRIORITY ===== */
  const photo = message.attachments?.find(a => a.type === "photo");

  if (photo) {
    return analyzePhoto(photo, textRaw, peerId);
  }

  /* ===== EMPTY MESSAGE ===== */
  if (!textRaw) return;

  startTyping(peerId);

  const messages = [
    {
      role: "system",
      content:
        "Ты Анна — живой нутрициолог. Отвечай дружелюбно, понятно и по делу."
    },
    { role: "user", content: textRaw }
  ];

  let answer;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages
      })
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("OpenAI error:", r.status, err);
      throw new Error("OpenAI failed");
    }

    const data = await r.json();
    answer = data.choices?.[0]?.message?.content;
  } catch (e) {
    console.error("AI ERROR:", e.message);
  }

  if (!answer) {
    answer = "Я здесь 😊 Напиши запрос чуть подробнее.";
  }

  await sendVK(peerId, answer);
}

/* ================= PHOTO ANALYSIS ================= */
async function analyzePhoto(photo, text, peerId) {
  const sizes = photo.photo?.sizes || [];
  const best = sizes.reduce(
    (m, s) => (!m || s.width > m.width ? s : m),
    null
  );

  if (!best?.url) {
    return sendVK(peerId, "Не удалось получить фото 😕");
  }

  startTyping(peerId);

  let answer;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content:
              "Ты Анна — нутрициолог. Определи продукты на фото и рассчитай примерное КБЖУ."
          },
          {
            role: "user",
            content: [
              { type: "text", text: text || "Проанализируй еду на фото" },
              { type: "image_url", image_url: { url: best.url } }
            ]
          }
        ]
      })
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("Vision error:", r.status, err);
      throw new Error("Vision failed");
    }

    const data = await r.json();
    answer = data.choices?.[0]?.message?.content;
  } catch (e) {
    console.error("PHOTO ERROR:", e.message);
  }

  if (!answer) {
    answer = "Не смогла разобрать фото 😕 Попробуй другое.";
  }

  await sendVK(peerId, answer);
}

/* ================= HELPERS ================= */
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
  console.log("Bot v1.3.1 started");
});
