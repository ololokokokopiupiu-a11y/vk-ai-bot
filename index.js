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

  // 2️⃣ VK должен получить OK СРАЗУ
  res.send("ok");

  // 3️⃣ Обрабатываем сообщение асинхронно
  if (body.type === "message_new") {
    const message = body.object.message;

    // защита от ботов и групп
    if (message.from_id <= 0) return;

    handleMessage(message).catch(err => {
      console.error("handleMessage error:", err);
    });
  }
});

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  const userText = message.text?.trim() || "";

  let answer =
    "Привет 😊\n" +
    "Я помощник по правильному питанию.\n" +
    "Могу подсказать ПП-рецепты, идеи для похудения и помочь разобраться с рационом.\n\n" +
    "Напиши, что тебя интересует 👇";

  // ---- OpenAI ----
  if (OPENAI_API_KEY && userText.length > 0) {
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
            messages: [
              {
                role: "system",
                content:
                  "Ты дружелюбный ассистент по правильному питанию в ВК. " +
                  "Отвечай простым, человеческим языком. " +
                  "Не давай медицинских диагнозов. " +
                  "Помогай с ПП-рецептами, идеями для похудения и полезными привычками. " +
                  "Если информации мало — мягко задай 1 уточняющий вопрос."
              },
              {
                role: "user",
                content: userText
              }
            ],
            temperature: 0.6
          })
        }
      );

      const aiData = await aiResponse.json();
      answer =
        aiData?.choices?.[0]?.message?.content?.trim() || answer;
    } catch (e) {
      console.error("OpenAI error:", e);
    }
  }

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
