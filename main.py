import os
import json
import requests
from flask import Flask, request

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
VK_GROUP_TOKEN = os.getenv("VK_GROUP_TOKEN")

app = Flask(__name__)

def ask_openai(text):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    data = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "Ты полезный ИИ помощник для сообщества ВКонтакте. Отвечай кратко и по делу."},
            {"role": "user", "content": text}
        ]
    }
    r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=data)
    return r.json()["choices"][0]["message"]["content"]

def send_vk(user_id, text):
    requests.post("https://api.vk.com/method/messages.send", data={
        "access_token": VK_GROUP_TOKEN,
        "v": "5.199",
        "user_id": user_id,
        "random_id": 0,
        "message": text
    })

@app.route("/", methods=["POST"])
def vk_callback():
    data = request.json

    if data["type"] == "confirmation":
        return os.getenv("VK_CONFIRMATION_CODE")

    if data["type"] == "message_new":
        user_id = data["object"]["message"]["from_id"]
        text = data["object"]["message"]["text"]

        answer = ask_openai(text)
        send_vk(user_id, answer)

    return "ok"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
