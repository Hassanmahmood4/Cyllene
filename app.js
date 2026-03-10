const ASSISTANT_API_URL = "/api/assistant";

document.addEventListener("DOMContentLoaded", () => {

  // ── DOM refs ──────────────────────────────────────────
  const waveHint  = document.getElementById("waveHint");
  const micButton = document.getElementById("micButton");
  const canvas    = document.getElementById("vizCanvas");
  const ctx       = canvas.getContext("2d");

  // ══════════════════════════════════════════════════════
  //  RADIAL CANVAS VISUALIZER
  // ══════════════════════════════════════════════════════
  const DPR  = window.devicePixelRatio || 1;
  const SIZE = 320;
  canvas.width  = SIZE * DPR;
  canvas.height = SIZE * DPR;
  ctx.scale(DPR, DPR);

  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const N  = 96;

  // Multiple overlapping wave layers: same hollow center, each layer offset in radius + waveform (ghosting effect).
  const LAYERS = [
    { innerR: 68, baseLen: 50, amp: 20, freq: 4, phase: 0,    alpha: 0.38 },  // back
    { innerR: 72, baseLen: 44, amp: 24, freq: 5, phase: 2.1, alpha: 0.55 },  // middle
    { innerR: 76, baseLen: 40, amp: 22, freq: 6, phase: 4.3, alpha: 0.82 }, // front
  ];

  let vizState   = "idle";
  let ampTarget  = 0;
  let ampCurrent = 0;
  let hoverTarget  = 0;
  let hoverCurrent = 0;
  let mouseAngle   = 0;
  let globalRot    = 0;

  const SPEED = { idle: 0.0016, thinking: 0.004, listening: 0.022, speaking: 0.011 };

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouseAngle  = Math.atan2(e.clientY - r.top - CY, e.clientX - r.left - CX);
    hoverTarget = 1;
  });
  canvas.addEventListener("mouseleave", () => { hoverTarget = 0; });
  canvas.style.cursor = "crosshair";

  function setHint(text) {
    if (waveHint) waveHint.textContent = text;
  }

  function setVizState(s) {
    vizState  = s;
    ampTarget = (s === "listening" || s === "speaking") ? 1 : 0;
    const hints = {
      idle:      "What can I help you with?",
      listening: "Listening…",
      speaking:  "Speaking…",
      thinking:  "Thinking…",
    };
    setHint(hints[s] || hints.idle);
  }

  function drawFrame() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ampCurrent   += (ampTarget   - ampCurrent)   * 0.055;
    hoverCurrent += (hoverTarget - hoverCurrent) * 0.08;
    globalRot    += SPEED[vizState] || SPEED.idle;
    const t = performance.now() / 1000;

    const bx = CX;
    const by = CY;
    const rot = globalRot;

    // Draw back-to-front so overlapping waves create depth (back layer shows through).
    for (const layer of LAYERS) {
      const layerRot = rot + layer.phase * 0.15; // slight rotation offset per layer
      for (let i = 0; i < N; i++) {
        const baseAngle = (i / N) * Math.PI * 2;
        const drawAngle = baseAngle + layerRot;

        // Each layer has its own inner radius — creates concentric overlap
        const innerR = layer.innerR;

        // Each layer has its own waveform so peaks/troughs don’t align (ghosting)
        const waveShape =
          Math.sin(baseAngle * layer.freq + t * 1.2 + layer.phase) * 0.5 +
          Math.sin(baseAngle * (layer.freq + 2) + t * 0.8 + layer.phase * 1.3) * 0.35 +
          Math.sin(i * 0.18 + t * 0.4 + layer.phase) * 0.15;
        let lineLen = layer.baseLen + layer.amp * waveShape;

        const activeLift = ampCurrent * 24 * (0.5 + 0.5 * Math.abs(Math.sin(i * 0.35 + t + layer.phase)));
        const diff      = Math.abs(((baseAngle - mouseAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        const proximity = Math.max(0, 1 - diff / (Math.PI * 0.32));
        const hSpike    = Math.abs(Math.sin(i * 4.1 + t * 9 + layer.phase) * 0.5 + Math.sin(i * 7.8 + t * 6) * 0.5);
        lineLen += activeLift + hoverCurrent * proximity * 36 * hSpike;
        lineLen = Math.max(lineLen, 2);

        const alpha = Math.min(
          (layer.alpha + ampCurrent * 0.15 + hoverCurrent * proximity * 0.12),
          0.95
        );
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(drawAngle) * innerR, by + Math.sin(drawAngle) * innerR);
        ctx.lineTo(bx + Math.cos(drawAngle) * (innerR + lineLen), by + Math.sin(drawAngle) * (innerR + lineLen));
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.lineWidth   = 0.88;
        ctx.stroke();
      }
    }
    requestAnimationFrame(drawFrame);
  }

  drawFrame();

  // ══════════════════════════════════════════════════════
  //  SPEECH + BACKEND
  // ══════════════════════════════════════════════════════
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = SR ? new SR() : null;
  if (recognition) {
    recognition.lang            = "en-US";
    recognition.interimResults  = false;
    recognition.maxAlternatives = 1;
  }

  let muted = false;

  // ── TTS: speaks the reply and drives visualizer state ─
  function speak(text) {
    if (!("speechSynthesis" in window) || muted) {
      setVizState("idle");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate  = 1;
    u.pitch = 1.05;
    u.lang  = "en-US";
    u.onstart = () => { setVizState("speaking"); micButton.classList.remove("listening"); };
    u.onend   = () => setVizState("idle");
    u.onerror = () => setVizState("idle");
    window.speechSynthesis.speak(u);
  }

  // ── Send text to Python backend ───────────────────────
  async function askAssistant(prompt) {
    const res = await fetch(ASSISTANT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Full pipeline: speech → backend → TTS ────────────
  async function processCommand(text) {
    setVizState("thinking");
    try {
      const data  = await askAssistant(text);
      const reply = data.reply || "I did not get a response.";
      if (data.action?.type === "open_url" && data.action.url) {
        window.open(data.action.url, "_blank", "noopener,noreferrer");
      }
      speak(reply);
    } catch (err) {
      const isNetwork = err.message === "Failed to fetch" || err.name === "TypeError";
      setHint(
        isNetwork
          ? "Network error — open this page at http://127.0.0.1:5000 and run: python3 assistant_server.py"
          : "Backend error — run: python3 assistant_server.py"
      );
      setVizState("idle");
      console.error(err);
    }
  }

  // ── Speech recognition events ─────────────────────────
  if (recognition) {
    recognition.onstart = () => {
      micButton.classList.add("listening");
      setVizState("listening");
    };

    recognition.onend = () => {
      micButton.classList.remove("listening");
      if (vizState === "listening") setVizState("idle");
    };

    recognition.onerror = (e) => {
      micButton.classList.remove("listening");
      setVizState("idle");
      if (e.error === "not-allowed") {
        setHint("Mic blocked — allow microphone access in browser settings");
        return;
      }
      if (e.error === "network") {
        setHint("Voice unavailable. Type your message below and press Send.");
        return;
      }
      setHint(`Mic error: ${e.error}`);
    };

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setHint(`"${transcript}"`);
      processCommand(transcript);
    };
  }

  // ── Server-side transcription (works in Arc when browser speech API fails) ─
  const TRANSCRIBE_URL = "/api/transcribe";
  let mediaRecorder = null;
  let recordedChunks = [];

  async function transcribeOnServer(audioBlob) {
    const res = await fetch(TRANSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": audioBlob.type || "audio/webm" },
      body: audioBlob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setHint(data.error || "Server transcription unavailable. Use the text box below.");
      return;
    }
    const text = (data.text || "").trim();
    if (!text) {
      setHint("No speech detected. Hold the button while you speak, then release.");
      return;
    }
    setHint(`"${text}"`);
    processCommand(text);
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setHint("Microphone not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordedChunks.length) {
          const blob = new Blob(recordedChunks, { type: "audio/webm" });
          setHint("Transcribing…");
          transcribeOnServer(blob);
        } else {
          setHint("Hold the button while you speak, then release.");
        }
      };
      mediaRecorder.start();
      micButton.classList.add("listening");
      setVizState("listening");
      setHint("Listening… release to send");
    } catch (err) {
      setHint("Mic blocked — allow microphone access for this site.");
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      micButton.classList.remove("listening");
      setVizState("thinking");
    }
  }

  // Push-to-talk: hold button to record, release to send (uses server transcription — works in Arc)
  micButton.addEventListener("mousedown", (e) => { e.preventDefault(); startRecording(); });
  micButton.addEventListener("mouseup", stopRecording);
  micButton.addEventListener("mouseleave", stopRecording);
  micButton.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); }, { passive: false });
  micButton.addEventListener("touchend", (e) => { e.preventDefault(); stopRecording(); }, { passive: false });
  micButton.addEventListener("touchcancel", stopRecording);

  const textInput = document.getElementById("textInput");
  const sendBtn  = document.getElementById("sendBtn");
  if (sendBtn && textInput) {
    sendBtn.addEventListener("click", () => {
      const text = textInput.value.trim();
      if (!text) return;
      setHint(`"${text}"`);
      processCommand(text);
      textInput.value = "";
    });
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendBtn.click();
    });
  }

}); // DOMContentLoaded
