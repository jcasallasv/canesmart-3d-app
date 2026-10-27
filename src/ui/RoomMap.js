import { ROOM } from '../game/RoomSimulator.js';

/**
 * Mapa 2D en planta de la habitación (vista cenital) con:
 *  - muros, puerta y mobiliario
 *  - rastro del recorrido del usuario
 *  - jugador (flecha de orientación) y bastón
 *  - cono de cobertura del radar 60 GHz (presencia ±60° / signos vitales ±26°)
 *  - última posición conocida de la persona detectada
 *  - marcador SOS si el bastón ha caído
 */
export class RoomMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const cssW = canvas.clientWidth || 320;
    const cssH = canvas.clientHeight || 240;
    canvas.width = Math.round(cssW * this.dpr);
    canvas.height = Math.round(cssH * this.dpr);
    this.width = cssW;
    this.height = cssH;
    this._lastPaint = -1;
    this._pulse = 0;
  }

  resize() {
    const cssW = this.canvas.clientWidth || 320;
    const cssH = this.canvas.clientHeight || 240;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.width = cssW;
    this.height = cssH;
  }

  render(data, elapsedSec) {
    if (!this.ctx) return;
    // Repintado a ~30 fps
    if (elapsedSec - this._lastPaint < 0.033) return;
    this._lastPaint = elapsedSec;

    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const pad = 12;
    const availW = this.width - pad * 2;
    const availH = this.height - pad * 2;
    const scale = Math.min(availW / ROOM.width, availH / ROOM.depth);
    const offX = pad + (availW - ROOM.width * scale) / 2;
    const offZ = pad + (availH - ROOM.depth * scale) / 2;

    const mx = (x) => offX + (x + ROOM.width / 2) * scale;
    const mz = (z) => offZ + (z + ROOM.depth / 2) * scale;

    // Fondo
    ctx.fillStyle = '#050c18';
    roundRect(ctx, 0.5, 0.5, this.width - 1, this.height - 1, 10);
    ctx.fill();

    // Suelo de la habitación
    ctx.fillStyle = '#08172b';
    ctx.fillRect(mx(-ROOM.width / 2), mz(-ROOM.depth / 2), ROOM.width * scale, ROOM.depth * scale);

    // Rejilla 0.5 m
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -ROOM.width / 2; x <= ROOM.width / 2 + 1e-6; x += 0.5) {
      ctx.moveTo(mx(x), mz(-ROOM.depth / 2));
      ctx.lineTo(mx(x), mz(ROOM.depth / 2));
    }
    for (let z = -ROOM.depth / 2; z <= ROOM.depth / 2 + 1e-6; z += 0.5) {
      ctx.moveTo(mx(-ROOM.width / 2), mz(z));
      ctx.lineTo(mx(ROOM.width / 2), mz(z));
    }
    ctx.stroke();

    // Cono del radar 60 GHz
    const cane = data.cane;
    const heading = data.player.heading;
    // En pantalla: dir = (cos h, -sin h)
    const dirAngle = Math.atan2(-Math.sin(heading), Math.cos(heading));

    const drawWedge = (halfAngleDeg, radiusM, color, alpha) => {
      const r = Math.min(radiusM, ROOM.width + ROOM.depth) * scale;
      const a0 = dirAngle - (halfAngleDeg * Math.PI) / 180;
      const a1 = dirAngle + (halfAngleDeg * Math.PI) / 180;
      const g = ctx.createRadialGradient(mx(cane.x), mz(cane.z), 2, mx(cane.x), mz(cane.z), r);
      g.addColorStop(0, `rgba(${color}, ${alpha})`);
      g.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(mx(cane.x), mz(cane.z));
      ctx.arc(mx(cane.x), mz(cane.z), r, a0, a1);
      ctx.closePath();
      ctx.fill();
    };

    if (!data.isFallen) {
      drawWedge(55, 2.75, '34, 211, 238', data.presenceDetected ? 0.18 : 0.1);
      drawWedge(30, 2.40, '52, 211, 153', data.vitalsLocked ? 0.24 : 0.08);
    }

    // Rastro
    if (data.trail && data.trail.length > 1) {
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.34)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.trail.forEach((p, i) => {
        if (i === 0) ctx.moveTo(mx(p.x), mz(p.z));
        else ctx.lineTo(mx(p.x), mz(p.z));
      });
      ctx.stroke();
    }

    // Mobiliario
    ctx.font = '9px ui-monospace, monospace';
    ROOM.furniture.forEach((f) => {
      const x = mx(f.x - f.w / 2);
      const y = mz(f.z - f.d / 2);
      const w = f.w * scale;
      const h = f.d * scale;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(148, 197, 235, 0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (w > 26) ctx.fillText(f.label, x + w / 2, y + h / 2);
    });

    // Muros
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const L = mx(-ROOM.width / 2);
    const R = mx(ROOM.width / 2);
    const T = mz(-ROOM.depth / 2);
    const B = mz(ROOM.depth / 2);
    ctx.beginPath();
    ctx.moveTo(L, T);
    ctx.lineTo(R, T);
    ctx.moveTo(L, T);
    ctx.lineTo(L, B);
    ctx.moveTo(R, T);
    ctx.lineTo(R, B);
    ctx.stroke();

    // Muro sur con hueco de puerta
    const doorL = mx(ROOM.door.centerX - ROOM.door.halfWidth);
    const doorR = mx(ROOM.door.centerX + ROOM.door.halfWidth);
    ctx.beginPath();
    ctx.moveTo(L, B);
    ctx.lineTo(doorL, B);
    ctx.moveTo(doorR, B);
    ctx.lineTo(R, B);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(doorL, B);
    ctx.lineTo(doorR, B);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(103, 232, 249, 0.7)';
    ctx.font = '8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PUERTA', (doorL + doorR) / 2, B - 6);

    // Persona detectada / última posición conocida
    const patient = data.patient;
    if (data.presenceDetected) {
      this._pulse = (this._pulse + 0.05) % (Math.PI * 2);
      const pr = 8 + Math.sin(this._pulse) * 2.2;
      const px = mx(patient.x);
      const pz = mz(patient.z);

      ctx.beginPath();
      ctx.arc(px, pz, pr + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, pz, pr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(244, 114, 182, 0.9)';
      ctx.fill();

      ctx.fillStyle = '#fbcfe8';
      ctx.font = 'bold 8.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(data.vitalsLocked ? 'FC + FR' : 'PRESENCIA', px, pz - pr - 8);
    } else if (data.patientDetectedOnce && data.patientLastKnown) {
      const known = data.patientLastKnown;
      ctx.beginPath();
      ctx.arc(mx(known.x), mz(known.z), 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.4)';
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(251, 207, 232, 0.55)';
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', mx(known.x), mz(known.z) + 3);
    }

    // Bastón
    if (!data.isFallen) {
      const cx = mx(cane.x);
      const cz = mz(cane.z);
      ctx.save();
      ctx.translate(cx, cz);
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(4.5, 0);
      ctx.lineTo(0, 4.5);
      ctx.lineTo(-4.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Jugador
    const px = mx(data.player.x);
    const pz = mz(data.player.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(dirAngle);

    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, -6);
    ctx.closePath();
    ctx.fillStyle = '#22d3ee';
    ctx.fill();
    ctx.strokeStyle = '#04121f';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#a5f3fc';
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TÚ', px, pz - 13);

    // Marcador SOS
    if (data.isFallen) {
      const fx = mx(cane.x);
      const fz = mz(cane.z);
      ctx.strokeStyle = '#ff2e4c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx, fz, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fx - 5, fz - 5);
      ctx.lineTo(fx + 5, fz + 5);
      ctx.moveTo(fx + 5, fz - 5);
      ctx.lineTo(fx - 5, fz + 5);
      ctx.stroke();
      ctx.fillStyle = '#fda4af';
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.fillText('SOS', fx, fz - 17);
    }

    // Brújula y escala
    ctx.fillStyle = 'rgba(148, 197, 235, 0.85)';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', this.width - 16, 18);
    ctx.beginPath();
    ctx.moveTo(this.width - 16, 22);
    ctx.lineTo(this.width - 16, 32);
    ctx.strokeStyle = 'rgba(148, 197, 235, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const barPx = scale * 1; // 1 metro
    ctx.strokeStyle = 'rgba(148, 197, 235, 0.75)';
    ctx.beginPath();
    ctx.moveTo(14, this.height - 12);
    ctx.lineTo(14 + barPx, this.height - 12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148, 197, 235, 0.8)';
    ctx.font = '8px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('1 m', 14, this.height - 16);
  }
}

/** Sparkline en vivo para las tarjetas de FC / FR */
export function drawSparkline(canvas, buffer, color, min = 0, max = 1) {
  if (!canvas || !buffer || buffer.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  ctx.beginPath();
  const span = Math.max(1e-6, max - min);
  for (let i = 0; i < buffer.length; i++) {
    const x = (i / (buffer.length - 1)) * w;
    const norm = Math.max(0, Math.min(1, (buffer[i] - min) / span));
    const y = h - 2 - norm * (h - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
