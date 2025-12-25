import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const VK_SECRET = process.env.VK_SECRET;
const VK_TOKEN = process.env.VK_TOKEN;

app.post("/", async (req, res) => {
  const body = req.body;

  // Подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(process.env.VK_CONFIRMATION);
  }

  // Новое сообщение
  if (body.type === "message_new") {
    const userId = body.object.message.from_id;

    await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer_id: userId,
        message: "🤖 Бот работает! Я получил твоё сообщение.",
        random_id: Date.now(),
        access_token: VK_TOKEN,
        v: "5.131"
      })
    });
  }

  res.send("ok");
});

app.listen(3000, () => {
  console.log("VK bot started");
});
