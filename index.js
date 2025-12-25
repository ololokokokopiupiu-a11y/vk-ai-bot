import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;

console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "EMPTY");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "EMPTY");

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

    const params = new URLSearchParams({
      peer_id: userId,
      message: "Бот жив и отвечает ✅",
      random_id: Date.now().toString(),
      access_token: VK_TOKEN,
      v: "5.199"
    });

    const vkResponse = await fetch(
      "https://api.vk.com/method/messages.send",
      {
        method: "POST",
        body: params
      }
    );

    const vkData = await vkResponse.json();
    console.log("VK RESPONSE:", vkData);
  }

  res.send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
