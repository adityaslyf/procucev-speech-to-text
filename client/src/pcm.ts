/**
 * Downsamples mono Float32 audio to a lower rate by averaging, and converts to 16-bit PCM.
 * Used by the audio worklet (which ships a copy of this logic) and covered by unit tests.
 */
export function downsampleToInt16(input: Float32Array, inputRate: number, targetRate = 16000): Int16Array {
  if (targetRate > inputRate) throw new Error("targetRate must be <= inputRate");
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}
