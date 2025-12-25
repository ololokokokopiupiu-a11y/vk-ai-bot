import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_KEY = process.env.OPENAI_KEY;

// ===== VK CALLBACK =====
app.post("/", async (req, res) => {
  const body = req.body;
  console.log("EVENT TYPE:", body.type);

  // 1. Подтверждение сервера
  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  // 2. Новое сообщение
  if (body.type === "message_new") {
    console.log("INSIDE MESSAGE_NEW");

    const userId = body.object.message.from_id;
    const userText = body.object.message.text || "Привет";

    let replyText = "Я жив, но OpenAI не ответил 😢";

    // ===== OPENAI =====
    try {
      const aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: userText
        })
      });

      const aiData = await aiResponse.json();
      console.log("OPENAI RESPONSE:", aiData);

      replyText =
        aiData.output_text ||
        "OpenAI ответил, но без текста 🤷‍♂️";

    } catch (err) {
      console.error("OPENAI ERROR:", err);
    }

    // ===== VK SEND =====
    const vkResponse = await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer_id: userId,
        message: replyText,
        random_id: Date.now(),
        access_token: VK_TOKEN,
        v: "5.199"
      })
    });

    const vkData = await vkResponse.json();
    console.log("VK SEND RESPONSE:", vkData);
  }

  // VK ОБЯЗАТЕЛЬНО
  res.send("ok");
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
