import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

/* ================= FILE MEMORY ================= */
const FILE = "./memory.json";
let memory = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, "utf8"))
  : {};

const save = () =>
  fs.writeFileSync(FILE, JSON.stringify(memory, null, 2));

/* ================= ENV ================= */
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROUP_ID = process.env.VK_GROUP_ID; // ОБЯЗАТЕЛЬНО

/* ================= TARIFFS ================= */
const TARIFFS = {
  free: { ai: 3, photo: 0 },
  base: { ai: 10, photo: 0 },
  pro: { ai: 20, photo: 1 },
  vip: { ai: 999, photo: 999 }
};

/* ================= REGEX ================= */
const FOOD = /(пп|питани|похуд|калор|кбжу|рецепт|белк|жир|углев|продукт|есть дома)/i;
const HEALTH = /(давление|диабет|болит|болезн|врач)/i;
const THANKS = /(спасибо|благодарю)/i;
const BYE = /(пока|до свидания)/i;

/* ================= CALLBACK ================= */
app.post("/", (req, res) => {
  const body = req.body;
  if (body.type === "confirmation") return res.send(VK_CONFIRMATION);
  res.send("ok");

  if (body.type === "message_new") {
    handleMessage(body.object.message).catch(console.error);
  }
});

/* ================= DONUT CHECK ================= */
async function isDon(userId) {
  const res = await fetch(
    "https://api.vk.com/method/donut.isDon",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        owner_id: `-${GROUP_ID}`,
        user_id: userId,
        access_token: VK_TOKEN,
        v: "5.199"
      })
    }
  ).then(r => r.json());

  return res?.response === 1;
}

/* ================= MESSAGE HANDLER ================= */
async function handleMessage(msg) {
  const userId = msg.from_id;
  const peer = msg.peer_id;
  const text = (msg.text || "").trim();
  const hasPhoto = msg.attachments?.some(a => a.type === "photo");

  if (!memory[userId]) {
    memory[userId] = {
      name: null,
      step: 0,
      tariff: "free",
      ai: 0,
      photo: 0,
      day: today()
    };
    save();
  }

  const user = memory[userId];

  /* reset day */
  if (user.day !== today()) {
    user.ai = 0;
    user.photo = 0;
    user.day = today();
  }

  /* auto donut */
  const don = await isDon(userId);
  if (!don) user.tariff = "free";

  /* simple replies */
  if (THANKS.test(text))
    return send(peer, "Пожалуйста 😊 Я рада помочь 💚");

  if (BYE.test(text))
    return send(peer, "Береги себя 💚 Я всегда рядом");

  /* onboarding */
  if (user.step === 0) {
    user.step = 1;
    save();
    return send(peer, "Привет 😊 Я Анна, нутрициолог. Как тебя зовут?");
  }

  if (user.step === 1) {
    if (!/^[а-яёa-z]{2,20}$/i.test(text))
      return send(peer, "Подскажи, пожалуйста, именно имя 💚");
    user.name = text;
    user.step = 2;
    save();
    return send(peer, `${user.name}, приятно познакомиться 🌿`);
  }

  /* limits */
  const lim = TARIFFS[user.tariff];

  if (user.ai >= lim.ai)
    return send(peer, "Лимит исчерпан 🌿 В тарифах выше возможностей больше");

  if (hasPhoto && user.photo >= lim.photo)
    return send(peer, "Анализ фото доступен в PRO и VIP 📸");

  /* photo vision */
  let answer = "";

  if (hasPhoto) {
    const vision = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "Ты нутрициолог. Определи блюдо по фото и оцени КБЖУ."
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Что на фото и КБЖУ?" },
                { type: "image_url", image_url: { url: msg.attachments[0].photo.sizes.at(-1).url } }
              ]
            }
          ]
        })
      }
    ).then(r => r.json());

    answer =
      vision.choices?.[0]?.message?.content ||
      "Не смогла распознать фото 😔";

    user.photo++;
  } else {
    if (!FOOD.test(text))
      return send(peer, "Я помогаю только с ПП питанием 🥗");

    const ai = await fetch(
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
            {
              role: "system",
              content:
                "Ты Анна, нутрициолог. Отвечай тепло и по-человечески."
            },
            { role: "user", content: text }
          ]
        })
      }
    ).then(r => r.json());

    answer = ai.choices?.[0]?.message?.content || "Секунду 😊";
  }

  if (HEALTH.test(text))
    answer +=
      "\n\n⚠️ Я не врач. При проблемах со здоровьем обратись к специалисту.";

  user.ai++;
  save();

  await send(peer, answer);
}

/* ================= HELPERS ================= */
const today = () => new Date().toISOString().slice(0, 10);

const send = (peer, text) =>
  fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      peer_id: peer,
      message: text,
      random_id: Date.now(),
      access_token: VK_TOKEN,
      v: "5.199"
    })
  });

/* ================= START ================= */
app.listen(process.env.PORT || 3000, () =>
  console.log("🔥 Анна запущена")
);
