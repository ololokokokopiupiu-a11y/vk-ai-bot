import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ================= CALLBACK ================= */
app.post("/", (req, res) => {
  const body = req.body;

  // подтверждение VK
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // ВСЕГДА сразу отвечаем VK
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
  const text = (message.text || "").trim();

  if (!text) return;

  startTyping(peerId);

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
            content:
              "Ты дружелюбный умный ассистент. Отвечай понятно и по делу."
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    const data = await r.json();
    answer = data.choices?.[0]?.message?.content || answer;
  } catch (e) {
    console.error("OpenAI error:", e);
    answer = "Произошла ошибка 😔 Попробуй ещё раз.";
  }

  await sendVK(peerId, answer);
}

/* ================= VK HELPERS ================= */
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
  console.log("Simple AI bot started on port", PORT);
});
