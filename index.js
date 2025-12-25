import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// === ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ===
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const VK_TOKEN = process.env.VK_TOKEN;

// === ПРОВЕРКА (можно потом убрать) ===
console.log("VK_TOKEN =", VK_TOKEN ? "OK" : "MISSING");

// === CALLBACK ОТ VK ===
app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  // 1️⃣ Подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // 2️⃣ Новое сообщение
  if (body.type === "message_new") {
    console.log("INSIDE MESSAGE_NEW");

    const peerId = body.object.message.peer_id;

    // ⚠️ VK ТРЕБУЕТ form-urlencoded
    const params = new URLSearchParams({
      peer_id: peerId.toString(),
      message: "Бот жив и отвечает ✅",
      random_id: Date.now().toString(),
      access_token: VK_TOKEN,
      v: "5.199"
    });

    try {
      const vkResponse = await fetch(
        "https://api.vk.com/method/messages.send",
        {
          method: "POST",
          body: params
        }
      );

      const vkData = await vkResponse.json();
      console.log("VK SEND RESPONSE:", vkData);
    } catch (err) {
      console.error("VK SEND ERROR:", err);
    }
  }

  // VK всегда ждёт "ok"
  res.send("ok");
});

// === ЗАПУСК СЕРВЕРА ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
