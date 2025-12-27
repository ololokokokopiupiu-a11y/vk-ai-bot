import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== MEMORY =====
const userMemory = new Map(); // user_id -> messages[]
const lastMessageTime = new Map(); // антифлуд

const MAX_HISTORY = 10; // сколько сообщений хранить
const FLOOD_DELAY = 3000; // 3 сек

// ===== CALLBACK =====
app.post("/", (req, res) => {
  const body = req.body;

  if (body.type === "confirmation") {
    return res.send(VK_CONFIRMATION);
  }

  res.send("ok");

  if (body.type !== "message_new") return;

  const message = body.object.message;
  if (message.from_id <= 0) return;

  handleMessage(message).catch(console.error);
});

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  const userId = message.from_id;
  const now = Date.now();

  // ---- антифлуд ----
  if (lastMessageTime.has(userId)) {
    if (now - lastMessageTime.get(userId) < FLOOD_DELAY) {
      return;
    }
  }
  lastMessageTime.set(userId, now);

  // ---- память ----
  if (!userMemory.has(userId)) {
    userMemory.set(userId, [
      {
        role: "system",
        content:
          "Ты дружелюбный VK-бот. Запоминай имя пользователя, если он его сообщает, и используй его в дальнейшем диалоге."
      }
    ]);
  }

  const history = userMemory.get(userId);
  history.push({ role: "user", content: message.text || "…" });

  // ограничение истории
  if (history.length > MAX_HISTORY + 1) {
    history.splice(1, history.length - MAX_HISTORY - 1);
  }

  let answer = "Я пока не могу ответить 🤖";

  // ---- OpenAI ----
  try {
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
          messages: history
        })
      }
    );

    const aiData = await aiResponse.json();
    answer = aiData.choices?.[0]?.message?.content || answer;

    history.push({ role: "assistant", content: answer });
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
