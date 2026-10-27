/**
 * Generadores de forma de onda biomédica (independientes de la tasa de fotogramas).
 * Se evalúan analíticamente sobre el tiempo simulado, así que la traza se ve
 * correcta incluso si el dispositivo renderiza a pocos FPS.
 */

/** Complejo QRS + ondas P y T a partir de la fase cardiaca normalizada (0..1). */
export function cardiacShape(c) {
  const rPeak = Math.exp(-Math.pow((c - 0.16) / 0.052, 2));
  const qNotch = -0.11 * Math.exp(-Math.pow((c - 0.115) / 0.022, 2));
  const sNotch = -0.16 * Math.exp(-Math.pow((c - 0.215) / 0.03, 2));
  const tWave = 0.27 * Math.exp(-Math.pow((c - 0.47) / 0.13, 2));
  const pWave = 0.11 * Math.exp(-Math.pow((c - 0.93) / 0.055, 2));
  return Math.max(0, 0.1 + 0.82 * rPeak + qNotch + sNotch + tWave + pWave);
}

/** Curva respiratoria: inspiración algo más rápida que la espiración. */
export function respirationShape(phaseRad) {
  return 0.5 + 0.4 * Math.sin(phaseRad) + 0.07 * Math.sin(phaseRad * 2);
}

/**
 * Serie de la onda cardiaca para los últimos `spanSec` segundos de tiempo simulado.
 * @param {number} phaseNow fase cardiaca actual en radianes
 * @param {number} hrBpm latidos por minuto
 * @param {number} spanSec ventana visible
 * @param {number} count número de puntos
 */
export function cardiacSeries(phaseNow, hrBpm, spanSec = 7, count = 220) {
  const omega = (hrBpm / 60) * Math.PI * 2;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const tBack = spanSec * (1 - i / (count - 1));
    let c = (phaseNow - omega * tBack) / (Math.PI * 2);
    c -= Math.floor(c);
    out[i] = cardiacShape(c);
  }
  return out;
}

export function respirationSeries(phaseNow, rrRpm, spanSec = 18, count = 220) {
  const omega = (rrRpm / 60) * Math.PI * 2;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const tBack = spanSec * (1 - i / (count - 1));
    out[i] = respirationShape(phaseNow - omega * tBack);
  }
  return out;
}

export function flatSeries(value = 0.3, count = 220, noise = 0.012) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = value + (Math.random() - 0.5) * noise;
  return out;
}
