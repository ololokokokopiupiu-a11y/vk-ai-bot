import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// тест сервера
app.get("/", (req, res) => {
  res.send("OK");
});

const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const VK_TOKEN = process.env.VK_TOKEN;

app.post("/", async (req, res) => {
  const body = req.body;
  console.log("VK EVENT:", body.type);

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  if (body.type === "message_new") {
    const userId = body.object.message.from_id;

   const vkResponse = await fetch("https://api.vk.com/method/messages.send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    peer_id: userId,
    message: "Бот жив и отвечает ✅",
    random_id: Date.now(),
    access_token: VK_TOKEN,
    v: "5.199"
      })
    });
  }

  res.send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
