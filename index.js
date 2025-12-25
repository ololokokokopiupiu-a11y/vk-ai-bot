import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 👉 GET / — чтобы не было Not Found
app.get("/", (req, res) => {
  res.send("OK");
});

// переменные окружения
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const VK_TOKEN = process.env.VK_TOKEN;

// 👉 Callback от VK
app.post("/", async (req, res) => {
  const body = req.body;

  // подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // новое сообщение
  if (body.type === "message_new") {
    const userId = body.object.message.from_id;

    await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer_id: userId,
        message: "Привет! Я работаю 👋",
        random_id: Date.now(),
        access_token: VK_TOKEN,
        v: "5.131"
      })
    });
  }

  res.send("ok");
});

// запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on", PORT);
});

