import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ====== ENV ======
const VK_TOKEN = process.env.VK_TOKEN;
const VK_CONFIRMATION = process.env.VK_CONFIRMATION;
const GROUP_ID = process.env.GROUP_ID;

// ====== MEMORY ======
const memory = {};

function getUser(userId) {
  if (!memory[userId]) {
    memory[userId] = {
      step: 0,
      name: null,
      tariff: "free", // free | vip
    };
  }
  return memory[userId];
}

// ====== VK SEND ======
async function sendVK(peer_id, message) {
  await fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: VK_TOKEN,
      v: "5.199",
      random_id: Date.now(),
      peer_id,
      message,
    }),
  });
}

// ====== REGEX ======
const ABOUT_REGEX = /кто ты|кто такая|что ты умеешь/i;
const THANKS_REGEX = /спасибо|благодарю/i;
const MENU_REGEX = /меню/i;

// ====== CALLBACK ======
app.post("/", async (req, res) => {
  res.send("ok"); // 🔴 КРИТИЧНО: отвечаем сразу

  try {
    const body = req.body;

    if (body.type === "confirmation") {
      return res.send(VK_CONFIRMATION);
    }

    if (body.type !== "message_new") return;

    const msg = body.object.message;
    const peerId = msg.peer_id;
    const userId = msg.from_id;
    const text = (msg.text || "").trim();
    const attachments = msg.attachments || [];

    const user = getUser(userId);

    // ====== PHOTO CHECK (VIP) ======
    const hasPhoto = attachments.some(a => a.type === "photo");

    if (hasPhoto && user.tariff !== "vip") {
      return await sendVK(
        peerId,
        "Я вижу фото 😊\n\nРасчёт КБЖУ и анализ еды по фото доступны в тарифе «Личный ассистент» 💚\nhttps://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3257"
      );
    }

    // ====== SIMPLE RESPONSES ======
    if (ABOUT_REGEX.test(text)) {
      return await sendVK(peerId, "Я Анна 😊 Нутрициолог. Помогаю с ПП и похудением 💚");
    }

    if (THANKS_REGEX.test(text)) {
      return await sendVK(peerId, "Всегда рада помочь 💚");
    }

    // ====== ONBOARDING ======
    if (user.step === 0) {
      user.step = 1;
      return await sendVK(peerId, "Привет 😊 Я Анна. Как тебя зовут?");
    }

    if (user.step === 1) {
      user.name = text;
      user.step = 2;
      return await sendVK(
        peerId,
        `${user.name}, приятно познакомиться 💚\nКакая у тебя цель?\n1️⃣ Похудеть\n2️⃣ ПП питание\n3️⃣ Поддерживать форму`
      );
    }

    if (user.step === 2) {
      user.step = 3;
      return await sendVK(
        peerId,
        "Отлично 🔥 Тогда пиши продукты или задавай вопросы — я рядом 😊"
      );
    }

    // ====== MENU (VIP) ======
    if (MENU_REGEX.test(text) && user.tariff !== "vip") {
      return await sendVK(
        peerId,
        "Меню на неделю доступно в тарифе «Личный ассистент» 💚\nhttps://vk.com/pp_recepty_vk?w=donut_payment-234876171&levelId=3257"
      );
    }

    // ====== DEFAULT ======
    return await sendVK(
      peerId,
      "Я тебя услышала 😊 Напиши продукты или задай вопрос."
    );

  } catch (err) {
    console.error("VK ERROR:", err);
  }
});

// ====== START ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("VK bot running on", PORT));

