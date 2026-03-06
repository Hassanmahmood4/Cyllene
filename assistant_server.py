#!/usr/bin/env python3
import io
import json
import tempfile
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.error import URLError
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

HOST = "127.0.0.1"
PORT = 5500
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
OLLAMA_MODEL = "llama3.1"

# Optional: server-side speech-to-text (works when browser API fails, e.g. in Arc)
try:
    import speech_recognition as sr
    from pydub import AudioSegment
    SERVER_SPEECH_AVAILABLE = True
except ImportError:
    SERVER_SPEECH_AVAILABLE = False


def normalize(text: str) -> str:
    return text.strip().lower()


def map_command(text: str):
    command = normalize(text)
    if not command:
        return {"reply": "I did not hear anything. Please try again.", "source": "rule"}

    if "time" in command:
        now = datetime.now().strftime("%I:%M %p")
        return {"reply": f"The time is {now}.", "source": "rule"}

    if "date" in command:
        today = datetime.now().strftime("%A, %B %d, %Y")
        return {"reply": f"Today is {today}.", "source": "rule"}

    if command.startswith("open youtube"):
        return {
            "reply": "Opening YouTube.",
            "source": "rule",
            "action": {"type": "open_url", "url": "https://www.youtube.com"},
        }

    if command.startswith("open google"):
        return {
            "reply": "Opening Google.",
            "source": "rule",
            "action": {"type": "open_url", "url": "https://www.google.com"},
        }

    if command.startswith("search web for "):
        query = text[len("search web for ") :].strip()
        if not query:
            return {"reply": "Please tell me what to search for.", "source": "rule"}
        return {
            "reply": f"Searching the web for {query}.",
            "source": "rule",
            "action": {
                "type": "open_url",
                "url": f"https://www.google.com/search?q={quote_plus(query)}",
            },
        }

    if "hello" in command or "hi assistant" in command:
        return {"reply": "Hello. How can I help you?", "source": "rule"}

    return None


def ask_ollama(text: str) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": f'You are a concise and friendly voice assistant. User says: "{text}"',
        "stream": False,
    }
    req = Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(req, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data.get("response", "").strip() or "I did not get a response from the model."
    except URLError:
        return "I could not reach Ollama. Make sure `ollama serve` is running."


def transcribe_audio(audio_bytes: bytes, content_type: str) -> str:
    """Transcribe audio (webm or wav) using Google via server. Works when browser speech API fails."""
    if not SERVER_SPEECH_AVAILABLE or len(audio_bytes) < 100:
        return ""
    try:
        if "webm" in (content_type or "") or (len(audio_bytes) >= 4 and audio_bytes[:4] == b"\x1aE\xdf\xa3"):
            seg = AudioSegment.from_file(io.BytesIO(audio_bytes), format="webm")
        else:
            seg = AudioSegment.from_file(io.BytesIO(audio_bytes), format="wav")
        seg = seg.set_frame_rate(16000).set_channels(1)
        buf = io.BytesIO()
        seg.export(buf, format="wav")
        buf.seek(0)
        r = sr.Recognizer()
        with sr.AudioFile(buf) as src:
            audio = r.record(src)
        return (r.recognize_google(audio) or "").strip()
    except Exception:
        return ""


class AssistantHandler(SimpleHTTPRequestHandler):
    def _json_response(self, body: dict, status: int = 200):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        content_type = self.headers.get("Content-Type", "")

        if self.path == "/api/transcribe":
            if not SERVER_SPEECH_AVAILABLE:
                self._json_response({"error": "Install: pip install SpeechRecognition pydub", "text": ""}, status=503)
                return
            text = transcribe_audio(raw, content_type)
            self._json_response({"text": text})
            return

        if self.path != "/api/assistant":
            self._json_response({"error": "Not found"}, status=404)
            return

        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._json_response({"error": "Invalid JSON"}, status=400)
            return

        text = str(body.get("text", "")).strip()
        mapped = map_command(text)
        if mapped:
            self._json_response(mapped)
            return

        reply = ask_ollama(text)
        self._json_response({"reply": reply, "source": "ollama"})


def run():
    server = HTTPServer((HOST, PORT), AssistantHandler)
    print(f"Assistant server running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    run()
