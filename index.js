import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ENV
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const VK_TOKEN = process.env.VK_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Проверка при старте
console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");
console.log("OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");

// Callback от VK
app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  // 1️⃣ Confirmation
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // 2️⃣ Новое сообщение
  if (body.type === "message_new") {
    console.log("INSIDE MESSAGE_NEW");

    const message = body.object.message;

    // ❗ не отвечаем сами себе и сообществам
    if (message.from_id <= 0) {
      return res.send("ok");
    }

    const userText = message.text || "Привет";

    // ---------- OpenAI ----------
    let replyText = "Я думаю 🤔";

    try {
      const aiResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Ты полезный и дружелюбный ИИ-помощник в группе ВКонтакте. Отвечай кратко и по делу."
              },
              {
                role: "user",
                content: userText
              }
            ]
          })
        }
      );

      const aiData = await aiResponse.json();
      replyText =
        aiData?.choices?.[0]?.message?.content ||
        "Я пока не смог придумать ответ 🙂";

    } catch (err) {
      console.error("OpenAI error:", err);
    }

    // ---------- Отправка в VK ----------
    try {
      const vkResponse = await fetch(
        "https://api.vk.com/method/messages.send",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            peer_id: message.peer_id,
            message: replyText,
            random_id: Date.now(),
            access_token: VK_TOKEN,
            v: "5.199"
          })
        }
      );

      const vkData = await vkResponse.json();
      console.log("VK SEND RESPONSE:", vkData);

    } catch (err) {
      console.error("VK send error:", err);
    }
  }

  // VK всегда ждёт ok
  res.send("ok");
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
