import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;

console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");

// чтобы не было Cannot GET /
app.get("/", (req, res) => {
  res.send("OK");
});

app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  // подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // новое сообщение
  if (body.type === "message_new") {
    const message = body.object.message;

    // игнорируем сообщения от группы
    if (message.from_id <= 0) {
      return res.send("ok");
    }

    const userId = message.from_id;

    const vkResponse = await fetch(
      "https://api.vk.com/method/messages.send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peer_id: userId,
          message: "Бот жив и отвечает ✅",
          random_id: Date.now(),
          access_token: VK_TOKEN,
          v: "5.199"
        })
      }
    );

    const vkData = await vkResponse.json();
    console.log("VK SEND RESPONSE:", vkData);
  }

  res.send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
