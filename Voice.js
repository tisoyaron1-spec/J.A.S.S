// @ts-nocheck
const JASS_VOICE = {
  enabled: true,
  isListening: false,
  continuousMode: false,
  recognition: null
};

function toggleVoiceOutput() {
  JASS_VOICE.enabled = !JASS_VOICE.enabled;
  if (!JASS_VOICE.enabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  return JASS_VOICE.enabled;
}

function speakJASS(text, onEndCallback = null) {
  if (!JASS_VOICE.enabled || !("speechSynthesis" in window)) {
    if (typeof onEndCallback === "function") onEndCallback();
    return;
  }

  window.speechSynthesis.cancel();

  // Strip fenced code blocks and markdown symbols so voice reads cleanly
  const spokenSummary = String(text || "")
    .replace(/```[\s\S]*?```/g, "Code module ready in the Creation and Search Studio.")
    .replace(/\[TRUNCATED_MAX_TOKENS\]/g, "")
    .replace(/[*#`>_~]/g, "")
    .trim()
    .slice(0, 420);

  if (!spokenSummary) {
    if (typeof onEndCallback === "function") onEndCallback();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(spokenSummary);
  utterance.rate = 1.03;
  utterance.pitch = 0.95;

  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /UK English Male|Daniel|Google UK English Male|Alex/i.test(v.name)) ||
    voices.find((v) => /en-GB|en-US/i.test(v.lang));
  if (preferred) utterance.voice = preferred;

  utterance.onend = () => {
    if (typeof onEndCallback === "function") onEndCallback();
  };
  utterance.onerror = () => {
    if (typeof onEndCallback === "function") onEndCallback();
  };

  window.speechSynthesis.speak(utterance);
}

function toggleListening(onTranscript, onStatusChange) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    if (onStatusChange) onStatusChange("Voice recognition not supported in this browser.");
    return;
  }

  if (JASS_VOICE.isListening && JASS_VOICE.recognition) {
    JASS_VOICE.continuousMode = false;
    JASS_VOICE.recognition.stop();
    JASS_VOICE.isListening = false;
    if (onStatusChange) onStatusChange("idle");
    return;
  }

  const recognition = new SpeechRec();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  JASS_VOICE.recognition = recognition;
  JASS_VOICE.isListening = true;
  if (onStatusChange) onStatusChange("Listening...");

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
    JASS_VOICE.isListening = false;
    if (onStatusChange) onStatusChange("idle");

    if (/^stop listening$/i.test(transcript)) {
      JASS_VOICE.continuousMode = false;
      return;
    }

    if (transcript && typeof onTranscript === "function") {
      onTranscript(transcript);
    }
  };

  recognition.onerror = (event) => {
    JASS_VOICE.isListening = false;
    if (onStatusChange) onStatusChange(`Mic error: ${event.error}`);
  };

  recognition.onend = () => {
    JASS_VOICE.isListening = false;
    if (onStatusChange) onStatusChange("idle");
  };

  recognition.start();
}

window.JASS_VOICE = JASS_VOICE;
window.toggleVoiceOutput = toggleVoiceOutput;
window.speakJASS = speakJASS;
window.toggleListening = toggleListening;
