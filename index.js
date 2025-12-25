import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Переменные окружения
const VK_CONFIRMATION = process.env.VK_CONFIRMATION; // строка подтверждения из VK
const VK_TOKEN = process.env.VK_TOKEN;               // токен сообщества VK
const OPENAI_KEY = process.env.OPENAI_KEY;           // ваш OpenAI API key

// Обработка POST-запросов от VK
app.post("/", async (req, res) => {
  const body = req.body;

  // Подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // Новое сообщение
  if (body.type === "message_new") {
    const userId = body.object.message.from_id;
    const userText = body.object.message.text;

    // Генерация ответа через OpenAI
    let replyText = "Произошла ошибка с OpenAI.";
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: userText }]
        })
      });
      const data = await response.json();
      replyText = data.choices[0].message.content;
    } catch (err) {
      console.error("OpenAI error:", err);
    }

    // Отправка ответа через VK API
    await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer_id: userId,
        message: replyText,
        random_id: Date.now(),
        access_token: VK_TOKEN,
        v: "5.131"
      })
    });
  }

  // VK требует "ok" на все POST-запросы
  res.send("ok");
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VK bot started on port", PORT);
});
