#Fix App.JS Mobile

  // ---------- Global TTS audio element (mobile fix) ----------
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
