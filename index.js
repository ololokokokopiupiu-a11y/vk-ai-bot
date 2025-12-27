import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== ПРОВЕРКА =====
console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");
console.log("OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");

// ===== ПАМЯТЬ (RAM) =====
const memory = {}; 
// memory[userId] = { name, goal, history: [] }

// ===== CALLBACK =====
app.post("/", (req, res) => {
  const body = req.body;

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  res.send("ok");

  if (body.type === "message_new") {
    const message = body.object.message;
    if (message.from_id <= 0) return;

    handleMessage(message).catch(console.error);
  }
});

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  const userId = message.from_id;
  const userText = message.text || "";

  // --- инициализация памяти ---
  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      goal: null,
      history: []
    };
  }

  const userMemory = memory[userId];

  // --- простое извлечение имени ---
  const nameMatch = userText.match(/меня зовут\s+(\w+)/i);
  if (nameMatch) {
    userMemory.name = nameMatch[1];
  }

  // --- цель ---
  if (/похуд/i.test(userText)) userMemory.goal = "похудение";
  if (/пп|правиль/i.test(userText)) userMemory.goal = "ПП питание";

  // --- история (ограничиваем) ---
  userMemory.history.push(userText);
  if (userMemory.history.length > 6) {
    userMemory.history.shift();
  }

  let answer = "Я пока не могу ответить 🤖";

  // --- OpenAI ---
  try {
    const systemPrompt = `
Ты — дружелюбный ассистент по ПП питанию и похудению.
Имя пользователя: ${userMemory.name || "неизвестно"}
Цель пользователя: ${userMemory.goal || "не указана"}
Отвечай тепло, по-человечески, кратко.
`;

    const aiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            ...userMemory.history.map(t => ({
              role: "user",
              content: t
            }))
          ]
        })
      }
    );

    const aiData = await aiResponse.json();
    answer = aiData.choices?.[0]?.message?.content || answer;

  } catch (e) {
    console.error("OpenAI error:", e);
  }

  await sendVK(message.peer_id, answer);
}

// ===== SEND TO VK =====
async function sendVK(peer_id, text) {
  const params = new URLSearchParams({
    peer_id: peer_id.toString(),
    message: text,
    random_id: Date.now().toString(),
    access_token: VK_TOKEN,
    v: "5.199"
  });

  await fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
}

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
