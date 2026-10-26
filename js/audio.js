// Web Audio chime. Sound can only start after a user gesture; this module is honest
// about whether playback is actually unlocked in the current session.

export const ALARM_MAX_MS = 20000;
const ALARM_REPEAT_MS = 2200;

export class Audio {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.ctx = null;
    this.enabled = true;     // user preference (saved); NOT proof that playback works
    this.error = null;
    this.alarmTimer = null;
    this.alarmStop = null;
    this.alarming = false;
    this.stats = { chimes: 0, alarmsStarted: 0 };
  }

  get supported() { return !!(globalThis.AudioContext || globalThis.webkitAudioContext); }

  /** 'unsupported' | 'disabled' | 'locked' | 'ready' | 'error' */
  get status() {
    if (!this.supported) return 'unsupported';
    if (!this.enabled) return 'disabled';
    if (this.error) return 'error';
    return this.ctx && this.ctx.state === 'running' ? 'ready' : 'locked';
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.stopAlarm();
    this.onChange();
  }

  /** Must be called from a user gesture (tap). Resolves true only if audio is really running. */
  async unlock() {
    if (!this.supported) return false;
    try {
      if (!this.ctx) {
        const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
        this.ctx = new Ctor();
        this.ctx.onstatechange = () => this.onChange();
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      // Tiny silent buffer finishes the iOS unlock.
      const buf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.connect(this.ctx.destination); src.start(0);
      this.error = this.ctx.state === 'running' ? null : 'Audio is still blocked by the browser.';
    } catch (e) {
      this.error = 'Audio could not start on this device.';
    }
    this.onChange();
    return this.ctx && this.ctx.state === 'running';
  }

  /** One short two-note chime. Returns false when it could not play. */
  chime() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return false;
    try {
      const t0 = this.ctx.currentTime + 0.02;
      [[659.25, 0], [880, 0.22], [1318.5, 0.44]].forEach(([freq, off]) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = t0 + off;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t); osc.stop(t + 0.95);
      });
      this.stats.chimes += 1;
      return true;
    } catch {
      this.error = 'Playback failed.'; this.onChange();
      return false;
    }
  }

  async test() {
    const ok = await this.unlock();
    return ok && this.chime();
  }

  /** Bounded repeating chime. Never overlaps: a second call while one is active is ignored. */
  startAlarm(onEnd = () => {}) {
    if (this.alarming) return false;
    this.alarming = true;
    this.stats.alarmsStarted += 1;
    const finish = () => {
      clearInterval(this.alarmTimer); clearTimeout(this.alarmStop);
      this.alarmTimer = this.alarmStop = null;
      const was = this.alarming; this.alarming = false;
      if (was) onEnd();
    };
    this.chime();
    this.alarmTimer = setInterval(() => this.chime(), ALARM_REPEAT_MS);
    this.alarmStop = setTimeout(finish, ALARM_MAX_MS);
    return true;
  }

  stopAlarm() {
    if (!this.alarming) return;
    this.alarming = false;
    clearInterval(this.alarmTimer); clearTimeout(this.alarmStop);
    this.alarmTimer = this.alarmStop = null;
  }
}
