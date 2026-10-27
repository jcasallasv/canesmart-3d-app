import { ROOM_BOUNDS } from '../world/RoomLocomotion.js';

/**
 * RoomMap — Plano cenital (2D) de la habitación con:
 *  - Posición y orientación del usuario que camina con el bastón.
 *  - Persona monitorizada por el radar de 60 GHz.
 *  - Cono de detección (presencia ±60° y bloqueo de signos vitales ±30°).
 *  - Rastro del recorrido y distancia medida.
 */

const FURNITURE = [
  { type: 'bed', x0: 1.68, x1: 2.55, z0: -1.88, z1: 0.16, label: 'Cama' },
  { type: 'desk', x0: -1.34, x1: -0.34, z0: -1.90, z1: -1.26, label: 'Mesa' },
  { type: 'chair', x0: -0.22, x1: 0.24, z0: -1.72, z1: -1.28, label: 'Silla' },
  { type: 'plant', x0: -2.42, x1: -2.02, z0: 1.52, z1: 1.92, label: '' }
];

const DOOR = { axis: 'z', side: 'max', from: -0.95, to: 0.05 };
const WINDOW = { axis: 'z', side: 'min', from: 0.25, to: 1.55 };

export class RoomMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.padding = 15;
    this._lastFrame = -1;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(240, Math.round(rect.width || 320));
    const cssH = Math.max(180, Math.round(rect.height || 250));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = cssW;
    this.cssH = cssH;

    const availW = cssW - this.padding * 2;
    const availH = cssH - this.padding * 2;
    this.scale = Math.min(
      availW / (ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX),
      availH / (ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ)
    );
    this.offX = (cssW - (ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX) * this.scale) / 2;
    this.offY = (cssH - (ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ) * this.scale) / 2;
  }

  toPx(x, z) {
    return {
      px: this.offX + (x - ROOM_BOUNDS.minX) * this.scale,
      py: this.offY + (z - ROOM_BOUNDS.minZ) * this.scale
    };
  }

  render({ locomotion, state, patient, elapsed, fpsHint = 0 }) {
    const ctx = this.ctx;
    const { cssW: w, cssH: h } = this;
    const locked = !!state.radarLocked;
    const presence = !!state.presenceDetected;

    ctx.clearRect(0, 0, w, h);

    // Fondo del plano
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, 'rgba(8, 20, 38, 0.92)');
    bg.addColorStop(1, 'rgba(5, 12, 24, 0.96)');
    ctx.fillStyle = bg;
    this.roundRect(ctx, 1, 1, w - 2, h - 2, 14);
    ctx.fill();

    const { px: x0, py: y0 } = this.toPx(ROOM_BOUNDS.minX, ROOM_BOUNDS.minZ);
    const { px: x1, py: y1 } = this.toPx(ROOM_BOUNDS.maxX, ROOM_BOUNDS.maxZ);
    const roomW = x1 - x0;
    const roomH = y1 - y0;

    // Suelo
    ctx.save();
    ctx.beginPath();
    this.roundRect(ctx, x0, y0, roomW, roomH, 10);
    ctx.clip();
    const floorGrad = ctx.createLinearGradient(x0, y0, x0, y1);
    floorGrad.addColorStop(0, 'rgba(14, 34, 60, 0.85)');
    floorGrad.addColorStop(1, 'rgba(9, 22, 40, 0.9)');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(x0, y0, roomW, roomH);

    // Rejilla métrica
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.11)';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(ROOM_BOUNDS.minX); gx <= ROOM_BOUNDS.maxX; gx++) {
      const { px } = this.toPx(gx, 0);
      ctx.beginPath();
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y1);
      ctx.stroke();
    }
    for (let gz = Math.ceil(ROOM_BOUNDS.minZ); gz <= ROOM_BOUNDS.maxZ; gz++) {
      const { py } = this.toPx(0, gz);
      ctx.beginPath();
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
      ctx.stroke();
    }

    // Mobiliario
    FURNITURE.forEach((f) => {
      const { px: fx0, py: fz0 } = this.toPx(f.x0, f.z0);
      const { px: fx1, py: fz1 } = this.toPx(f.x1, f.z1);
      ctx.fillStyle = f.type === 'plant' ? 'rgba(16, 185, 129, 0.16)' : 'rgba(51, 65, 85, 0.55)';
      ctx.strokeStyle = f.type === 'plant' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(100, 116, 139, 0.55)';
      ctx.lineWidth = 1.2;
      this.roundRect(ctx, fx0, fz0, fx1 - fx0, fz1 - fz0, f.type === 'bed' ? 6 : 4);
      ctx.fill();
      ctx.stroke();
      if (f.type === 'bed') {
        // Almohada
        const { py: pad } = this.toPx(0, f.z0);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        this.roundRect(ctx, fx0 + 4, pad + 4, fx1 - fx0 - 8, 12, 4);
        ctx.fill();
      }
      if (f.label) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.font = '600 8.5px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.label, (fx0 + fx1) / 2, (fz0 + fz1) / 2 + 3);
      }
    });

    // Rastro del recorrido
    if (locomotion.trail.length > 1) {
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      for (let i = 1; i < locomotion.trail.length; i++) {
        const a = locomotion.trail[i - 1];
        const b = locomotion.trail[i];
        const { px: ax, py: ay } = this.toPx(a.x, a.z);
        const { px: bx, py: by } = this.toPx(b.x, b.z);
        const alpha = 0.06 + 0.5 * (i / locomotion.trail.length);
        ctx.strokeStyle = `rgba(0, 229, 255, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // Conos de detección del radar (desde el bastón)
    const cane = locomotion.canePosition;
    const { px: cx, py: cy } = this.toPx(cane.x, cane.z);
    const dirAngle = Math.atan2(Math.cos(locomotion.aimYaw), Math.sin(locomotion.aimYaw));

    const drawCone = (halfAngleDeg, radiusM, fill, stroke) => {
      const radius = radiusM * this.scale;
      const half = (halfAngleDeg * Math.PI) / 180;
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
      grad.addColorStop(0, fill);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, dirAngle - half, dirAngle + half);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    drawCone(65, 3.5, presence ? 'rgba(56, 189, 248, 0.22)' : 'rgba(100, 116, 139, 0.16)',
      presence ? 'rgba(56, 189, 248, 0.55)' : 'rgba(100, 116, 139, 0.35)');
    if (locked) {
      drawCone(30, 2.95, 'rgba(52, 211, 153, 0.26)', 'rgba(52, 211, 153, 0.8)');
    }

    ctx.restore();

    // Muros
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.5)';
    ctx.lineWidth = 2.4;
    // Arriba / abajo con huecos de ventana y puerta
    const seg = (ax, ay, bx, by) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    const wp = (v) => this.toPx(v, ROOM_BOUNDS.minZ).px;
    const wpBottom = (v) => this.toPx(v, ROOM_BOUNDS.maxZ).px;
    const yTop = this.toPx(0, ROOM_BOUNDS.minZ).py;
    const yBot = this.toPx(0, ROOM_BOUNDS.maxZ).py;

    seg(x0, yTop, wp(WINDOW.from), yTop);
    seg(wp(WINDOW.to), yTop, x1, yTop);
    seg(x0, yBot, wpBottom(DOOR.from), yBot);
    seg(wpBottom(DOOR.to), yBot, x1, yBot);
    seg(x0, yTop, x0, yBot);
    seg(x1, yTop, x1, yBot);

    // Ventana y puerta
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
    ctx.lineWidth = 2;
    seg(wp(WINDOW.from), yTop, wp(WINDOW.to), yTop);
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
    seg(wpBottom(DOOR.from), yBot, wpBottom(DOOR.to), yBot);

    // Persona monitorizada
    const { px: ppx, py: ppy } = this.toPx(patient.x, patient.z);
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * (locked ? 3.2 : 1.4));
    const personColor = locked ? '52, 211, 153' : presence ? '56, 189, 248' : '148, 163, 184';
    ctx.beginPath();
    ctx.arc(ppx, ppy, 9 + pulse * 5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${personColor}, ${0.12 + pulse * 0.1})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ppx, ppy, 5.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${personColor})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(2, 8, 20, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Etiqueta de la persona (se voltea si está cerca del borde derecho) con fondo legible
    const flip = ppx > x1 - 108;
    const labelX = ppx + (flip ? -12 : 12);
    const align = flip ? 'right' : 'left';
    this._labelPill(ctx, 'PERSONA', labelX, ppy + 18, align, 'rgba(226, 244, 255, 0.95)', '700 8.5px system-ui, sans-serif');
    this._labelPill(ctx, locked ? `${Math.round(state.measuredHr)} lpm · ${Math.round(state.measuredRr)} rpm` : 'sin signos',
      labelX, ppy + 30, align, `rgba(${personColor}, 0.98)`, '600 8px system-ui, sans-serif');

    // Línea de distancia
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = locked ? 'rgba(52, 211, 153, 0.55)' : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ppx, ppy);
    ctx.stroke();
    ctx.setLineDash([]);
    // Etiqueta de distancia desplazada en perpendicular para no tapar los nombres
    let midX = (cx + ppx) / 2;
    let midY = (cy + ppy) / 2;
    const segLen = Math.hypot(ppx - cx, ppy - cy) || 1;
    midX += ((ppy - cy) / segLen) * 17;
    midY += (-(ppx - cx) / segLen) * 17;
    const distText = `${state.radarDistanceM.toFixed(2)} m`;
    ctx.font = '700 8.5px system-ui, sans-serif';
    const tw = ctx.measureText(distText).width;
    ctx.fillStyle = 'rgba(4, 10, 20, 0.85)';
    this.roundRect(ctx, midX - tw / 2 - 4, midY - 7, tw + 8, 13, 4);
    ctx.fill();
    ctx.fillStyle = locked ? '#6ee7b7' : '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText(distText, midX, midY + 2.5);

    // Usuario con el bastón (punta del bastón + cuerpo)
    const { px: ux, py: uy } = this.toPx(locomotion.position.x, locomotion.position.z);
    ctx.beginPath();
    ctx.arc(ux, uy, 6.4, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = 'rgba(4, 12, 26, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Flecha de orientación
    ctx.beginPath();
    const fx = Math.sin(locomotion.yaw);
    const fz = Math.cos(locomotion.yaw);
    ctx.moveTo(ux + fx * 15, uy + fz * 15);
    ctx.lineTo(ux + fx * 6 - fz * 5, uy + fz * 6 + fx * 5);
    ctx.lineTo(ux + fx * 6 + fz * 5, uy + fz * 6 - fx * 5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.fill();

    // Línea de apuntado del bastón
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ux, uy);
    ctx.lineTo(ux + Math.sin(locomotion.aimYaw) * 26, uy + Math.cos(locomotion.aimYaw) * 26);
    ctx.stroke();
    ctx.restore();

    // Punta del bastón
    ctx.beginPath();
    ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();

    this._labelPill(ctx, 'TÚ + BASTÓN', ux, uy - 12, 'center', 'rgba(226, 244, 255, 0.95)', '700 8.5px system-ui, sans-serif');

    // Regla de escala (1 m)
    const barPx = this.scale;
    const bx0 = x1 - barPx - 12;
    const by0 = y1 - 7;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx0, by0 - 4);
    ctx.lineTo(bx0, by0);
    ctx.lineTo(bx0 + barPx, by0);
    ctx.lineTo(bx0 + barPx, by0 - 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = '600 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('1 m', bx0 + barPx / 2, by0 - 6);
  }

  _labelPill(ctx, text, x, y, align, color, font) {
    ctx.font = font;
    ctx.textAlign = align;
    const tw = ctx.measureText(text).width;
    const padX = 4;
    const left = align === 'right' ? x - tw - padX : align === 'center' ? x - tw / 2 - padX : x - padX;
    ctx.fillStyle = 'rgba(4, 10, 20, 0.82)';
    this.roundRect(ctx, left, y - 8, tw + padX * 2, 12, 3.5);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 1);
  }

  roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
}
