// Sound — everything is synthesized with WebAudio: no audio files, no network.
// An engine hum that follows speed, a two-tone police siren, gunshots, punches,
// cash chimes and a slow sunset chord pad for the menu and the drive.
export function createAudio() {
  const audio = {
    ctx: null, muted: false, engineOsc: null, engineGain: null, padNodes: [],
    sirenTimer: 0, sirenOn: false,
    ensure() {
      if (this.ctx) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 55;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 320;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(filter).connect(this.engineGain).connect(this.ctx.destination);
        this.engineOsc.start();
        return true;
      } catch { return false; }
    },
    resume() {
      if (this.ensure() && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },
    setEngine(speed, inCar) {
      if (!this.ctx || this.muted) { if (this.engineGain) this.engineGain.gain.value = 0; return; }
      const target = inCar ? 0.05 + Math.min(0.1, Math.abs(speed) * 0.0025) : 0;
      this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
      this.engineOsc.frequency.setTargetAtTime(50 + Math.abs(speed) * 3.2, this.ctx.currentTime, 0.1);
    },
    blip(freq, dur, type = 'sine', vol = 0.15) {
      if (!this.ensure() || this.muted) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur);
    },
    noise(dur, vol = 0.25) {
      if (!this.ensure() || this.muted) return;
      const t = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = vol;
      src.connect(gain).connect(this.ctx.destination);
      src.start(t);
    },
    gunshot() { this.noise(0.18, 0.3); this.blip(120, 0.12, 'square', 0.12); },
    punch() { this.noise(0.08, 0.2); this.blip(90, 0.1, 'sine', 0.2); },
    cash() { this.blip(880, 0.12, 'sine', 0.15); setTimeout(() => this.blip(1318, 0.2, 'sine', 0.15), 90); },
    pickup() { this.blip(660, 0.1, 'triangle', 0.15); setTimeout(() => this.blip(990, 0.15, 'triangle', 0.15), 80); },
    busted() { this.blip(220, 0.4, 'sawtooth', 0.15); setTimeout(() => this.blip(165, 0.5, 'sawtooth', 0.15), 200); },
    siren(dt, wanted) {
      if (!this.ctx || this.muted || wanted === 0) return;
      this.sirenTimer -= dt;
      if (this.sirenTimer > 0) return;
      this.sirenTimer = 0.45;
      this.sirenOn = !this.sirenOn;
      this.blip(this.sirenOn ? 740 : 560, 0.4, 'sine', 0.05);
    },
    startPad() {
      if (!this.ensure() || this.muted || this.padNodes.length) return;
      const freqs = [130.8, 164.8, 196.0, 246.9];
      for (const f of freqs) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle'; osc.frequency.value = f;
        const gain = this.ctx.createGain();
        gain.gain.value = 0.02;
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 0.07 + Math.random() * 0.05;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.012;
        lfo.connect(lfoGain).connect(gain.gain);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(); lfo.start();
        this.padNodes.push(osc, lfo);
      }
    },
    toggleMute() {
      this.muted = !this.muted;
      if (this.engineGain) this.engineGain.gain.value = 0;
      return this.muted;
    },
  };
  return audio;
}
