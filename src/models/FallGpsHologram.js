import * as THREE from 'three';
import { formatDMS } from '../utils/heatmap.js';

/**
 * 3D Spatial GPS Coordinates & Emergency SOS Hologram
 * Deploys dynamically into the user's 3D / Mixed-Reality space upon Fall Detection:
 * - Ground shockwave rings + compass rose reticle
 * - Vertical SOS beacon pillar
 * - Orbiting 3D GNSS satellite triangulation ring
 * - High-DPI 3D floating GPS coordinate & telemetry card (interactive reset target)
 */
export class FallGpsHologram {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'FallGpsHologram3D';
    this.root.visible = false;

    this.interactiveMeshes = [];
    this.shockRings = [];
    this.satellites = [];
    this._lastCardDraw = 0;
    this._deployAnim = 0;

    this._buildFloorCompassAndShockwaves();
    this._buildVerticalBeaconAndSatellites();
    this._buildFloatingGpsCard();
  }

  _buildFloorCompassAndShockwaves() {
    // High-DPI Floor Compass & Geo-Target Reticle
    const cCanvas = document.createElement('canvas');
    cCanvas.width = 512;
    cCanvas.height = 512;
    const ctx = cCanvas.getContext('2d');
    const cx = 256;
    const cy = 256;

    ctx.clearRect(0, 0, 512, 512);
    // Concentric tactical geo-rings
    [235, 185, 130, 72].forEach((r, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = idx === 0 ? 'rgba(255, 46, 76, 0.85)' : 'rgba(251, 191, 36, 0.45)';
      ctx.lineWidth = idx === 0 ? 4 : 2;
      if (idx === 1) ctx.setLineDash([10, 8]);
      else ctx.setLineDash([]);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Degree ticks
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const r0 = deg % 45 === 0 ? 212 : 224;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0);
      ctx.lineTo(cx + Math.cos(rad) * 235, cy + Math.sin(rad) * 235);
      ctx.strokeStyle = 'rgba(255, 90, 110, 0.8)';
      ctx.lineWidth = deg % 90 === 0 ? 4 : 2;
      ctx.stroke();
    }

    // Cardinal labels (N, E, S, O)
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, 36);
    ctx.fillText('S', cx, 476);
    ctx.fillText('E', 476, cy);
    ctx.fillText('O', 36, cy);

    const compassTex = new THREE.CanvasTexture(cCanvas);
    compassTex.colorSpace = THREE.SRGBColorSpace;
    const compassGeo = new THREE.PlaneGeometry(1.15, 1.15);
    compassGeo.rotateX(-Math.PI / 2);
    this.compassMesh = new THREE.Mesh(
      compassGeo,
      new THREE.MeshBasicMaterial({
        map: compassTex,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.compassMesh.position.y = 0.005;
    this.root.add(this.compassMesh);

    // 3 Expanding Shockwave Rings
    for (let i = 0; i < 3; i++) {
      const rGeo = new THREE.RingGeometry(0.18, 0.215, 48);
      rGeo.rotateX(-Math.PI / 2);
      const rMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xff2e4c : 0xf59e0b,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.y = 0.007;
      this.root.add(rMesh);
      this.shockRings.push({ mesh: rMesh, mat: rMat, offset: i / 3 });
    }
  }

  _buildVerticalBeaconAndSatellites() {
    // Vertical Holographic Emergency SOS Light Column
    const pillarGeo = new THREE.CylinderGeometry(0.035, 0.095, 1.55, 28, 1, true);
    pillarGeo.translate(0, 0.775, 0);
    this.pillarMat = new THREE.MeshBasicMaterial({
      color: 0xff2e4c,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.pillarMesh = new THREE.Mesh(pillarGeo, this.pillarMat);
    this.root.add(this.pillarMesh);

    // Orbital GNSS Satellite Ring at y = 1.48 m
    this.orbitGroup = new THREE.Group();
    this.orbitGroup.position.set(0, 1.48, 0);
    this.root.add(this.orbitGroup);

    const orbitRingGeo = new THREE.TorusGeometry(0.38, 0.0035, 10, 64);
    orbitRingGeo.rotateX(Math.PI / 2);
    const orbitRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65
    });
    this.orbitGroup.add(new THREE.Mesh(orbitRingGeo, orbitRingMat));

    // 3 Orbiting GNSS Satellites with Triangulation Lock Lines down to impact point (0, -1.48, 0)
    for (let s = 0; s < 3; s++) {
      const angle = (s * Math.PI * 2) / 3;
      const sx = Math.cos(angle) * 0.38;
      const sz = Math.sin(angle) * 0.38;

      const satNode = new THREE.Group();
      satNode.position.set(sx, 0, sz);

      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.022, 0),
        new THREE.MeshBasicMaterial({ color: 0xfde047 })
      );
      satNode.add(core);

      const wingGeo = new THREE.BoxGeometry(0.075, 0.004, 0.022);
      const wing = new THREE.Mesh(
        wingGeo,
        new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85 })
      );
      satNode.add(wing);

      // Triangulation ray from satellite down to origin (0, -1.48, 0 in orbitGroup space)
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-sx, -1.47, -sz)
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.42
      });
      satNode.add(new THREE.Line(lineGeo, lineMat));

      this.orbitGroup.add(satNode);
      this.satellites.push(satNode);
    }
  }

  _buildFloatingGpsCard() {
    this.cardPivot = new THREE.Group();
    this.cardPivot.position.set(0, 0.96, 0);
    this.root.add(this.cardPivot);

    this.cardCanvas = document.createElement('canvas');
    this.cardCanvas.width = 960;
    this.cardCanvas.height = 560;
    this.cardCtx = this.cardCanvas.getContext('2d');

    this.cardTex = new THREE.CanvasTexture(this.cardCanvas);
    this.cardTex.colorSpace = THREE.SRGBColorSpace;
    this.cardTex.anisotropy = 4;

    const cardGeo = new THREE.PlaneGeometry(0.76, 0.445);
    this.cardMat = new THREE.MeshBasicMaterial({
      map: this.cardTex,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.cardMesh = new THREE.Mesh(cardGeo, this.cardMat);
    this.cardMesh.userData = {
      interactiveAction: 'reset_cane',
      label: 'Cancelar SOS y Restablecer Bastón CaneSmart'
    };
    this.cardPivot.add(this.cardMesh);
    this.interactiveMeshes.push(this.cardMesh);

    // Subtle outer neon frame behind card
    const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.775, 0.46));
    const borderLine = new THREE.LineSegments(
      borderGeo,
      new THREE.LineBasicMaterial({ color: 0xff2e4c, transparent: true, opacity: 0.9 })
    );
    this.cardPivot.add(borderLine);
  }

  triggerDeploy(impactWorldX = 0, impactWorldZ = 0) {
    this.root.position.set(impactWorldX, 0, impactWorldZ);
    this.root.visible = true;
    this._deployAnim = 0.01;
    this._lastCardDraw = -10;
  }

  hide() {
    this.root.visible = false;
    this._deployAnim = 0;
  }

  update(state, camera, elapsedSec, dt) {
    if (!state.isFallen) {
      if (this.root.visible) this.hide();
      return;
    }
    if (!this.root.visible) {
      this.triggerDeploy(0, 0);
    }

    // Smooth holographic scale-in animation
    this._deployAnim = Math.min(1, this._deployAnim + dt * 3.4);
    const ease = 1 - Math.pow(1 - this._deployAnim, 3);
    this.cardPivot.scale.setScalar(Math.max(0.01, ease));
    this.orbitGroup.scale.setScalar(Math.max(0.01, ease));

    // Rotate compass & GNSS satellite constellation
    this.compassMesh.rotation.y = elapsedSec * 0.18;
    this.orbitGroup.rotation.y = -elapsedSec * 0.65;

    // Pulse beacon pillar
    this.pillarMat.opacity = 0.14 + 0.14 * Math.sin(elapsedSec * 9.0);

    // Expand floor shockwave rings
    this.shockRings.forEach((sr) => {
      const p = (elapsedSec * 0.65 + sr.offset) % 1.0;
      const scale = 0.6 + p * 4.8;
      sr.mesh.scale.set(scale, 1, scale);
      sr.mat.opacity = (1 - p) * 0.72;
    });

    // Gently orient 3D GPS Card horizontally toward user's HMD / Camera
    if (camera) {
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      const cardWorld = new THREE.Vector3();
      this.cardPivot.getWorldPosition(cardWorld);
      const yaw = Math.atan2(camPos.x - cardWorld.x, camPos.z - cardWorld.z);
      this.cardPivot.rotation.y = yaw;
      this.cardPivot.position.y = 0.95 + 0.025 * Math.sin(elapsedSec * 2.6);
    }

    if (elapsedSec - this._lastCardDraw > 0.18) {
      this._lastCardDraw = elapsedSec;
      this._drawGpsCard(state, elapsedSec);
    }
  }

  _drawGpsCard(state, elapsedSec) {
    const ctx = this.cardCtx;
    const w = this.cardCanvas.width;
    const h = this.cardCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Frosted dark emergency background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, 'rgba(28, 7, 16, 0.94)');
    bgGrad.addColorStop(1, 'rgba(10, 15, 29, 0.95)');
    ctx.fillStyle = bgGrad;
    roundRect(ctx, 8, 8, w - 16, h - 16, 22);
    ctx.fill();

    // Glowing Crimson Border
    const blink = Math.sin(elapsedSec * 8) > 0;
    ctx.strokeStyle = blink ? '#ff2e4c' : '#f59e0b';
    ctx.lineWidth = 5;
    roundRect(ctx, 8, 8, w - 16, h - 16, 22);
    ctx.stroke();

    // Header Banner
    ctx.fillStyle = blink ? 'rgba(255, 46, 76, 0.30)' : 'rgba(245, 158, 11, 0.24)';
    roundRect(ctx, 24, 24, w - 48, 74, 14);
    ctx.fill();

    ctx.fillStyle = '#ff4d6d';
    ctx.font = 'bold 31px system-ui, -apple-system, sans-serif';
    ctx.fillText('⚠ ALERTA CRÍTICA DE CAÍDA · SOS 3D', 46, 71);

    const elapsedFall = Math.max(0, Math.floor(elapsedSec - state.fallTimestampSec));
    const mm = String(Math.floor(elapsedFall / 60)).padStart(2, '0');
    const ss = String(elapsedFall % 60).padStart(2, '0');
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`T+ ${mm}:${ss}`, w - 46, 70);
    ctx.textAlign = 'left';

    // GPS Coordinates Box
    ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 2;
    roundRect(ctx, 28, 116, w - 56, 198, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(
      `TELEMETRÍA GNSS ACTIVA · ${state.gpsSourceLabel} · HDOP 0.8 (±1.4 m)`,
      48,
      152
    );

    const latStr = `${Math.abs(state.gpsLat).toFixed(6)}° ${state.gpsLat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(state.gpsLon).toFixed(6)}° ${state.gpsLon >= 0 ? 'E' : 'W'}`;

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 38px monospace';
    ctx.fillText(`LAT: ${latStr}`, 48, 206);
    ctx.fillText(`LON: ${lonStr}`, 48, 256);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '21px monospace';
    ctx.fillText(
      `DMS: ${formatDMS(state.gpsLat, true)}  |  ${formatDMS(state.gpsLon, false)}  |  ALT: ${state.gpsAltM} m`,
      48,
      295
    );

    // Impact & Biometric Snapshot Row
    const metrics = [
      { label: 'IMPACTO IMU', val: `${state.peakImpactG.toFixed(2)} g`, color: '#fb7185' },
      { label: 'INCLINACIÓN', val: `${state.fallAngleDeg.toFixed(1)}°`, color: '#fbbf24' },
      { label: 'ÚLTIMA FC / FR', val: `${Math.round(state.lastLockedHr)} BPM · ${Math.round(state.lastLockedRr)} RPM`, color: '#34d399' }
    ];

    metrics.forEach((m, i) => {
      const bx = 28 + i * 304;
      ctx.fillStyle = 'rgba(30, 41, 59, 0.78)';
      roundRect(ctx, bx, 330, 292, 96, 12);
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(m.label, bx + 18, 360);

      ctx.fillStyle = m.color;
      ctx.font = 'bold 28px monospace';
      ctx.fillText(m.val, bx + 18, 404);
    });

    // Interactive 3D Reset Button Footer
    ctx.fillStyle = '#0ea5e9';
    roundRect(ctx, 28, 444, w - 56, 84, 14);
    ctx.fill();

    ctx.fillStyle = '#020617';
    ctx.font = 'bold 27px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('↻ TOCAR PANEL / GATILLO PARA RESTABLECER BASTÓN Y CANCELAR SOS', w / 2, 496);
    ctx.textAlign = 'left';

    this.cardTex.needsUpdate = true;
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
