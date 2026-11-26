// AudioWorklet: turns mic input (usually 44.1/48 kHz Float32) into 16 kHz PCM16 chunks of ~100 ms.
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.carry = new Float32Array(0);
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outIndex = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    const buf = new Float32Array(this.carry.length + channel.length);
    buf.set(this.carry);
    buf.set(channel, this.carry.length);

    const usable = Math.floor(buf.length / this.ratio);
    let level = 0;
    for (let i = 0; i < usable; i++) {
      const start = Math.floor(i * this.ratio);
      const end = Math.floor((i + 1) * this.ratio);
      let sum = 0;
      for (let j = start; j < end; j++) sum += buf[j];
      const s = Math.max(-1, Math.min(1, sum / (end - start)));
      level = Math.max(level, Math.abs(s));
      this.out[this.outIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outIndex === CHUNK_SAMPLES) {
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(CHUNK_SAMPLES);
        this.outIndex = 0;
        level = 0;
      }
    }
    this.carry = buf.slice(Math.floor(usable * this.ratio));
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
