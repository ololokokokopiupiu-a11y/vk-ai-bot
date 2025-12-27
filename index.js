import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== MEMORY & LIMITS =====
const dialogState = new Map();

const FLOOD_INTERVAL_MS = 2000; // 1 сообщение раз в 2 сек
const FLOOD_MAX_MSG = 5;        // макс 5 сообщений
const FLOOD_WINDOW_MS = 10000;  // за 10 сек

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

// ===== TYPING =====
async function sendTyping(peer_id) {
  await fetch("https://api.vk.com/method/messages.setActivity", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id: peer_id.toString(),
      type: "typing",
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });
}

// ===== MESSAGE HANDLER =====
async function handleMessage(message) {
  const peerId = message.peer_id;
  const now = Date.now();

  // ===== АНТИФЛУД =====
  if (!dialogState.has(peerId)) {
    dialogState.set(peerId, {
      lastMessageTime: 0,
      timestamps: [],
      summary: "",
      recent: []
    });
  }

  const state = dialogState.get(peerId);

  // слишком часто
  if (now - state.lastMessageTime < FLOOD_INTERVAL_MS) return;

  // окно сообщений
  state.timestamps = state.timestamps.filter(t => now - t < FLOOD_WINDOW_MS);
  if (state.timestamps.length >= FLOOD_MAX_MSG) return;

  state.timestamps.push(now);
  state.lastMessageTime = now;

  // ===== TYPING =====
  await sendTyping(peerId);
  const typingInterval = setInterval(() => sendTyping(peerId), 4000);

  const userText = message.text || "…";

  // ===== RECENT MEMORY =====
  state.recent.push({ role: "user", content: userText });
  if (state.recent.length > 4) state.recent.shift();

  let answer = "Я пока не могу ответить 🤖";

  // ===== OpenAI =====
  try {
    const messages = [
      {
        role: "system",
        content:
          "Ты дружелюбный VK-бот. Вот краткая память диалога:\n" +
          (state.summary || "Диалог только начался.")
      },
      ...state.recent
    ];

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
          max_tokens: 200,
          messages
        })
      }
    );

    const aiData = await aiResponse.json();
    answer = aiData.choices?.[0]?.message?.content || answer;

  } catch (e) {
    console.error("OpenAI error:", e);
  }

  // ===== SAVE ASSISTANT MESSAGE =====
  state.recent.push({ role: "assistant", content: answer });
  if (state.recent.length > 4) state.recent.shift();

  // ===== UPDATE SUMMARY (умная память) =====
  try {
    const summaryResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 100,
          messages: [
            {
              role: "system",
              content:
                "Сожми диалог в краткое резюме (1–2 предложения), сохрани важные факты."
            },
            {
              role: "user",
              content:
                "Прошлое резюме:\n" +
                (state.summary || "—") +
                "\n\nНовые сообщения:\n" +
                state.recent.map(m => `${m.role}: ${m.content}`).join("\n")
            }
          ]
        })
      }
    );

    const summaryData = await summaryResponse.json();
    state.summary =
      summaryData.choices?.[0]?.message?.content || state.summary;

  } catch (e) {
    console.error("Summary error:", e);
  }

  clearInterval(typingInterval);

  await sendVK(peerId, answer);
}

// ===== SEND TO VK =====
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
