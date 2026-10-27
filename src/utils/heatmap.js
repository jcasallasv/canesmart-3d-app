import * as THREE from 'three';

// Clinical biomechanical force thermal palette:
// 0.00 (Resting) -> Deep Slate-Blue
// 0.20 (Light touch) -> Cyan
// 0.45 (Nominal ergonomic load) -> Emerald Green
// 0.70 (Elevated load) -> Solar Yellow
// 0.86 (High load) -> Orange
// 1.00 (Peak / Overload) -> Crimson Red
const STOPS = [
  { t: 0.00, r: 30,  g: 52,  b: 94  },
  { t: 0.16, r: 6,   g: 182, b: 212 },
  { t: 0.42, r: 16,  g: 185, b: 129 },
  { t: 0.68, r: 250, g: 204, b: 21  },
  { t: 0.85, r: 249, g: 115, b: 22  },
  { t: 1.00, r: 239, g: 68,  b: 68  }
];

export function thermalRGB(value01) {
  const v = Math.max(0, Math.min(1, value01));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (v >= a.t && v <= b.t) {
      const u = (v - a.t) / (b.t - a.t || 1);
      const smooth = u * u * (3 - 2 * u);
      return {
        r: Math.round(a.r + (b.r - a.r) * smooth),
        g: Math.round(a.g + (b.g - a.g) * smooth),
        b: Math.round(a.b + (b.b - a.b) * smooth)
      };
    }
  }
  const last = STOPS[STOPS.length - 1];
  return { r: last.r, g: last.g, b: last.b };
}

export function thermalCSS(value01, alpha = 1) {
  const { r, g, b } = thermalRGB(value01);
  return alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`;
}

export function applyThermalToThreeColor(targetColor, value01, baseColorHex = 0xdbe4ef, blendMin = 0.12) {
  const v = Math.max(0, Math.min(1, value01));
  const { r, g, b } = thermalRGB(v);
  const heat = _tmpColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  const base = _tmpBase.setHex(baseColorHex, THREE.SRGBColorSpace);
  const mix = v <= 0.02 ? blendMin * (v / 0.02) : Math.min(1, blendMin + v * (1 - blendMin));
  targetColor.copy(base).lerp(heat, mix);
  return targetColor;
}

const _tmpColor = new THREE.Color();
const _tmpBase = new THREE.Color();

export function formatDMS(decimalDeg, isLat = true) {
  const hemi = isLat ? (decimalDeg >= 0 ? 'N' : 'S') : (decimalDeg >= 0 ? 'E' : 'W');
  const abs = Math.abs(decimalDeg);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = ((minFloat - min) * 60).toFixed(2);
  return `${deg}°${String(min).padStart(2, '0')}'${String(sec).padStart(5, '0')}" ${hemi}`;
}
