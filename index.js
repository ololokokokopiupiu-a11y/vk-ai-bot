import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;

// ===== ПРОВЕРКА СЕРВЕРА =====
app.get("/", (req, res) => {
  res.send("VK bot is alive ✅");
});

// ===== CALLBACK VK =====
app.post("/", async (req, res) => {
  const body = req.body;
  console.log("EVENT TYPE:", body.type);

  // Подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // Новое сообщение
  if (body.type === "message_new") {
    console.log("INSIDE MESSAGE_NEW");

    const userId = body.object.message.from_id;

    console.log(
      "VK_TOKEN LENGTH:",
      VK_TOKEN ? VK_TOKEN.length : "NO TOKEN"
    );

    try {
      const vkResponse = await fetch(
        `https://api.vk.com/method/messages.send?peer_id=${userId}&message=${encodeURIComponent(
          "Бот жив и отвечает ✅"
        )}&random_id=${Date.now()}&access_token=${VK_TOKEN}&v=5.199`
      );

      const vkData = await vkResponse.json();
      console.log("VK SEND RESPONSE:", vkData);
    } catch (err) {
      console.error("VK SEND ERROR:", err);
    }
  }

  // VK ОБЯЗАТЕЛЬНО ЖДЁТ ok
  res.send("ok");
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
