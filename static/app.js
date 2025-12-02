// ============================================================
// Matrix Voice Assistant - app.js
// - Per-device ID (localStorage)
// - Per-tab Session ID
// - Flow guard during food_order
// - Clears chat after order done/cancel
// - Shows toast: "Order complete. Starting fresh." / "Order cancelled. Starting fresh."
// - Hidden audio playback (no visible player)
// - Mobile: visible audio player + "Tap to hear reply"
// ============================================================

(() => {
  console.log("[MatrixVA] app.js loaded");

  // ---------- Device type ----------
  const IS_MOBILE =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

  // ---------- Global TTS audio element (desktop / generic use) ----------
  const ttsAudio = new Audio();
  let audioUnlocked = false;

  // Tiny silent WAV (only 1 sample) to "unlock" audio on mobile
  const SILENT_WAV =
    "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

  async function unlockAudio() {
    if (audioUnlocked) return;

    try {
      // Use a real (silent) src so play() is valid
      if (!ttsAudio.src) {
        ttsAudio.src = SILENT_WAV;
      }

      ttsAudio.muted = true;
      const playPromise = ttsAudio.play();

      if (playPromise && playPromise.then) {
        await playPromise;
      }

      ttsAudio.pause();
      ttsAudio.currentTime = 0;
      ttsAudio.muted = false;

      audioUnlocked = true;
      console.log("[TTS] Audio unlocked for mobile");
    } catch (err) {
      console.warn("[TTS] Audio unlock attempt failed:", err);
    }
  }

  // -------------------- DEVICE ID --------------------
  function getOrCreateDeviceId() {
    const key = "matrix_device_id";
    try {
      let id = localStorage.getItem(key);
      if (!id) {
        id =
          "device-" +
          (crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2));
        localStorage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return "device-anon-" + Math.random().toString(36).slice(2);
    }
  }
  const DEVICE_ID = getOrCreateDeviceId();
  console.log("[MatrixVA] DEVICE_ID:", DEVICE_ID);

  // -------------------- SESSION ID --------------------
  const SESSION_ID =
    "sess-" +
    (crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));
  console.log("[MatrixVA] SESSION_ID:", SESSION_ID);

  // Insert labels
  const deviceEl = document.getElementById("deviceIdLabel");
  const sessionEl = document.getElementById("sessionIdLabel");
  const flowWarningEl = document.getElementById("flowWarning");

  if (deviceEl) deviceEl.textContent = DEVICE_ID;
  if (sessionEl) sessionEl.textContent = SESSION_ID;

  const micButton = document.getElementById("micButton");
  const micLabel = document.getElementById("micLabel");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const chat = document.getElementById("chat");

  if (!micButton || !micLabel || !statusDot || !statusText || !chat) {
    console.error("[MatrixVA] Missing essential DOM elements");
    return;
  }

  let mediaRecorder = null;
  let chunks = [];
  let inOrderFlow = false;

  // ---------- UI helpers ----------
  function setStatus(text, dotClass) {
    statusText.textContent = text;
    statusDot.className = "va-dot " + dotClass;
  }

  function appendChat(role, text) {
    if (!text) return;
    const div = document.createElement("div");
    div.className = "va-msg va-" + role;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function clearChat() {
    chat.innerHTML = "";
  }

  // ---------- Toast helper ----------
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "va-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger show
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    // Hide after 2.5s, remove after 3s
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2500);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3000);
  }

  // ---------- "Tap to hear reply" button (mobile) ----------
  function showPlayReplyButton(src, mime) {
    // Remove any existing button or player
    const existingBtn = document.getElementById("playReplyBtn");
    if (existingBtn && existingBtn.parentNode) {
      existingBtn.parentNode.removeChild(existingBtn);
    }
    const existingAudio = document.getElementById("replyAudioPlayer");
    if (existingAudio && existingAudio.parentNode) {
      existingAudio.parentNode.removeChild(existingAudio);
    }

    // Visible audio element so the OS media UI is used
    const audioEl = document.createElement("audio");
    audioEl.id = "replyAudioPlayer";
    audioEl.controls = true; // show native controls on mobile
    audioEl.src = src;

    // Log any decoding/playback errors
    audioEl.addEventListener("error", () => {
      console.error("[TTS] <audio> error (mobile):", audioEl.error);
    });

    const btn = document.createElement("button");
    btn.id = "playReplyBtn";
    btn.textContent = "Tap to hear reply";
    btn.className = "va-play-reply-btn";

    btn.addEventListener("click", () => {
      audioEl
        .play()
        .then(() => {
          console.log("[TTS] Playback OK (mobile tap)");
          if (btn.parentNode) btn.parentNode.removeChild(btn);
        })
        .catch((err) => {
          console.error("[TTS] Playback failed (mobile tap):", err);
        });
    });

    // Append both to the chat area
    chat.appendChild(audioEl);
    chat.appendChild(btn);
    chat.scrollTop = chat.scrollHeight;
  }

  // ---------- Flow guard logic ----------
  function updateFlowGuard(debug, replyText) {
    const flow = debug && debug.flow;
    const step = debug && debug.step;

    const nowInFlow = flow === "food_order" && step != null;
    const wasInFlow = inOrderFlow;
    inOrderFlow = nowInFlow;

    // Toggle banner + beforeunload
    if (inOrderFlow) {
      if (flowWarningEl) flowWarningEl.style.display = "block";
      window.onbeforeunload = function (e) {
        const message =
          "Your food order is in progress. If you close or refresh, you will lose this order.";
        e = e || window.event;
        if (e) e.returnValue = message;
        return message;
      };
    } else {
      if (flowWarningEl) flowWarningEl.style.display = "none";
      window.onbeforeunload = null;
    }

    // Detect order completion/cancellation and clear chat + toast
    if (wasInFlow && !inOrderFlow && replyText) {
      const lower = replyText.toLowerCase();
      if (lower.includes("your food order has been placed")) {
        clearChat();
        showToast("Order complete. Starting fresh.");
      } else if (
        lower.includes("i've canceled the order") ||
        lower.includes("i have canceled the order") ||
        lower.includes("i've cancelled the order") ||
        lower.includes("order has been canceled") ||
        lower.includes("order has been cancelled")
      ) {
        clearChat();
        showToast("Order cancelled. Starting fresh.");
      }
    }
  }

  // ---------- Recording logic ----------
  async function startRecording() {
    chunks = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        micButton.classList.remove("recording");
        micLabel.textContent = "Open Voice Link";
        setStatus("Uploading...", "va-dot-busy");

        const blob = new Blob(chunks, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", blob, "recording.webm");
        formData.append("device_id", DEVICE_ID);
        formData.append("session_id", SESSION_ID);

        try {
          const res = await fetch("/api/voice", {
            method: "POST",
            body: formData,
          });

          const data = await res.json();
          console.log("[MatrixVA] /api/voice response:", data);

          appendChat("user", data.user_text);
          appendChat("bot", data.reply_text);

          // Update flow guard + detect end-of-flow
          updateFlowGuard(data.debug, data.reply_text);

          // TTS playback handling
          if (data.audio_base64 && data.audio_mime) {
            const src = `data:${data.audio_mime};base64,${data.audio_base64}`;
            console.log("[TTS] Got audio with MIME:", data.audio_mime);

            // Prepare generic ttsAudio
            ttsAudio.src = src;
            ttsAudio.load();

            if (!IS_MOBILE) {
              // Desktop: try to auto-play
              ttsAudio
                .play()
                .then(() => console.log("[TTS] Playback OK (desktop)"))
                .catch((err) =>
                  console.error("[TTS] Playback failed (desktop):", err)
                );
            } else {
              // Mobile: show a tap-to-play button with visible audio element
              showPlayReplyButton(src, data.audio_mime);
            }
          } else {
            console.warn("[TTS] No audio returned.");
          }

          setStatus("Ready", "va-dot-idle");
        } catch (err) {
          console.error("Fetch error:", err);
          setStatus("Network error", "va-dot-error");
        }
      };

      mediaRecorder.start();
      micButton.classList.add("recording");
      micLabel.textContent = "Stop";
      setStatus("Recording...", "va-dot-live");
    } catch (err) {
      console.error("Recording error:", err);
      setStatus("Mic blocked", "va-dot-error");
      micButton.classList.remove("recording");
      micLabel.textContent = "Open Voice Link";
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }

  // ---------- Mic button click ----------
  micButton.addEventListener("click", () => {
    // Unlock audio on first user gesture for mobile playback
    unlockAudio();

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      startRecording();
    } else {
      stopRecording();
    }
  });

  setStatus("Ready", "va-dot-idle");
})();
