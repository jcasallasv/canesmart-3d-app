/**
 * MiniWave — Traza biomédica compacta en tiempo real.
 * Puede dibujar una serie analítica (setSeries) o un buffer circular (push).
 */
export class MiniWave {
  constructor(canvas, { samples = 150, buffer = 600, color = '#fb7185', baseline = true, min = -1, max = 1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.samples = samples;
    this.bufferSize = buffer;
    this.data = new Array(samples).fill(0);
    this.series = null;
    this.color = color;
    this.baseline = baseline;
    this.min = min;
    this.max = max;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(120, Math.round(rect.width || 220));
    const cssH = Math.max(28, Math.round(rect.height || 44));
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = cssW;
    this.h = cssH;
  }

  setSeries(arr) {
    this.series = arr;
  }

  clearSeries() {
    this.series = null;
  }

  push(value) {
    this.data.push(value);
    if (this.data.length > this.bufferSize) this.data.shift();
  }

  draw() {
    if (this.series && this.series.length > 2) {
      this._drawSeries(this.series);
    } else {
      this._drawBuffer();
    }
  }

  _prep() {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (this.baseline) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }
    const span = this.max - this.min || 1;
    const toY = (v) => h - 3 - Math.max(0, Math.min(1, (v - this.min) / span)) * (h - 6);
    return { ctx, w, h, toY };
  }

  _drawSeries(series) {
    const { ctx, w, h, toY } = this._prep();
    const n = series.length;
    const stepX = w / (n - 1);

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < n; i++) ctx.lineTo(i * stepX, toY(series[i]));
    ctx.lineTo(w, h);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, `${this.color}30`);
    fill.addColorStop(1, `${this.color}00`);
    ctx.fillStyle = fill;
    ctx.fill();

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `${this.color}22`);
    grad.addColorStop(0.5, this.color);
    grad.addColorStop(1, this.color);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * stepX;
      const y = toY(series[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.9;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(w - 1.5, toY(series[n - 1]), 2.6, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
  }

  _drawBuffer() {
    const { ctx, w, h, toY } = this._prep();
    const rawN = this.data.length;
    const stride = Math.max(1, Math.floor(rawN / this.samples));
    const view = [];
    for (let i = 0; i < rawN; i += stride) view.push(this.data[i]);
    if (view[view.length - 1] !== this.data[rawN - 1]) view.push(this.data[rawN - 1]);

    const n = view.length;
    const stepX = w / Math.max(1, n - 1);

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < n; i++) ctx.lineTo(i * stepX, toY(view[i]));
    ctx.lineTo(w, h);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, `${this.color}33`);
    fill.addColorStop(1, `${this.color}00`);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * stepX;
      const y = toY(view[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.9;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
