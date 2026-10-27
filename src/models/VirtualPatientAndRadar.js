import * as THREE from 'three';

/**
 * Virtual Biometric User Avatar + 60 GHz FMCW mmWave Electromagnetic Beam
 * - Translucent holographic human figure (1.70 m) with animated lungs (RR) & beating heart (HR)
 * - 60 GHz radar cone with squinted +22° antenna boresight, E/H transverse electromagnetic waves,
 *   outgoing FMCW chirp wavefronts, and reflected Doppler phase-modulated echoes from the thorax
 */
export class VirtualPatientAndRadar {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'VirtualPatientAndRadarSystem';

    // Virtual Patient Group (standing facing the cane's +X sensor nose)
    this.patientGroup = new THREE.Group();
    this.patientGroup.position.set(0.95, 0, 0);
    this.patientGroup.rotation.y = -Math.PI / 2; // Facing -X (toward cane at origin)
    this.root.add(this.patientGroup);

    // Electromagnetic Beam Group (positioned & oriented in world space from cane radome each frame)
    this.beamGroup = new THREE.Group();
    this.root.add(this.beamGroup);

    // Return Echo Group (travels from patient sternum back to radome when locked)
    this.echoGroup = new THREE.Group();
    this.root.add(this.echoGroup);

    this.interactiveMeshes = [];
    this.txRings = [];
    this.rxRings = [];

    this._sternumLocal = new THREE.Vector3(0, 1.19, 0.11); // Anterior chest wall in patient local coords
    this._tmpSternumWorld = new THREE.Vector3();
    this._tmpRadomePos = new THREE.Vector3();
    this._tmpBoresight = new THREE.Vector3();

    this._buildVirtualPatient();
    this._buildElectromagneticBeam();
    this._buildEchoWaves();
  }

  _buildVirtualPatient() {
    const skinHoloMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.22,
      roughness: 0.25,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.14
    });

    // Floor biometric platform ring (draggable target to reposition virtual user)
    const padGeo = new THREE.CylinderGeometry(0.28, 0.30, 0.012, 40);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.5
    });
    this.patientBaseMesh = new THREE.Mesh(padGeo, padMat);
    this.patientBaseMesh.position.y = 0.006;
    this.patientBaseMesh.userData = {
      interactiveAction: 'drag_patient',
      label: 'Plataforma Usuario Virtual (Arrastrar distancia)'
    };
    this.patientGroup.add(this.patientBaseMesh);
    this.interactiveMeshes.push(this.patientBaseMesh);

    const floorRingGeo = new THREE.RingGeometry(0.31, 0.34, 48);
    floorRingGeo.rotateX(-Math.PI / 2);
    const floorRingMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide
    });
    const floorRing = new THREE.Mesh(floorRingGeo, floorRingMat);
    floorRing.position.y = 0.004;
    this.patientGroup.add(floorRing);

    // Legs
    const legGeo = new THREE.CapsuleGeometry(0.068, 0.68, 10, 18);
    [-0.105, 0.105].forEach((lx) => {
      const leg = new THREE.Mesh(legGeo, skinHoloMat);
      leg.position.set(lx, 0.45, 0);
      this.patientGroup.add(leg);
    });

    // Pelvis & Torso shell
    const torsoGeo = new THREE.CylinderGeometry(0.175, 0.145, 0.54, 28, 6);
    torsoGeo.scale(1.08, 1, 0.68);
    this.torsoMesh = new THREE.Mesh(torsoGeo, skinHoloMat);
    this.torsoMesh.position.set(0, 1.11, 0);
    this.torsoMesh.userData = {
      interactiveAction: 'drag_patient',
      label: 'Usuario Virtual Biométrico'
    };
    this.patientGroup.add(this.torsoMesh);
    this.interactiveMeshes.push(this.torsoMesh);

    const torsoWire = new THREE.Mesh(torsoGeo, wireMat);
    torsoWire.position.copy(this.torsoMesh.position);
    this.patientGroup.add(torsoWire);

    // Shoulders & Arms (slightly relaxed posture)
    const shoulderBarGeo = new THREE.CapsuleGeometry(0.055, 0.36, 8, 16);
    shoulderBarGeo.rotateZ(Math.PI / 2);
    const shoulders = new THREE.Mesh(shoulderBarGeo, skinHoloMat);
    shoulders.position.set(0, 1.36, 0);
    this.patientGroup.add(shoulders);

    const armGeo = new THREE.CapsuleGeometry(0.046, 0.52, 8, 16);
    [-0.23, 0.23].forEach((ax) => {
      const arm = new THREE.Mesh(armGeo, skinHoloMat);
      arm.position.set(ax, 1.07, 0.02);
      arm.rotation.z = ax < 0 ? 0.08 : -0.08;
      this.patientGroup.add(arm);
    });

    // Neck & Head
    const neckGeo = new THREE.CylinderGeometry(0.052, 0.058, 0.09, 18);
    const neck = new THREE.Mesh(neckGeo, skinHoloMat);
    neck.position.set(0, 1.43, 0);
    this.patientGroup.add(neck);

    const headGeo = new THREE.SphereGeometry(0.108, 24, 20);
    headGeo.scale(0.92, 1.12, 0.98);
    const head = new THREE.Mesh(headGeo, skinHoloMat);
    head.position.set(0, 1.56, 0.01);
    this.patientGroup.add(head);

    // --- INTERNAL BIOMETRIC ORGANS: LUNGS (Respiratory Rate) & HEART (Heart Rate) ---
    this.lungsGroup = new THREE.Group();
    this.lungsGroup.position.set(0, 1.20, 0.01);
    this.patientGroup.add(this.lungsGroup);

    this.lungMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4bf,
      emissive: 0x0d9488,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.68,
      roughness: 0.3
    });

    const lungGeo = new THREE.SphereGeometry(0.068, 20, 18);
    lungGeo.scale(0.88, 1.48, 0.78);
    const leftLung = new THREE.Mesh(lungGeo, this.lungMat);
    leftLung.position.set(0.072, 0, 0);
    const rightLung = new THREE.Mesh(lungGeo, this.lungMat);
    rightLung.position.set(-0.072, 0, 0);
    this.lungsGroup.add(leftLung, rightLung);

    // Thoracic rib arcs around lungs
    const ribMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.38
    });
    for (let r = 0; r < 4; r++) {
      const ribGeo = new THREE.TorusGeometry(0.145 - r * 0.008, 0.003, 8, 32, Math.PI * 1.35);
      ribGeo.scale(1.12, 0.72, 1);
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.rotation.x = Math.PI / 2;
      rib.rotation.z = -Math.PI * 0.175;
      rib.position.y = 0.065 - r * 0.045;
      this.lungsGroup.add(rib);
    }

    // Beating 3D Heart (slightly left of sternum -> +X in patient local coords)
    this.heartMat = new THREE.MeshStandardMaterial({
      color: 0xfb7185,
      emissive: 0xf43f5e,
      emissiveIntensity: 0.95,
      roughness: 0.25
    });
    const heartGeo = new THREE.SphereGeometry(0.038, 20, 16);
    heartGeo.scale(0.92, 1.18, 0.88);
    this.heartMesh = new THREE.Mesh(heartGeo, this.heartMat);
    this.heartMesh.position.set(0.036, 1.18, 0.042);
    this.heartMesh.rotation.z = -0.35;
    this.patientGroup.add(this.heartMesh);

    // Sternum Radar Incidence Bullseye Halo (lights up when 60 GHz beam hits chest)
    this.chestSpotGroup = new THREE.Group();
    this.chestSpotGroup.position.copy(this._sternumLocal);
    this.patientGroup.add(this.chestSpotGroup);

    const spotOuter = new THREE.RingGeometry(0.042, 0.055, 32);
    this.spotMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    this.chestSpotRing = new THREE.Mesh(spotOuter, this.spotMat);
    this.chestSpotGroup.add(this.chestSpotRing);

    const spotCore = new THREE.CircleGeometry(0.018, 24);
    const spotCoreMat = new THREE.MeshBasicMaterial({
      color: 0xa7f3d0,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });
    this.chestSpotCore = new THREE.Mesh(spotCore, spotCoreMat);
    this.chestSpotGroup.add(this.chestSpotCore);
  }

  _buildElectromagneticBeam() {
    // Beam local +Z points along propagation vector (we orient beamGroup with lookAt)
    const maxLen = 1.0; // Scaled dynamically along Z to match target distance!
    const halfAngleRad = THREE.MathUtils.degToRad(22);
    const farRadius = Math.tan(halfAngleRad) * maxLen;

    // 1. Translucent Volumetric Radiation Cone
    const coneGeo = new THREE.ConeGeometry(farRadius, maxLen, 36, 1, true);
    coneGeo.translate(0, -maxLen / 2, 0);
    coneGeo.rotateX(-Math.PI / 2); // Tip at (0,0,0), opens toward +Z
    this.coneMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.coneMesh = new THREE.Mesh(coneGeo, this.coneMat);
    this.beamGroup.add(this.coneMesh);

    // Wireframe azimuth/elevation lobe lines
    const wireConeGeo = new THREE.ConeGeometry(farRadius, maxLen, 12, 4, true);
    wireConeGeo.translate(0, -maxLen / 2, 0);
    wireConeGeo.rotateX(-Math.PI / 2);
    this.wireConeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.wireConeMesh = new THREE.Mesh(wireConeGeo, this.wireConeMat);
    this.beamGroup.add(this.wireConeMesh);

    // 2. Propagating 60 GHz FMCW Wavefront Rings (Tx)
    const numRings = 7;
    for (let i = 0; i < numRings; i++) {
      const rGeo = new THREE.TorusGeometry(1, 0.012, 10, 40);
      const rMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x00e5ff : 0x818cf8,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      this.beamGroup.add(rMesh);
      this.txRings.push({ mesh: rMesh, mat: rMat, phaseOffset: i / numRings });
    }

    // 3. Orthogonal E-Field (Cyan) & H-Field (Violet) Transverse Electromagnetic (TEM) Waves
    const waveSamples = 90;
    const ePositions = new Float32Array(waveSamples * 3);
    const hPositions = new Float32Array(waveSamples * 3);

    this.eWaveGeo = new THREE.BufferGeometry();
    this.eWaveGeo.setAttribute('position', new THREE.BufferAttribute(ePositions, 3));
    this.eWaveLine = new THREE.Line(
      this.eWaveGeo,
      new THREE.LineBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.9 })
    );

    this.hWaveGeo = new THREE.BufferGeometry();
    this.hWaveGeo.setAttribute('position', new THREE.BufferAttribute(hPositions, 3));
    this.hWaveLine = new THREE.Line(
      this.hWaveGeo,
      new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.82 })
    );

    this.temGroup = new THREE.Group();
    this.temGroup.add(this.eWaveLine, this.hWaveLine);
    this.root.add(this.temGroup);
  }

  _buildEchoWaves() {
    // Reflected Doppler Phase-Modulated Echo Rings returning from chest to cane Rx
    for (let i = 0; i < 4; i++) {
      const eGeo = new THREE.RingGeometry(0.028, 0.038, 32);
      const eMat = new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const eMesh = new THREE.Mesh(eGeo, eMat);
      this.echoGroup.add(eMesh);
      this.rxRings.push({ mesh: eMesh, mat: eMat, offset: i / 4 });
    }
  }

  update(caneModel, state, elapsedSec) {
    // 1. Animate Virtual User's Lungs (Respiration) & Heart (Cardiac Cycle)
    const respWave = Math.sin(state.respPhaseRad); // -1 .. +1
    const lungScaleY = 1.0 + 0.095 * respWave;
    const lungScaleXZ = 1.0 + 0.085 * respWave;
    this.lungsGroup.scale.set(lungScaleXZ, lungScaleY, lungScaleXZ);
    this.torsoMesh.scale.set(1.08 + 0.022 * respWave, 1.0, 0.68 + 0.032 * respWave);
    this.lungMat.emissiveIntensity = 0.45 + 0.35 * (0.5 + 0.5 * respWave);

    // Sharp systolic pulse on heart
    const sPulse = state.systolicPulse01;
    const hScale = 1.0 + 0.24 * sPulse;
    this.heartMesh.scale.set(0.92 * hScale, 1.18 * hScale, 0.88 * hScale);
    this.heartMat.emissiveIntensity = 0.55 + 1.15 * sPulse;

    // 2. Compute Cane 60GHz Radome World Position & Squinted Boresight (+21° upward elevation)
    caneModel.radomeSocket.getWorldPosition(this._tmpRadomePos);
    const handleQuat = new THREE.Quaternion();
    caneModel.handleGroup.getWorldQuaternion(handleQuat);

    // Squinted local antenna boresight (+21° upward in handle XY plane so upright cane illuminates sternum!)
    const squintRad = THREE.MathUtils.degToRad(21.5);
    this._tmpBoresight
      .set(Math.cos(squintRad), Math.sin(squintRad), 0)
      .applyQuaternion(handleQuat)
      .normalize();

    // Compute Virtual Patient Sternum World Position
    this._tmpSternumWorld.copy(this._sternumLocal);
    this._tmpSternumWorld.z += 0.008 * respWave + 0.002 * sPulse; // Sub-mm / visual chest wall motion
    this.patientGroup.localToWorld(this._tmpSternumWorld);

    // Vector from radome to patient sternum
    const toTarget = new THREE.Vector3().subVectors(this._tmpSternumWorld, this._tmpRadomePos);
    const distToSternum = toTarget.length();
    const dirToSternum = toTarget.clone().normalize();
    const cosAngle = this._tmpBoresight.dot(dirToSternum);
    const offAxisDeg = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, cosAngle))));

    // Determine Radar Lock: enabled, within 0.25..2.6m, and within ±30° antenna cone
    const locked = state.radarEnabled && distToSternum >= 0.25 && distToSternum <= 2.65 && offAxisDeg <= 30.0;
    state.radarLocked = locked;
    state.radarDistanceM = distToSternum;
    state.radarOffAxisDeg = offAxisDeg;

    if (locked) {
      // Realistic SNR (dB) from radar equation ~ 1/r^4 and antenna pattern cos^4(theta)
      const patternGain = Math.pow(Math.max(0.1, cosAngle), 4);
      const rawSnr = 28.5 - 14 * Math.log10(Math.max(0.35, distToSternum)) + 8 * (patternGain - 1);
      state.radarSnrDb = Math.max(4, Math.min(34, rawSnr));
    } else {
      state.radarSnrDb = 0;
    }

    // 3. Render 60 GHz Electromagnetic Beam
    this.beamGroup.visible = state.radarEnabled;
    this.temGroup.visible = state.radarEnabled;
    this.echoGroup.visible = locked;
    this.chestSpotGroup.visible = locked;

    if (!state.radarEnabled) return;

    const beamLength = locked ? distToSternum : 1.25;
    const beamAimPoint = locked
      ? this._tmpSternumWorld
      : this._tmpRadomePos.clone().addScaledVector(this._tmpBoresight, beamLength);

    this.beamGroup.position.copy(this._tmpRadomePos);
    this.beamGroup.lookAt(beamAimPoint);

    // Scale volumetric cone to reach target
    const coneSpread = locked ? 0.68 : 0.85;
    this.coneMesh.scale.set(coneSpread * beamLength, coneSpread * beamLength, beamLength);
    this.wireConeMesh.scale.copy(this.coneMesh.scale);
    this.coneMat.color.setHex(locked ? 0x00e5ff : 0x64748b);
    this.coneMat.opacity = locked ? 0.11 + 0.03 * Math.sin(elapsedSec * 6) : 0.06;

    // Animate 60 GHz Outgoing Wavefront Rings
    const halfAngleTan = Math.tan(THREE.MathUtils.degToRad(15));
    this.txRings.forEach((rObj) => {
      const prog = (elapsedSec * 0.85 + rObj.phaseOffset) % 1.0;
      const zDist = 0.04 + prog * (beamLength - 0.04);
      const radius = Math.max(0.018, zDist * halfAngleTan);
      rObj.mesh.position.set(0, 0, zDist);
      rObj.mesh.scale.set(radius, radius, 1);
      rObj.mat.opacity = (1 - prog) * (locked ? 0.65 : 0.28);
    });

    // Animate Orthogonal E-Field & H-Field Sinusoidal Waves along Boresight
    const beamDir = new THREE.Vector3().subVectors(beamAimPoint, this._tmpRadomePos).normalize();
    const worldUp = Math.abs(beamDir.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const axisH = new THREE.Vector3().crossVectors(beamDir, worldUp).normalize();
    const axisE = new THREE.Vector3().crossVectors(axisH, beamDir).normalize();

    const eArr = this.eWaveGeo.attributes.position;
    const hArr = this.hWaveGeo.attributes.position;
    const count = eArr.count;
    const waveAmp = locked ? 0.042 : 0.025;
    const spatialFreq = 26.0; // Visualized carrier cycles

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const d = u * beamLength;
      const envelope = Math.sin(u * Math.PI); // Smooth taper at antenna & chest
      const osc = Math.sin(d * spatialFreq - elapsedSec * 14.0) * waveAmp * envelope;

      const baseX = this._tmpRadomePos.x + beamDir.x * d;
      const baseY = this._tmpRadomePos.y + beamDir.y * d;
      const baseZ = this._tmpRadomePos.z + beamDir.z * d;

      eArr.setXYZ(i, baseX + axisE.x * osc, baseY + axisE.y * osc, baseZ + axisE.z * osc);
      hArr.setXYZ(i, baseX + axisH.x * osc, baseY + axisH.y * osc, baseZ + axisH.z * osc);
    }
    eArr.needsUpdate = true;
    hArr.needsUpdate = true;

    // 4. Animate Reflected Thoracic Doppler Echoes when Locked
    if (locked) {
      const spotScale = 0.85 + 0.25 * (0.5 + 0.5 * respWave) + 0.22 * sPulse;
      this.chestSpotGroup.scale.setScalar(spotScale);
      this.spotMat.color.setHex(sPulse > 0.5 ? 0x34d399 : 0x00e5ff);

      this.rxRings.forEach((echo) => {
        const p = (elapsedSec * 0.72 + echo.offset) % 1.0;
        echo.mesh.position.lerpVectors(this._tmpSternumWorld, this._tmpRadomePos, p);
        echo.mesh.lookAt(this._tmpRadomePos);
        const s = 0.6 + p * 1.9;
        echo.mesh.scale.set(s, s, 1);
        echo.mat.opacity = (1 - p) * 0.62;
      });
    }
  }
}
