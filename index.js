import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Переменные окружения из Render
const VK_CONFIRMATION = process.env.VK_CONFIRMATION; // confirmation string из VK
const VK_TOKEN = process.env.VK_TOKEN;               // токен сообщества VK

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
    const text = body.object.message.text.toLowerCase();

    // Логируем в консоль для отладки
    console.log(`Новое сообщение от ${userId}: ${text}`);

    // Выбираем ответ в зависимости от текста
    let reply = "Привет! Я работаю и могу отвечать на сообщения.";

    if (text.includes("привет")) reply = "Привет! Рад тебя видеть!";
    if (text.includes("как дела")) reply = "У меня всё отлично! А у тебя?";
    if (text.includes("бот")) reply = "Да, это я — ваш дружелюбный бот!";

    // Отправка ответа через VK API
    await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer_id: userId,
        message: reply,
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
