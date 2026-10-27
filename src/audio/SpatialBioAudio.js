export class SpatialBioAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.panner = null;
    this.muted = false;
    this.vitalBeepEnabled = false;
    this.alarmActive = false;
    this.alarmTimer = null;
    this._alarmStep = 0;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72;

      this.panner = this.ctx.createPanner();
      this.panner.panningModel = 'HRTF';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 0.8;
      this.panner.maxDistance = 12;
      this.panner.rolloffFactor = 1.1;

      this.panner.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.03);
    }
    if (muted && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  updateSpatialTransform(sourceWorldPos, camera) {
    if (!this.ctx || !this.panner || !sourceWorldPos || !camera) return;
    const t = this.ctx.currentTime;
    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(sourceWorldPos.x, t, 0.02);
      this.panner.positionY.setTargetAtTime(sourceWorldPos.y, t, 0.02);
      this.panner.positionZ.setTargetAtTime(sourceWorldPos.z, t, 0.02);
    } else {
      this.panner.setPosition(sourceWorldPos.x, sourceWorldPos.y, sourceWorldPos.z);
    }

    const listener = this.ctx.listener;
    const camPos = camera.position;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(camPos.x, t, 0.02);
      listener.positionY.setTargetAtTime(camPos.y, t, 0.02);
      listener.positionZ.setTargetAtTime(camPos.z, t, 0.02);
    } else if (listener.setPosition) {
      listener.setPosition(camPos.x, camPos.y, camPos.z);
    }
  }

  playClick(freq = 680) {
    if (this.muted || !this.ensureContext()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 0.045);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(this.panner);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playImpactThud(intensity = 1.0) {
    if (this.muted || !this.ensureContext()) return;
    const now = this.ctx.currentTime;
    const amp = Math.min(1.2, Math.max(0.25, intensity));

    // Low floor thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.22);

    gain.gain.setValueAtTime(0.55 * amp, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(this.panner);
    osc.start(now);
    osc.stop(now + 0.28);

    // Metallic aluminum cane body clatter
    const metal = this.ctx.createOscillator();
    const mGain = this.ctx.createGain();
    metal.type = 'sine';
    metal.frequency.setValueAtTime(1320, now);
    metal.frequency.exponentialRampToValueAtTime(760, now + 0.14);

    mGain.gain.setValueAtTime(0.16 * amp, now);
    mGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    metal.connect(mGain);
    mGain.connect(this.panner);
    metal.start(now);
    metal.stop(now + 0.17);
  }

  playVitalPulse(hrBpm = 72) {
    if (this.muted || !this.vitalBeepEnabled || this.alarmActive) return;
    if (!this.ensureContext()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const pitch = hrBpm > 115 ? 988 : hrBpm < 58 ? 659 : 830;
    osc.frequency.setValueAtTime(pitch, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.panner);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  startFallAlarm(coordsText = '') {
    if (this.alarmActive) return;
    this.alarmActive = true;
    this._alarmStep = 0;
    this.ensureContext();

    this._triggerAlarmBurst();
    this.alarmTimer = window.setInterval(() => {
      if (!this.alarmActive) return;
      this._triggerAlarmBurst();
    }, 1850);

    // Spoken alert in Spanish
    if (!this.muted && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(
          `Alerta crítica de caída detectada en bastón CaneSmart. Baliza S O S activa. ${coordsText}`
        );
        utter.lang = 'es-CO';
        utter.rate = 1.04;
        utter.pitch = 1.02;
        window.speechSynthesis.speak(utter);
      } catch (_) {
        // Ignore speech synthesis errors on restricted browsers
      }
    }
  }

  _triggerAlarmBurst() {
    if (this.muted || !this.ensureContext()) return;
    const now = this.ctx.currentTime;
    // IEC 60601-1-8 urgent medical alarm burst (C5 - E5 - G5 - C6 - G5)
    const notes = [523.25, 659.25, 783.99, 1046.5, 987.77];
    const offsets = [0.0, 0.16, 0.32, 0.56, 0.76];

    notes.forEach((freq, idx) => {
      const t0 = now + offsets[idx];
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, t0);
      osc2.frequency.setValueAtTime(freq * 2, t0);

      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.26, t0 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.002, t0 + 0.135);

      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.22;

      osc1.connect(gain);
      osc2.connect(subGain);
      subGain.connect(gain);
      gain.connect(this.panner);

      osc1.start(t0);
      osc2.start(t0);
      osc1.stop(t0 + 0.145);
      osc2.stop(t0 + 0.145);
    });
  }

  stopFallAlarm(announceReset = true) {
    const wasActive = this.alarmActive;
    this.alarmActive = false;
    if (this.alarmTimer) {
      clearInterval(this.alarmTimer);
      this.alarmTimer = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (wasActive && !this.muted && this.ensureContext()) {
      // Pleasant confirmation recovery chime
      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + i * 0.09);
        g.gain.setValueAtTime(0.16, now + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.22);
        osc.connect(g);
        g.connect(this.panner);
        osc.start(now + i * 0.09);
        osc.stop(now + i * 0.09 + 0.24);
      });

      if (announceReset && 'speechSynthesis' in window) {
        try {
          const u = new SpeechSynthesisUtterance('Bastón restablecido. Monitoreo biométrico normal.');
          u.lang = 'es-CO';
          u.rate = 1.06;
          window.speechSynthesis.speak(u);
        } catch (_) {}
      }
    }
  }
}
