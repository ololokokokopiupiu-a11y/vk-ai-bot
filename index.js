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

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  if (body.type === "message_new") {
    const userId = body.object.message.from_id;

    const response = await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer_id: userId,
        message: "Я снова работаю ✅",
        random_id: Date.now(),
        access_token: VK_TOKEN,
        v: "5.199"
      })
    });

    const data = await response.json();
    console.log("VK RESPONSE:", data);
  }

  res.send("ok");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
