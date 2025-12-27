import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");
console.log("OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");

// ===== CALLBACK =====
app.post("/", (req, res) => {
  const body = req.body;
  console.log("EVENT TYPE:", body.type);

  // 1️⃣ Confirmation
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // 2️⃣ VK должен получить OK сразу
  res.send("ok");

  // 3️⃣ Обработка сообщения асинхронно
  if (body.type === "message_new") {
    const message = body.object.message;

    // не отвечаем группам и ботам
    if (message.from_id <= 0) return;

    handleMessage(message).catch(err => {
      console.error("handleMessage error:", err);
    });
  }
});

// ===== TYPING =====
async function sendTyping(peer_id) {
  await fetch("https://api.vk.com/method/messages.setActivity", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      peer_id: peer_id.toString(),
      type: "typing",
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });
}

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  // 🔹 typing СРАЗУ
  await sendTyping(message.peer_id);

  // 🔹 обновляем typing, если OpenAI думает долго
  const typingInterval = setInterval(() => {
    sendTyping(message.peer_id);
  }, 4000);

  const userText = message.text || "…";
  let answer = "Я пока не могу ответить 🤖";

  // --- OpenAI ---
  if (OPENAI_API_KEY) {
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
            max_tokens: 200,
            messages: [
              {
                role: "system",
                content: "Ты дружелюбный VK-бот и отвечаешь кратко и понятно."
              },
              { role: "user", content: userText }
            ]
          })
        }
      );

      const aiData = await aiResponse.json();
      answer = aiData.choices?.[0]?.message?.content || answer;

    } catch (e) {
      console.error("OpenAI error:", e);
    }
  }

  // 🔹 останавливаем typing
  clearInterval(typingInterval);

  // --- VK ---
  await sendVK(message.peer_id, answer);
}

// ===== SEND TO VK =====
async function sendVK(peer_id, text) {
  const params = new URLSearchParams({
    peer_id: peer_id.toString(),
    message: text,
    random_id: Date.now().toString(),
    access_token: VK_TOKEN,
    v: "5.199"
  });

  const vkResponse = await fetch(
    "https://api.vk.com/method/messages.send",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    }
  );

  const vkData = await vkResponse.json();
  console.log("VK SEND RESPONSE:", vkData);
}

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
