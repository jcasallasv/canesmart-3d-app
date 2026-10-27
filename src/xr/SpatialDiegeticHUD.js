import * as THREE from 'three';
import { thermalCSS } from '../utils/heatmap.js';

/**
 * 3D Diegetic Spatial Callout Cards & Meta Quest XR Interactive World Console
 * Floats cleanly in 3D/Mixed Reality space around CaneSmart with leader lines:
 * 1. Handle FSR Matrix Spatial Card
 * 2. Load Cell + 4-Foot CoP Spatial Card
 * 3. 60GHz mmWave Vital Signs Spatial Card
 * 4. Interactive XR Spatial Control Dock (clickable via Quest Ray / Hand / Mouse)
 */
export class SpatialDiegeticHUD {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'SpatialDiegeticHUD';

    this.interactiveMeshes = [];
    this.calloutsVisible = true;
    this._lastUpdate = 0;

    this._buildCalloutCards();
    this._buildXrSpatialControlDock();
  }

  _createCanvasPanel(widthPx, heightPx, worldW, worldH) {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(worldW, worldH);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    return { canvas, ctx, tex, mesh };
  }

  _buildCalloutCards() {
    this.calloutsGroup = new THREE.Group();
    this.root.add(this.calloutsGroup);

    // 1. Handle FSR 6-Zone Callout (floats left-above the crook handle)
    this.fsrCard = this._createCanvasPanel(520, 260, 0.36, 0.18);
    this.fsrCard.mesh.position.set(-0.42, 0.96, 0.08);
    this.fsrCard.mesh.rotation.y = 0.22;
    this.calloutsGroup.add(this.fsrCard.mesh);

    this.fsrLeader = this._makeLeaderLine(
      new THREE.Vector3(-0.24, 0.91, 0.04),
      new THREE.Vector3(-0.12, 0.845, 0),
      0x38bdf8
    );
    this.calloutsGroup.add(this.fsrLeader);

    // 2. Axial Load Cell + Quad-Pod CoP Callout (floats left-low near base)
    this.lcCard = this._createCanvasPanel(520, 270, 0.36, 0.185);
    this.lcCard.mesh.position.set(-0.42, 0.24, 0.10);
    this.lcCard.mesh.rotation.y = 0.22;
    this.calloutsGroup.add(this.lcCard.mesh);

    this.lcLeader = this._makeLeaderLine(
      new THREE.Vector3(-0.24, 0.19, 0.05),
      new THREE.Vector3(-0.025, 0.092, 0),
      0x10b981
    );
    this.calloutsGroup.add(this.lcLeader);

    // 3. 60GHz mmWave Radar Vital-Signs Callout (floats above radar beam between cane & patient)
    this.radarCard = this._createCanvasPanel(560, 270, 0.40, 0.192);
    this.radarCard.mesh.position.set(0.46, 1.38, 0.08);
    this.radarCard.mesh.rotation.y = -0.15;
    this.calloutsGroup.add(this.radarCard.mesh);

    this.radarLeader = this._makeLeaderLine(
      new THREE.Vector3(0.46, 1.27, 0.06),
      new THREE.Vector3(0.52, 1.03, 0.0),
      0x00e5ff
    );
    this.calloutsGroup.add(this.radarLeader);
  }

  _makeLeaderLine(p0, p1, hex) {
    const geo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
    const mat = new THREE.LineBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.65
    });
    return new THREE.Line(geo, mat);
  }

  _buildXrSpatialControlDock() {
    // Spatial interactive button dock angled comfortably toward the user in front-left space
    this.dockGroup = new THREE.Group();
    this.dockGroup.position.set(-0.36, 0.58, 0.42);
    this.dockGroup.rotation.set(-0.26, 0.38, 0, 'YXZ');
    this.root.add(this.dockGroup);

    const backingGeo = new THREE.PlaneGeometry(0.44, 0.25);
    const backingMat = new THREE.MeshBasicMaterial({
      color: 0x060d1a,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide
    });
    const backing = new THREE.Mesh(backingGeo, backingMat);
    backing.position.z = -0.004;
    this.dockGroup.add(backing);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(backingGeo),
      new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.65 })
    );
    this.dockGroup.add(border);

    const buttonDefs = [
      { action: 'toggle_gait', label: 'CICLO MARCHA', sub: 'Auto-Carga', x: -0.105, y: 0.062, color: '#0ea5e9' },
      { action: 'cycle_vitals', label: 'ESTADO PACIENTE', sub: '60GHz Perfil', x: 0.105, y: 0.062, color: '#10b981' },
      { action: 'trigger_fall', label: 'SIMULAR CAÍDA', sub: 'SOS + GPS 3D', x: -0.105, y: -0.048, color: '#f43f5e' },
      { action: 'reset_cane', label: 'RESTABLECER', sub: 'Levantar Bastón', x: 0.105, y: -0.048, color: '#f59e0b' }
    ];

    this.dockButtons = buttonDefs.map((def) => {
      const btn = this._createCanvasPanel(320, 140, 0.195, 0.086);
      btn.mesh.position.set(def.x, def.y, 0.002);
      btn.mesh.userData = {
        interactiveAction: def.action,
        label: `${def.label} (${def.sub})`
      };
      this.dockGroup.add(btn.mesh);
      this.interactiveMeshes.push(btn.mesh);
      this._drawDockButton(btn, def, false);
      return { ...def, panel: btn };
    });
  }

  _drawDockButton(btn, def, active) {
    const { ctx, canvas, tex } = btn;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = active ? 'rgba(14, 165, 233, 0.35)' : 'rgba(15, 23, 42, 0.92)';
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.fill();

    ctx.strokeStyle = def.color;
    ctx.lineWidth = active ? 5 : 3;
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.label, w / 2, 62);

    ctx.fillStyle = def.color;
    ctx.font = 'bold 19px monospace';
    ctx.fillText(def.sub, w / 2, 102);
    ctx.textAlign = 'left';

    tex.needsUpdate = true;
  }

  update(state, isXrActive, elapsedSec) {
    this.calloutsGroup.visible = this.calloutsVisible && !state.isFallen;
    // Show the 3D spatial button dock always in XR Passthrough, or when toggled on desktop
    this.dockGroup.visible = isXrActive || state.showSpatialDock;

    if (elapsedSec - this._lastUpdate < 0.10) return;
    this._lastUpdate = elapsedSec;

    if (this.calloutsGroup.visible) {
      this._renderFsrCard(state);
      this._renderLoadCellCard(state);
      this._renderRadarCard(state);
    }

    if (this.dockGroup.visible && this._lastGaitState !== state.gaitAutoEnabled) {
      this._lastGaitState = state.gaitAutoEnabled;
      this._drawDockButton(this.dockButtons[0].panel, this.dockButtons[0], state.gaitAutoEnabled);
    }
  }

  _renderFsrCard(state) {
    const { ctx, canvas, tex } = this.fsrCard;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(7, 13, 25, 0.88)';
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 3;
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('MATRIZ SENSORES FSR EMPUÑADURA', 22, 36);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 34px monospace';
    ctx.fillText(`Σ ${state.totalGripN.toFixed(1)} N`, 22, 80);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px sans-serif';
    ctx.fillText(`Modo: ${state.gripProfileLabel}`, 205, 76);

    // 6 FSR mini thermal bars
    const labels = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
    for (let i = 0; i < 6; i++) {
      const bx = 22 + i * 80;
      const valN = state.fsrForcesN[i] || 0;
      const norm = Math.min(1, valN / 38);

      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      roundRect(ctx, bx, 102, 68, 112, 10);
      ctx.fill();

      const fillH = Math.max(6, Math.round(norm * 104));
      ctx.fillStyle = thermalCSS(norm);
      roundRect(ctx, bx + 4, 102 + 108 - fillH, 60, fillH, 7);
      ctx.fill();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(valN)}N`, bx + 34, 130);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(labels[i], bx + 34, 240);
      ctx.textAlign = 'left';
    }

    tex.needsUpdate = true;
  }

  _renderLoadCellCard(state) {
    const { ctx, canvas, tex } = this.lcCard;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(7, 13, 25, 0.88)';
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.68)';
    ctx.lineWidth = 3;
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.stroke();

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('CELDA DE CARGA AXIAL + CoP 4 PATAS', 20, 36);

    const kgf = state.axialForceN / 9.80665;
    ctx.fillStyle = thermalCSS(Math.min(1, state.axialForceN / 360));
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`${state.axialForceN.toFixed(1)} N`, 20, 84);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`(${kgf.toFixed(1)} kgf)`, 185, 82);

    // 4-Foot CoP Mini Radar on right side
    const cx = 415;
    const cy = 158;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 68, cy);
    ctx.lineTo(cx + 68, cy);
    ctx.moveTo(cx, cy - 68);
    ctx.lineTo(cx, cy + 68);
    ctx.stroke();

    // Foot circles: [0]=Right(+X), [1]=Front(+Z), [2]=Left(-X), [3]=Back(-Z)
    const fCoords = [
      { x: cx + 48, y: cy },
      { x: cx, y: cy + 48 },
      { x: cx - 48, y: cy },
      { x: cx, y: cy - 48 }
    ];
    fCoords.forEach((fc, idx) => {
      const fn = state.footForcesN[idx] || 0;
      const norm = Math.min(1, fn / 130);
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = thermalCSS(norm);
      ctx.fill();
    });

    // CoP dot
    const copPxX = cx + (state.copX / 0.122) * 48;
    const copPxY = cy + (state.copZ / 0.122) * 48;
    ctx.beginPath();
    ctx.arc(copPxX, copPxY, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Left text breakdown
    const names = ['Der (+X)', 'Fro (+Z)', 'Izq (-X)', 'Tra (-Z)'];
    ctx.font = '19px monospace';
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${names[i]}:`, 22, 128 + i * 32);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`${Math.round(state.footForcesN[i] || 0)} N`, 132, 128 + i * 32);
    }

    tex.needsUpdate = true;
  }

  _renderRadarCard(state) {
    const { ctx, canvas, tex } = this.radarCard;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(7, 13, 25, 0.88)';
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.strokeStyle = state.radarLocked ? 'rgba(0, 229, 255, 0.78)' : 'rgba(100, 116, 139, 0.6)';
    ctx.lineWidth = 3;
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.stroke();

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('RADAR mmWave 60.0 GHz FMCW (λ=5mm)', 20, 36);

    if (!state.radarLocked) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 25px sans-serif';
      ctx.fillText('SIN ECO TORÁCICO EN CONO (±30°)', 22, 96);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '19px sans-serif';
      ctx.fillText('Oriente la punta frontal del bastón hacia el usuario virtual', 22, 138);
    } else {
      // Heart rate & Respiratory rate boxes
      ctx.fillStyle = 'rgba(244, 63, 94, 0.16)';
      roundRect(ctx, 20, 56, 248, 96, 12);
      ctx.fill();
      ctx.fillStyle = '#fb7185';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('♥ FREC. CARDÍACA', 34, 84);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px monospace';
      ctx.fillText(`${Math.round(state.measuredHr)} BPM`, 34, 134);

      ctx.fillStyle = 'rgba(45, 212, 191, 0.16)';
      roundRect(ctx, 286, 56, 252, 96, 12);
      ctx.fill();
      ctx.fillStyle = '#2dd4bf';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('~ FREC. RESPIRATORIA', 300, 84);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px monospace';
      ctx.fillText(`${Math.round(state.measuredRr)} RPM`, 300, 134);

      // Distance & SNR bar
      ctx.fillStyle = '#94a3b8';
      ctx.font = '19px monospace';
      ctx.fillText(
        `Rango: ${state.radarDistanceM.toFixed(2)} m  |  Ángulo: ${state.radarOffAxisDeg.toFixed(1)}°  |  SNR: ${state.radarSnrDb.toFixed(1)} dB`,
        22,
        186
      );

      // Mini Doppler Phase Waveform strip
      const hist = state.dopplerWaveHistory;
      if (hist && hist.length > 2) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const n = Math.min(80, hist.length);
        const start = hist.length - n;
        for (let i = 0; i < n; i++) {
          const px = 22 + (i / (n - 1)) * (w - 44);
          const py = 228 - hist[start + i] * 22;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    tex.needsUpdate = true;
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
