import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 🔴 ВСТАВЬ СВОЙ ТОКЕН СООБЩЕСТВА
const VK_TOKEN = "vk1.a.ВСТАВЬ_СВОЙ_ТОКЕН_СЮДА";

// 🔴 СТРОКА ПОДТВЕРЖДЕНИЯ ИЗ VK
const VK_CONFIRMATION = "cc9b1e12";

console.log("VK TOKEN LENGTH:", VK_TOKEN.length);

// ===== CALLBACK =====
app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  // подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // новое сообщение
  if (body.type === "message_new") {
    const msg = body.object.message;

    // ❗ защита от ответа самому себе
    if (msg.from_id <= 0) {
      return res.send("ok");
    }

    const peerId = msg.peer_id; // 🔥 ВАЖНО: ИМЕННО peer_id

    try {
      const vkResponse = await fetch(
        "https://api.vk.com/method/messages.send",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            peer_id: peerId,
            message: "Бот жив и отвечает ✅",
            random_id: Date.now(),
            access_token: VK_TOKEN,
            v: "5.199"
          })
        }
      );

      const vkData = await vkResponse.json();
      console.log("VK SEND RESPONSE:", vkData);

    } catch (err) {
      console.error("VK SEND ERROR:", err);
    }
  }

  res.send("ok");
});

// GET /
app.get("/", (req, res) => {
  res.send("OK");
});

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
