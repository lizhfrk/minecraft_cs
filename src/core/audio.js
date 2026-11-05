/**
 * 程序化音效：全部由 WebAudio 合成，不依赖音频文件。
 * @module core/audio
 */
export class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.master = null;
    /** @type {AudioBuffer|null} */
    this.noiseBuffer = null;
    this.enabled = true;
    this.volume = 0.55;
  }

  /** 必须在用户手势中调用。 */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      this.enabled = false;
      return;
    }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  /** @param {number} value */
  setVolume(value) {
    this.volume = value;
    if (this.master) this.master.gain.value = value;
  }

  /**
   * 单音（含滑音）。
   * @param {number} freq @param {number} dur @param {OscillatorType} type
   * @param {number} gain @param {number} [toFreq] @param {number} [delay]
   */
  tone(freq, dur, type = 'square', gain = 0.3, toFreq = null, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (toFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.015, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /**
   * 噪声（含滤波扫描）。
   * @param {number} dur @param {number} gain @param {number} [filterFreq]
   * @param {number} [toFreq] @param {BiquadFilterType} [type]
   */
  noise(dur, gain = 0.3, filterFreq = 1200, toFreq = null, type = 'bandpass') {
    if (!this.ctx || !this.enabled || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, t0);
    if (toFreq !== null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), t0 + dur);
    }
    filter.Q.value = 1.1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /* --------------------------- 音效表 --------------------------- */

  swordSwing() {
    this.noise(0.16, 0.16, 2600, 700);
  }

  swordHit() {
    this.noise(0.1, 0.3, 1600, 500);
    this.tone(180, 0.12, 'square', 0.16, 90);
  }

  blockHit() {
    this.noise(0.12, 0.2, 900, 320, 'lowpass');
  }

  blockBreak() {
    this.noise(0.28, 0.26, 1500, 260, 'lowpass');
    this.tone(120, 0.2, 'triangle', 0.1, 60);
  }

  blockPlace() {
    this.noise(0.1, 0.22, 700, 220, 'lowpass');
  }

  bowDraw() {
    this.tone(320, 0.28, 'triangle', 0.09, 560);
  }

  bowRelease() {
    this.noise(0.18, 0.24, 2200, 500);
    this.tone(520, 0.12, 'triangle', 0.12, 260);
  }

  arrowHit() {
    this.noise(0.09, 0.24, 2400, 700);
  }

  arrowHitPlayer() {
    this.tone(240, 0.12, 'sawtooth', 0.14, 140);
  }

  hurt() {
    this.tone(330, 0.22, 'sawtooth', 0.22, 150);
    this.noise(0.16, 0.14, 800, 200);
  }

  pickup() {
    this.tone(660, 0.07, 'square', 0.12);
    this.tone(880, 0.09, 'square', 0.11, 990, 0.06);
  }

  eat() {
    this.noise(0.18, 0.16, 700, 300, 'lowpass');
  }

  chestOpen() {
    this.noise(0.3, 0.2, 420, 160, 'lowpass');
    this.tone(140, 0.25, 'triangle', 0.1, 220);
  }

  zombieGroan() {
    const base = 90 + Math.random() * 40;
    this.tone(base, 0.7, 'sawtooth', 0.14, base * 0.55);
    this.noise(0.5, 0.07, 380, 150, 'lowpass');
  }

  skeletonRattle() {
    this.noise(0.16, 0.16, 2400, 900);
    this.tone(1400, 0.08, 'square', 0.05, 900);
  }

  creeperHiss() {
    this.noise(1.1, 0.2, 5200, 900);
  }

  explode() {
    this.noise(0.85, 0.5, 900, 60, 'lowpass');
    this.tone(70, 0.6, 'sawtooth', 0.28, 30);
  }

  dragonRoar() {
    this.tone(70, 1.4, 'sawtooth', 0.26, 42);
    this.tone(105, 1.2, 'square', 0.1, 58);
    this.noise(1.1, 0.14, 700, 160, 'lowpass');
  }

  dragonBreath() {
    this.noise(0.9, 0.22, 3200, 600);
  }

  crystalBreak() {
    this.noise(0.4, 0.26, 5200, 1400);
    this.tone(1600, 0.25, 'triangle', 0.12, 420);
  }

  teleport() {
    this.tone(900, 0.3, 'sine', 0.12, 180);
    this.noise(0.3, 0.1, 4000, 800);
  }

  step() {
    this.noise(0.07, 0.07, 520, 180, 'lowpass');
  }

  hitmarker() {
    this.tone(1400, 0.05, 'square', 0.11, 1000);
  }

  levelUp() {
    this.tone(660, 0.1, 'square', 0.12);
    this.tone(880, 0.1, 'square', 0.12, 990, 0.09);
    this.tone(1320, 0.18, 'square', 0.12, 1320, 0.18);
  }

  victory() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.4, 'square', 0.14, f, i * 0.18));
  }

  defeat() {
    const notes = [440, 349, 262, 196];
    notes.forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.16, f * 0.98, i * 0.22));
  }
}

export const audio = new AudioEngine();
