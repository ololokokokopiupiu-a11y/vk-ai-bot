import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "EMPTY");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "EMPTY");
console.log("OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "EMPTY");

app.post("/", async (req, res) => {
  const body = req.body;

  console.log("EVENT TYPE:", body.type);

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  if (body.type === "message_new") {
    try {
      // защита от ответа самому себе
      if (body.object.message.from_id <= 0) {
        return res.send("ok");
      }

      const userText = body.object.message.text || "";
      const userId = body.object.message.from_id;

      let replyText = "Я тут 👋";

      // OpenAI
      const aiResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Ты полезный ИИ-помощник для ВКонтакте. Отвечай кратко и по делу."
              },
              { role: "user", content: userText }
            ]
          })
        }
      );

      const aiData = await aiResponse.json();
      replyText =
        aiData?.choices?.[0]?.message?.content ||
        "Не смог сформировать ответ 😕";

      // Отправка в VK (ВАЖНО: form-urlencoded)
      const params = new URLSearchParams({
        peer_id: userId.toString(),
        message: replyText,
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
    } catch (err) {
      console.error("HANDLER ERROR:", err);
    }
  }

  // VK ОБЯЗАТЕЛЬНО должен получить ok
  return res.send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
