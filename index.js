import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/**
 * Проверка, что сервер жив
 * Если тут не "ok" — VK не будет работать
 */
app.get("/", (req, res) => {
  res.send("ok");
});

/**
 * Callback API от VK
 */
app.post("/", async (req, res) => {
  const body = req.body;

  // 1. Подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(process.env.VK_CONFIRMATION);
  }

  // 2. Новое сообщение
  if (body.type === "message_new") {
    const userId = body.object.message.from_id;

    try {
      await fetch("https://api.vk.com/method/messages.send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peer_id: userId,
          message: "✅ Бот работает и отвечает!",
          random_id: Date.now(),
          access_token: process.env.VK_TOKEN,
          v: "5.131"
        })
      });
    } catch (e) {
      console.error("VK send error:", e);
    }
  }

  // VK всегда ждёт "ok"
  res.send("ok");
});

/**
 * Запуск сервера (ОДИН РАЗ)
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VK bot started on port", PORT);
});
