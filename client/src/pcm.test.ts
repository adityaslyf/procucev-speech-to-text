import { describe, expect, it } from "vitest";
import { downsampleToInt16 } from "./pcm";

describe("downsampleToInt16", () => {
  it("reduces 48 kHz to 16 kHz (3:1)", () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsampleToInt16(input, 48000, 16000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(Math.floor(0.5 * 0x7fff));
  });

  it("clamps and maps negative full scale", () => {
    const out = downsampleToInt16(new Float32Array([-2, -2, -2]), 48000, 16000);
    expect(out[0]).toBe(-32768);
  });

  it("rejects upsampling", () => {
    expect(() => downsampleToInt16(new Float32Array(10), 8000, 16000)).toThrow();
  });
});
