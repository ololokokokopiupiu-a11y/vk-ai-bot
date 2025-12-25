import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Переменные окружения
const VK_CONFIRMATION = process.env.VK_CONFIRMATION; // confirmation string из VK
const VK_TOKEN = process.env.VK_TOKEN; // токен сообщества VK

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
    const text = body.object.message.text;

    // Логирование входящего сообщения в Render
    console.log(`Новое сообщение от ${userId}: ${text}`);

    // Отправка ответа через VK API
    await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer_id: userId,
        message: "🤖 Привет! Я работаю и могу отвечать на сообщения.",
        random_id: Date.now(),
        access_token: VK_TOKEN,
        v: "5.131",
      }),
    });
  }

  // VK требует ответ "ok" на все POST-запросы
  res.send("ok");
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VK bot started on port", PORT);
});
