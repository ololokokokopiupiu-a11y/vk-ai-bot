import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const VK_TOKEN = process.env.VK_TOKEN;

// ===== ЛОГ ПРОВЕРКИ =====
console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");

// ===== CALLBACK =====
app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  // 1️⃣ Подтверждение сервера
  if (body.type === "confirmation") {
    return res.status(200).send(VK_CONFIRMATION);
  }

  // 2️⃣ Новое сообщение
  if (body.type === "message_new") {
    const message = body.object.message;

    // ❗ защита от ботов / групп
    if (message.from_id <= 0) {
      return res.send("ok");
    }

    try {
      const vkResponse = await fetch(
        "https://api.vk.com/method/messages.send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            peer_id: message.from_id.toString(),
            message: "Бот жив и отвечает ✅",
            random_id: Date.now().toString(),
            access_token: VK_TOKEN,
            v: "5.199",
          }),
        }
      );

      const vkData = await vkResponse.json();
      console.log("VK SEND RESPONSE:", vkData);
    } catch (err) {
      console.error("VK ERROR:", err);
    }
  }

  // 3️⃣ ОБЯЗАТЕЛЬНО
  res.send("ok");
});

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
