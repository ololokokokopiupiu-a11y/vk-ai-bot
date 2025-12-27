import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== LOG =====
console.log("VK_TOKEN:", VK_TOKEN ? "OK" : "MISSING");
console.log("VK_CONFIRMATION:", VK_CONFIRMATION ? "OK" : "MISSING");
console.log("OPENAI_API_KEY:", OPENAI_API_KEY ? "OK" : "MISSING");

// ===== MEMORY =====
const memory = {};

// ===== ALLOWED TOPICS =====
const ALLOWED_REGEX = /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|здоров)/i;

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
  const peerId = message.peer_id;
  const text = message.text || "";

  // --- topic filter ---
  if (!ALLOWED_REGEX.test(text)) {
    await sendVK(
      peerId,
      "Я помогаю только с ПП питанием, похудением и рецептами 🥗\nНапиши, например: «ПП ужин», «Как похудеть», «КБЖУ завтрака»"
    );
    return;
  }

  // --- init memory ---
  if (!memory[userId]) {
    memory[userId] = { name: null, goal: null, history: [] };
  }

  const userMemory = memory[userId];

  // --- name ---
  const nameMatch = text.match(/меня зовут\s+(\w+)/i);
  if (nameMatch) userMemory.name = nameMatch[1];

  // --- goal ---
  if (/похуд/i.test(text)) userMemory.goal = "похудение";
  if (/пп|правиль/i.test(text)) userMemory.goal = "ПП питание";

  // --- history ---
  userMemory.history.push(text);
  if (userMemory.history.length > 6) userMemory.history.shift();

  // typing
  startTyping(peerId);

  let answer = "Я пока не могу ответить 🤖";

  try {
    const systemPrompt = `
Ты — профессиональный ассистент по ПП питанию и похудению.
Всегда отвечай ТОЛЬКО в рамках темы питания.
Имя: ${userMemory.name || "не указано"}
Цель: ${userMemory.goal || "не указана"}
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
            ...userMemory.history.map(t => ({ role: "user", content: t }))
          ]
        })
      }
    );

    const aiData = await aiResponse.json();
    answer = aiData.choices?.[0]?.message?.content || answer;

  } catch (e) {
    console.error("OpenAI error:", e);
  }

  await sendVK(peerId, answer);
}

// ===== TYPING =====
function startTyping(peer_id) {
  fetch("https://api.vk.com/method/messages.setActivity", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id: peer_id.toString(),
      type: "typing",
      access_token: VK_TOKEN,
      v: "5.199"
    })
  }).catch(() => {});
}

// ===== SEND =====
async function sendVK(peer_id, text) {
  await fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id: peer_id.toString(),
      message: text,
      random_id: Date.now().toString(),
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });
}

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
