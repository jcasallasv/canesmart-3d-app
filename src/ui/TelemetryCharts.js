import { thermalCSS } from '../utils/heatmap.js';

export class TelemetryCharts {
  constructor({ anatomyCanvas, scopeForceCanvas, scopeRadarCanvas, scopeImuCanvas }) {
    this.anatomyCanvas = anatomyCanvas;
    this.anatomyCtx = anatomyCanvas.getContext('2d');

    this.scopeForceCanvas = scopeForceCanvas;
    this.scopeForceCtx = scopeForceCanvas.getContext('2d');

    this.scopeRadarCanvas = scopeRadarCanvas;
    this.scopeRadarCtx = scopeRadarCanvas.getContext('2d');

    this.scopeImuCanvas = scopeImuCanvas;
    this.scopeImuCtx = scopeImuCanvas.getContext('2d');
  }

  render(state) {
    this._drawAnatomyHeatmap(state);
    this._drawDualForceScope(state);
    this._drawRadarDopplerScope(state);
    this._drawImuScope(state);
  }

  _drawAnatomyHeatmap(state) {
    const ctx = this.anatomyCtx;
    const w = this.anatomyCanvas.width;
    const h = this.anatomyCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Left half: CaneSmart Handle Silhouette + 6 FSR Thermal Blobs
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 2.5;

    // Draw stylized crook + T-handle silhouette matching CaneSmart Meta.jpg
    ctx.beginPath();
    ctx.moveTo(46, 98);
    ctx.bezierCurveTo(18, 92, 16, 42, 58, 36);
    ctx.lineTo(168, 34);
    ctx.quadraticCurveTo(180, 34, 180, 46);
    ctx.quadraticCurveTo(180, 58, 168, 58);
    ctx.lineTo(122, 58);
    ctx.lineTo(122, 112);
    ctx.lineTo(102, 112);
    ctx.lineTo(102, 58);
    ctx.lineTo(62, 58);
    ctx.bezierCurveTo(38, 60, 38, 84, 54, 88);
    ctx.closePath();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.stroke();

    // 6 FSR node positions on silhouette: [FSR-1..FSR-6]
    const fsrNodes = [
      { x: 47, y: 90, label: '1' },
      { x: 30, y: 72, label: '2' },
      { x: 36, y: 50, label: '3' },
      { x: 66, y: 46, label: '4' },
      { x: 112, y: 47, label: '5' },
      { x: 154, y: 46, label: '6' }
    ];

    fsrNodes.forEach((node, i) => {
      const fN = state.fsrForcesN[i] || 0;
      const norm = Math.min(1, fN / 38);
      const radius = 12 + norm * 10;

      const grad = ctx.createRadialGradient(node.x, node.y, 2, node.x, node.y, radius);
      grad.addColorStop(0, thermalCSS(norm, 0.95));
      grad.addColorStop(0.6, thermalCSS(norm, 0.45));
      grad.addColorStop(1, thermalCSS(norm, 0));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`F${node.label}`, node.x, node.y);
    });

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Matriz 6×FSR Empuñadura', 100, 127);

    // Divider
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(202, 12);
    ctx.lineTo(202, h - 12);
    ctx.stroke();

    // Right half: 4-Pod Base Center-of-Pressure (CoP) Map
    const cx = 278;
    const cy = 64;
    const maxR = 44;

    ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)';
    ctx.beginPath();
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    // 4 feet: [0] Right (+X), [1] Front (+Z -> down), [2] Left (-X), [3] Back (-Z -> up)
    const pods = [
      { x: cx + 33, y: cy, lbl: 'D' },
      { x: cx, y: cy + 33, lbl: 'F' },
      { x: cx - 33, y: cy, lbl: 'I' },
      { x: cx, y: cy - 33, lbl: 'T' }
    ];

    pods.forEach((p, idx) => {
      const fn = state.footForcesN[idx] || 0;
      const norm = Math.min(1, fn / 130);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9 + norm * 4, 0, Math.PI * 2);
      ctx.fillStyle = thermalCSS(norm, 0.9);
      ctx.fill();
      ctx.fillStyle = '#020617';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(p.lbl, p.x, p.y + 0.5);
    });

    // Live CoP Crosshair
    const copXpx = cx + (state.copX / 0.122) * 33;
    const copYpx = cy + (state.copZ / 0.122) * 33;
    ctx.beginPath();
    ctx.arc(copXpx, copYpx, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('CoP Base 4 Apoyos', cx, 127);
    ctx.restore();
  }

  _drawGrid(ctx, w, h) {
    ctx.fillStyle = 'rgba(5, 11, 22, 0.9)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.75)';
    ctx.lineWidth = 1;
    for (let y = h * 0.25; y < h; y += h * 0.25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = w * 0.2; x < w; x += w * 0.2) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  _drawDualForceScope(state) {
    const ctx = this.scopeForceCtx;
    const w = this.scopeForceCanvas.width;
    const h = this.scopeForceCanvas.height;
    this._drawGrid(ctx, w, h);

    // Plot Axial Load Cell (0..450 N) in Emerald
    this._plotSeries(ctx, state.axialHistory, 0, 450, w, h, '#10b981', 2.2);
    // Plot Total Grip FSR (0..450 N scale for direct comparison, or 0..220 N) in Amber
    this._plotSeries(ctx, state.gripHistory, 0, 220, w, h, '#f59e0b', 1.8);
  }

  _drawRadarDopplerScope(state) {
    const ctx = this.scopeRadarCtx;
    const w = this.scopeRadarCanvas.width;
    const h = this.scopeRadarCanvas.height;
    this._drawGrid(ctx, w, h);

    const color = state.radarLocked ? '#00e5ff' : '#64748b';
    this._plotSeries(ctx, state.dopplerWaveHistory, -1.25, 1.25, w, h, color, 2.2);
  }

  _drawImuScope(state) {
    const ctx = this.scopeImuCtx;
    const w = this.scopeImuCanvas.width;
    const h = this.scopeImuCanvas.height;
    this._drawGrid(ctx, w, h);

    // Critical 3.0g threshold dashed line
    const yThresh = h - ((3.0 - 0) / 5.5) * (h - 10) - 5;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
    ctx.beginPath();
    ctx.moveTo(0, yThresh);
    ctx.lineTo(w, yThresh);
    ctx.stroke();
    ctx.restore();

    const color = state.isFallen ? '#ff2e4c' : '#a78bfa';
    this._plotSeries(ctx, state.imuHistory, 0, 5.5, w, h, color, 2.0);
  }

  _plotSeries(ctx, arr, minV, maxV, w, h, strokeColor, lineWidth) {
    if (!arr || arr.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    const span = maxV - minV || 1;
    for (let i = 0; i < arr.length; i++) {
      const x = (i / (arr.length - 1)) * w;
      const norm = Math.max(0, Math.min(1, (arr[i] - minV) / span));
      const y = h - 5 - norm * (h - 10);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
