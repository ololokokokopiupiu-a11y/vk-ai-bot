import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const VK_TOKEN = process.env.VK_TOKEN;

console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");

app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  // 1. Confirmation
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // 2. New message
  if (body.type === "message_new") {
    const message = body.object.message;

    // не отвечаем на сервисные события
    if (!message || message.from_id <= 0) {
      return res.send("ok");
    }

    try {
      const params = new URLSearchParams({
        peer_id: message.peer_id.toString(),
        message: "Привет 👋 Я жив",
        random_id: Date.now().toString(),
        access_token: VK_TOKEN,
        v: "5.199"
      });

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
      console.error("VK ERROR:", e);
    }
  }

  res.send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
