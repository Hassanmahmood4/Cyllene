# Personal Voice Assistant (Ollama + Python)

This project includes a v2 animated UI plus a Python backend that maps commands and calls Ollama.

## Features

- **Push to speak**: hold the mic button, speak, release — audio is sent to the server for transcription (works in Arc and other browsers).
- Rule-based command mapping in Python (time, date, open YouTube/Google, search web).
- Text-to-speech replies in the browser.
- Ollama fallback for open-ended prompts.
- Optional text input if voice is unavailable.

## Run

1. Install Python deps for server-side voice (so the push button works in Arc):

   ```bash
   pip install -r requirements.txt
   ```
   For WebM support you need **ffmpeg** installed (e.g. `brew install ffmpeg` on macOS).

2. Start Ollama:

   ```bash
   ollama serve
   ```

2. Make sure your model exists:

   ```bash
   ollama pull llama3.1
   ```

3. Start the Python assistant server:

   ```bash
   python3 assistant_server.py
   ```

4. Open:

   ```text
   http://127.0.0.1:5500
   ```

## Notes

- **Push button**: hold the mic button while speaking, then release. The server transcribes and runs the command (works in Arc).
- If the server says "Install SpeechRecognition pydub", run `pip install -r requirements.txt` and install ffmpeg.
- If the mic is blocked, allow microphone access for `http://127.0.0.1:5500` in your browser.
- Ollama: ensure `ollama serve` is running and the model is pulled.
