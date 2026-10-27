const PATIENT_PROFILES = [
  { id: 'normal', label: 'Reposo Normal', hr: 72, rr: 15 },
  { id: 'walking', label: 'Esfuerzo de Marcha', hr: 104, rr: 22 },
  { id: 'tachycardia', label: 'Taquicardia / Pre-Síncope', hr: 138, rr: 28 },
  { id: 'bradypnea', label: 'Fatiga / Bradipnea', hr: 56, rr: 10 }
];

const GRIP_PROFILES = {
  ergonomic: {
    label: 'Palmar Ergonómico',
    weights: [0.07, 0.11, 0.15, 0.21, 0.30, 0.16]
  },
  hook: {
    label: 'Gancho Curvo (Crook)',
    weights: [0.24, 0.28, 0.23, 0.14, 0.07, 0.04]
  },
  anterior: {
    label: 'Apoyo Anterior / Pinza',
    weights: [0.03, 0.05, 0.08, 0.14, 0.36, 0.34]
  },
  unstable: {
    label: 'Inestable / Asimétrico',
    weights: [0.26, 0.06, 0.28, 0.08, 0.24, 0.08]
  }
};

export class BiomechanicalEngine {
  constructor({ onImpact, onFallDetected, onFallReset, onSystolicBeat } = {}) {
    this.onImpact = onImpact || (() => {});
    this.onFallDetected = onFallDetected || (() => {});
    this.onFallReset = onFallReset || (() => {});
    this.onSystolicBeat = onSystolicBeat || (() => {});

    this.patientProfileIndex = 0;

    this.state = {
      // Control inputs
      manualGripN: 42,
      manualAxialN: 165,
      interactiveGripBoostN: 0,
      interactiveAxialBoostN: 0,
      gripProfileKey: 'ergonomic',
      gripProfileLabel: GRIP_PROFILES.ergonomic.label,
      gaitAutoEnabled: false,
      radarEnabled: true,
      showSpatialDock: false,

      // Cane orientation & physical state
      isGrabbed: false,
      tiltXRad: 0.0, // Positive tilts toward +X (toward patient)
      tiltZRad: 0.0, // Positive tilts toward +Z (toward viewer)
      yawRad: 0.0,
      targetTiltXRad: 0.0,
      targetTiltZRad: 0.0,

      // Fall dynamics
      isFalling: false,
      isFallen: false,
      fallAzimuthRad: 0.55,
      fallPolarRad: 0,
      fallOmega: 0,
      fallAngleDeg: 0,
      fallTimestampSec: 0,
      peakImpactG: 1.0,
      imuAccelG: 1.0,

      // Computed sensor outputs
      totalGripN: 0,
      fsrForcesN: [0, 0, 0, 0, 0, 0],
      axialForceN: 0,
      footForcesN: [0, 0, 0, 0], // [+X Right, +Z Front, -X Left, -Z Back]
      copX: 0,
      copZ: 0,

      // 60 GHz mmWave Radar & Virtual Patient Vitals
      patientProfileLabel: PATIENT_PROFILES[0].label,
      trueHrBpm: 72,
      trueRrRpm: 15,
      measuredHr: 72,
      measuredRr: 15,
      lastLockedHr: 72,
      lastLockedRr: 15,
      respPhaseRad: 0,
      cardiacPhaseRad: 0,
      systolicPulse01: 0,
      radarLocked: true,
      radarDistanceM: 0.85,
      radarOffAxisDeg: 4.0,
      radarSnrDb: 26.4,

      // GPS Coordinates (Default: Bogotá D.C., Colombia — updatable via Geolocation API)
      gpsLat: 4.710989,
      gpsLon: -74.072092,
      gpsAltM: 2625,
      gpsSourceLabel: 'GNSS L1/L5 · BOGOTÁ D.C.',

      // Oscilloscope rolling histories (160 samples)
      axialHistory: new Array(160).fill(0),
      gripHistory: new Array(160).fill(0),
      dopplerWaveHistory: new Array(160).fill(0),
      imuHistory: new Array(160).fill(1.0)
    };

    this._gaitPhase = 0;
    this._histAccum = 0;
    this._recovering = false;
  }

  setGripProfile(key) {
    if (!GRIP_PROFILES[key]) return;
    this.state.gripProfileKey = key;
    this.state.gripProfileLabel = GRIP_PROFILES[key].label;
  }

  cyclePatientProfile() {
    this.patientProfileIndex = (this.patientProfileIndex + 1) % PATIENT_PROFILES.length;
    const p = PATIENT_PROFILES[this.patientProfileIndex];
    this.state.patientProfileLabel = p.label;
    this.state.trueHrBpm = p.hr;
    this.state.trueRrRpm = p.rr;
    return p;
  }

  setPatientProfileById(id) {
    const idx = PATIENT_PROFILES.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this.patientProfileIndex = idx;
      const p = PATIENT_PROFILES[idx];
      this.state.patientProfileLabel = p.label;
      this.state.trueHrBpm = p.hr;
      this.state.trueRrRpm = p.rr;
    }
  }

  triggerFall(elapsedSec, customAzimuthRad = null) {
    if (this.state.isFallen || this.state.isFalling) return;
    this.state.gaitAutoEnabled = false;
    this.state.isGrabbed = false;
    this.state.isFalling = true;
    this._recovering = false;

    const curTilt = Math.hypot(this.state.tiltXRad, this.state.tiltZRad);
    if (customAzimuthRad !== null) {
      this.state.fallAzimuthRad = customAzimuthRad;
    } else if (curTilt > 0.08) {
      this.state.fallAzimuthRad = Math.atan2(this.state.tiltZRad, this.state.tiltXRad);
    } else {
      // Fall toward front-leftviewer space (+Z, -X) so handle & GPS card remain super clear in view
      this.state.fallAzimuthRad = 2.15;
    }

    this.state.fallPolarRad = Math.max(0.22, curTilt);
    this.state.fallOmega = 1.65; // Initial push angular velocity (rad/s)
    this.state.fallTimestampSec = elapsedSec;
  }

  resetCane() {
    const wasAlert = this.state.isFallen || this.state.isFalling;
    this.state.isFalling = false;
    this.state.isFallen = false;
    this.state.fallOmega = 0;
    this.state.fallPolarRad = 0;
    this.state.targetTiltXRad = 0;
    this.state.targetTiltZRad = 0;
    this.state.peakImpactG = 1.0;
    this._recovering = true;
    if (wasAlert) {
      this.onFallReset();
    }
  }

  updateGpsCoordinates(lat, lon, alt = 2625, label = 'GPS REAL DEL DISPOSITIVO') {
    this.state.gpsLat = lat;
    this.state.gpsLon = lon;
    this.state.gpsAltM = Math.round(alt || 2625);
    this.state.gpsSourceLabel = label;
  }

  step(dtRaw, elapsedSec) {
    const dt = Math.min(0.05, Math.max(0.001, dtRaw));
    const s = this.state;

    // 1. Update Cane Orientation / Fall Rigid-Body Dynamics
    let currentImuG = 1.0;

    if (s.isFalling) {
      const gravityTorque = (9.81 / 0.54) * Math.sin(Math.max(0.08, s.fallPolarRad));
      s.fallOmega += gravityTorque * dt;
      s.fallPolarRad += s.fallOmega * dt;

      // Air acceleration component
      currentImuG = 0.35 + Math.abs(s.fallOmega) * 0.28;

      const floorAngle = (86.8 * Math.PI) / 180;
      if (s.fallPolarRad >= floorAngle) {
        s.fallPolarRad = floorAngle;
        const impactSpeed = Math.abs(s.fallOmega);

        if (impactSpeed > 1.35) {
          const gSpike = Math.min(5.4, 2.6 + impactSpeed * 0.42);
          currentImuG = gSpike;
          if (gSpike > s.peakImpactG) s.peakImpactG = gSpike;
          this.onImpact(Math.min(1.2, impactSpeed / 5.0));
          s.fallOmega = -s.fallOmega * 0.28; // Damped bounce on floor
        } else {
          // Settled on floor -> latch Fall Alert SOS!
          s.fallOmega = 0;
          s.isFalling = false;
          s.isFallen = true;
          s.fallTimestampSec = elapsedSec;
          if (s.peakImpactG < 3.2) s.peakImpactG = 3.68;
          this.onFallDetected(s);
        }
      }

      s.tiltXRad = Math.cos(s.fallAzimuthRad) * s.fallPolarRad;
      s.tiltZRad = Math.sin(s.fallAzimuthRad) * s.fallPolarRad;
    } else if (s.isFallen) {
      const floorAngle = (86.8 * Math.PI) / 180;
      s.tiltXRad = Math.cos(s.fallAzimuthRad) * floorAngle;
      s.tiltZRad = Math.sin(s.fallAzimuthRad) * floorAngle;
      currentImuG = 1.0 + (Math.random() - 0.5) * 0.02;
    } else {
      // Normal upright / interactive / gait operation
      if (s.gaitAutoEnabled && !s.isGrabbed) {
        this._gaitPhase = (this._gaitPhase + dt / 1.48) % 1.0;
        const p = this._gaitPhase;
        // Swing (0..0.34) vs Stance (0.34..1.0)
        if (p < 0.34) {
          const u = p / 0.34;
          s.targetTiltZRad = -0.14 * Math.cos(u * Math.PI);
          s.targetTiltXRad = 0.04 * Math.sin(u * Math.PI);
        } else {
          const u = (p - 0.34) / 0.66;
          s.targetTiltZRad = 0.14 * (1 - 2 * u);
          s.targetTiltXRad = 0.03 * Math.sin(u * Math.PI * 2);
        }
        currentImuG = 1.0 + 0.26 * Math.sin(p * Math.PI * 4);
      }

      const prevTiltX = s.tiltXRad;
      const prevTiltZ = s.tiltZRad;
      const lerpRate = this._recovering ? 7.5 : 12.0;
      s.tiltXRad += (s.targetTiltXRad - s.tiltXRad) * Math.min(1, dt * lerpRate);
      s.tiltZRad += (s.targetTiltZRad - s.tiltZRad) * Math.min(1, dt * lerpRate);

      if (this._recovering && Math.hypot(s.tiltXRad, s.tiltZRad) < 0.01) {
        this._recovering = false;
      }

      const angVel = Math.hypot(s.tiltXRad - prevTiltX, s.tiltZRad - prevTiltZ) / dt;
      currentImuG = Math.max(currentImuG, 1.0 + angVel * 0.18);

      // Automatic physical topple if released past critical stability angle (> 43°)
      const totalTiltDeg = (Math.hypot(s.tiltXRad, s.tiltZRad) * 180) / Math.PI;
      if (!s.isGrabbed && !this._recovering && totalTiltDeg > 43.0) {
        this.triggerFall(elapsedSec);
      }
    }

    s.fallAngleDeg = (Math.hypot(s.tiltXRad, s.tiltZRad) * 180) / Math.PI;
    s.imuAccelG = currentImuG;

    // 2. Compute Biomechanical Grip Force (6x FSR) & Axial Load Cell Force
    let targetGrip = s.manualGripN + s.interactiveGripBoostN;
    let targetAxial = s.manualAxialN + s.interactiveAxialBoostN;

    if (s.isFallen || s.isFalling) {
      targetGrip = 0;
      targetAxial = 0;
    } else if (s.gaitAutoEnabled && !s.isGrabbed) {
      const p = this._gaitPhase;
      if (p < 0.34) {
        // Swing phase: light carry grip, zero floor reaction load
        targetGrip = 19 + 4 * Math.sin(p * Math.PI * 3);
        targetAxial = 0;
      } else {
        // Stance phase: classic bimodal M-curve ground reaction force
        const u = (p - 0.34) / 0.66;
        const envelope = Math.sin(u * Math.PI);
        const bimodal = 1.0 + 0.24 * Math.sin(u * Math.PI * 3 - Math.PI / 2);
        targetAxial = Math.max(0, 225 * envelope * bimodal);
        targetGrip = 26 + 58 * envelope;
      }
    }

    targetGrip = Math.max(0, Math.min(165, targetGrip));
    targetAxial = Math.max(0, Math.min(450, targetAxial));

    s.totalGripN += (targetGrip - s.totalGripN) * Math.min(1, dt * 15);
    s.axialForceN += (targetAxial - s.axialForceN) * Math.min(1, dt * 15);

    // Distribute grip across 6 FSR zones
    const weights = GRIP_PROFILES[s.gripProfileKey].weights;
    for (let i = 0; i < 6; i++) {
      let w = weights[i];
      if (s.gripProfileKey === 'unstable') {
        w *= 1 + 0.35 * Math.sin(elapsedSec * 5.2 + i * 1.4);
      }
      // Couple slight forward/back tilt into anterior (FSR-6) vs hook (FSR-1/2)
      if (i === 5) w *= 1 + Math.max(-0.3, Math.min(0.45, s.tiltXRad * 1.6));
      if (i <= 1) w *= 1 + Math.max(-0.3, Math.min(0.45, -s.tiltXRad * 1.6));
      s.fsrForcesN[i] = Math.max(0, s.totalGripN * w);
    }

    // Normalize FSR sum to match totalGripN cleanly
    const rawSum = s.fsrForcesN.reduce((a, b) => a + b, 0);
    if (rawSum > 0.001) {
      const scale = s.totalGripN / rawSum;
      for (let i = 0; i < 6; i++) s.fsrForcesN[i] *= scale;
    }

    // Solve 4-Foot Quad-Pod Center of Pressure (CoP) distribution:
    // [0]: +X Right, [1]: +Z Front, [2]: -X Left, [3]: -Z Back
    if (s.axialForceN > 0.5 && !s.isFallen && !s.isFalling) {
      const bx = Math.max(-0.85, Math.min(0.85, Math.sin(s.tiltXRad) * 2.6));
      const bz = Math.max(-0.85, Math.min(0.85, Math.sin(s.tiltZRad) * 2.6));

      const wRight = Math.max(0.04, 0.25 * (1 + bx));
      const wLeft  = Math.max(0.04, 0.25 * (1 - bx));
      const wFront = Math.max(0.04, 0.25 * (1 + bz));
      const wBack  = Math.max(0.04, 0.25 * (1 - bz));
      const wTot = wRight + wLeft + wFront + wBack;

      s.footForcesN[0] = (s.axialForceN * wRight) / wTot;
      s.footForcesN[1] = (s.axialForceN * wFront) / wTot;
      s.footForcesN[2] = (s.axialForceN * wLeft) / wTot;
      s.footForcesN[3] = (s.axialForceN * wBack) / wTot;

      const rFoot = 0.122;
      s.copX = ((s.footForcesN[0] - s.footForcesN[2]) / s.axialForceN) * rFoot;
      s.copZ = ((s.footForcesN[1] - s.footForcesN[3]) / s.axialForceN) * rFoot;
    } else {
      s.footForcesN.fill(0);
      s.copX = 0;
      s.copZ = 0;
    }

    // 3. Step 60 GHz mmWave Physiological Oscillators & Doppler Signal
    const prevCardiacCycle = Math.floor(s.cardiacPhaseRad / (Math.PI * 2));
    s.respPhaseRad += (s.trueRrRpm / 60) * Math.PI * 2 * dt;
    s.cardiacPhaseRad += (s.trueHrBpm / 60) * Math.PI * 2 * dt;
    const newCardiacCycle = Math.floor(s.cardiacPhaseRad / (Math.PI * 2));

    const cMod = (s.cardiacPhaseRad % (Math.PI * 2)) / (Math.PI * 2);
    // Realistic systolic R-peak + dicrotic notch pulse shape
    const sysPeak = Math.exp(-Math.pow((cMod - 0.16) / 0.055, 2));
    const dicrotic = 0.32 * Math.exp(-Math.pow((cMod - 0.34) / 0.075, 2));
    s.systolicPulse01 = Math.min(1, sysPeak + dicrotic);

    if (newCardiacCycle > prevCardiacCycle && s.radarLocked && !s.isFallen) {
      this.onSystolicBeat(s.measuredHr);
    }

    if (s.radarLocked) {
      const snrFactor = Math.max(0.05, Math.min(1, s.radarSnrDb / 28));
      const jitter = (1 - snrFactor) * (Math.random() - 0.5) * 1.6;
      s.measuredHr += (s.trueHrBpm + jitter - s.measuredHr) * Math.min(1, dt * 4.0);
      s.measuredRr += (s.trueRrRpm + jitter * 0.25 - s.measuredRr) * Math.min(1, dt * 4.0);
      s.lastLockedHr = s.measuredHr;
      s.lastLockedRr = s.measuredRr;
    }

    // Composite 60 GHz FMCW chest phase waveform Δφ(t)
    const dopplerSample = s.radarLocked
      ? 0.68 * Math.sin(s.respPhaseRad) +
        0.34 * (s.systolicPulse01 - 0.2) +
        (Math.random() - 0.5) * (0.14 * (1 - Math.min(1, s.radarSnrDb / 32)))
      : (Math.random() - 0.5) * 0.06;

    // 4. Push Rolling Oscilloscope Buffers (~30 Hz)
    this._histAccum += dt;
    if (this._histAccum >= 0.033) {
      this._histAccum = 0;
      pushRing(s.axialHistory, s.axialForceN);
      pushRing(s.gripHistory, s.totalGripN);
      pushRing(s.dopplerWaveHistory, dopplerSample);
      pushRing(s.imuHistory, s.imuAccelG);
    }
  }
}

function pushRing(arr, val) {
  arr.shift();
  arr.push(val);
}

export { PATIENT_PROFILES, GRIP_PROFILES };
