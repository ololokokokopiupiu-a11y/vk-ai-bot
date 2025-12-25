import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 🔴 ВСТАВЬ СВОЙ ТОКЕН СООБЩЕСТВА
const VK_TOKEN = "vk1.a.ВСТАВЬ_СВОЙ_ТОКЕН_СЮДА";

// 🔴 СТРОКА ПОДТВЕРЖДЕНИЯ
const VK_CONFIRMATION = "cc9b1e12";

app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  // подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  if (body.type === "message_new") {
    const msg = body.object.message;

    // защита от бота
    if (msg.from_id <= 0) {
      return res.send("ok");
    }

    const params = new URLSearchParams({
      peer_id: msg.peer_id.toString(),
      message: "Бот жив и отвечает ✅",
      random_id: Date.now().toString(),
      access_token: VK_TOKEN,
      v: "5.199"
    });

    try {
      const response = await fetch(
        "https://api.vk.com/method/messages.send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params
        }
      );

      const data = await response.json();
      console.log("VK SEND RESPONSE:", data);

    } catch (e) {
      console.error("SEND ERROR:", e);
    }
  }

  res.send("ok");
});

app.get("/", (req, res) => {
  res.send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
