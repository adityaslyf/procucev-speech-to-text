/**
 * Text to speech using the browser's built in Web Speech API (on device, free, no API key).
 * Picks a Hindi voice when the text contains Devanagari, otherwise an Indian English voice.
 */
export function speak(text: string) {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const hasDevanagari = /[ऀ-ॿ]/.test(text);
  const wanted = hasDevanagari ? "hi-IN" : "en-IN";
  const voice =
    window.speechSynthesis.getVoices().find((v) => v.lang === wanted) ??
    window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(wanted.slice(0, 2)));
  if (voice) utterance.voice = voice;
  utterance.lang = wanted;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
