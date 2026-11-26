import { describe, expect, it } from "vitest";
import { buildSetupMessage, LANGUAGE_PRESETS, parseGeminiMessage } from "./liveRelay.js";

describe("parseGeminiMessage", () => {
  it("emits ready on setupComplete", () => {
    expect(parseGeminiMessage({ setupComplete: {} })).toEqual([{ type: "ready" }]);
  });

  it("extracts interim and final transcription", () => {
    const events = parseGeminiMessage({
      serverContent: {
        interimInputTranscription: { text: "mera naam" },
        inputTranscription: { text: "Mera naam Aditya hai and I build web apps." },
      },
    });
    expect(events).toEqual([
      { type: "interim", text: "mera naam" },
      { type: "final", text: "Mera naam Aditya hai and I build web apps." },
    ]);
  });

  it("ignores unrelated messages", () => {
    expect(parseGeminiMessage({ serverContent: { turnComplete: true } })).toEqual([]);
    expect(parseGeminiMessage(null)).toEqual([]);
  });
});

describe("buildSetupMessage", () => {
  it("uses auto detection by default and Hindi plus English preset", () => {
    expect(buildSetupMessage("gemini-3.5-transcribe-live", LANGUAGE_PRESETS.auto)).toEqual({
      setup: {
        model: "models/gemini-3.5-transcribe-live",
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: { languageCodes: [] },
      },
    });
    expect(LANGUAGE_PRESETS["hi-en"]).toEqual(["hi-IN", "en-IN"]);
  });
});
