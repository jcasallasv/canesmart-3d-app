import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { CaneSmartModel } from './models/CaneSmartModel.js';
import { VirtualPatientAndRadar } from './models/VirtualPatientAndRadar.js';
import { FallGpsHologram } from './models/FallGpsHologram.js';
import { SpatialDiegeticHUD } from './xr/SpatialDiegeticHUD.js';
import { MetaQuestXRManager } from './xr/MetaQuestXRManager.js';
import { BiomechanicalEngine, PATIENT_PROFILES } from './physics/BiomechanicalEngine.js';
import { SpatialBioAudio } from './audio/SpatialBioAudio.js';
import { TelemetryCharts } from './ui/TelemetryCharts.js';
import { RoomLocomotion, ROOM_BOUNDS } from './world/RoomLocomotion.js';
import { RoomMap } from './ui/RoomMap.js';
import { MiniWave } from './ui/MiniWave.js';
import { formatDMS, thermalCSS } from './utils/heatmap.js';
import { cardiacSeries, respirationSeries, flatSeries } from './utils/waveforms.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;

/* ============================================================
   1. Renderer, escena, cámara e iluminación
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
$('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050b16);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.05, 60);
camera.position.set(-2.30, 1.95, 2.05);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.2;
controls.maxDistance = 7.5;
controls.maxPolarAngle = Math.PI * 0.492;
controls.target.set(0.45, 0.82, 0.35);

scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0b1626, 1.0));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.75);
keyLight.position.set(-2.2, 3.4, 2.8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.3;
keyLight.shadow.camera.far = 12;
keyLight.shadow.bias = -0.0006;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.7);
rimLight.position.set(3.0, 1.8, -2.6);
scene.add(rimLight);

/* ============================================================
   2. Habitación simulada (plano 5.2 × 4.2 m) + mobiliario
   ============================================================ */
const stageGroup = new THREE.Group();
scene.add(stageGroup);

function makeFloorTexture() {
  const pxPerM = 88;
  const w = Math.round((ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX) * pxPerM);
  const h = Math.round((ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ) * pxPerM);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#0b1b30');
  g.addColorStop(1, '#071322');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Rejilla de 1 m
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.13)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= w; x += pxPerM) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += pxPerM) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Borde perimetral
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
  ctx.lineWidth = 5;
  ctx.strokeRect(2.5, 2.5, w - 5, h - 5);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const roomW = ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX;
const roomD = ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ;

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(roomW, roomD),
  new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.82, metalness: 0.18 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
stageGroup.add(floor);

// Suelo ampliado (fuera de la habitación) para dar contexto
const outerFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(roomW + 6, roomD + 6),
  new THREE.MeshStandardMaterial({ color: 0x03070f, roughness: 0.95, metalness: 0.05 })
);
outerFloor.rotation.x = -Math.PI / 2;
outerFloor.position.y = -0.012;
stageGroup.add(outerFloor);

const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(roomW, roomD),
  new THREE.ShadowMaterial({ opacity: 0.34 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.002;
shadowCatcher.receiveShadow = true;
stageGroup.add(shadowCatcher);

// Mobiliario simple (coherente con el mapa 2D)
const furnitureMat = new THREE.MeshStandardMaterial({ color: 0x1c2f47, roughness: 0.75, metalness: 0.22 });
const softMat = new THREE.MeshStandardMaterial({ color: 0x2a4258, roughness: 0.9, metalness: 0.1 });

function addBox(cx, cz, sx, sz, h, mat, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), mat);
  m.position.set(cx, y + h / 2, cz);
  m.castShadow = true;
  m.receiveShadow = true;
  stageGroup.add(m);
  return m;
}

// Cama (con cabecero y almohada)
addBox(2.115, -0.86, 0.87, 2.04, 0.42, furnitureMat);
addBox(2.115, -1.84, 0.87, 0.10, 0.86, furnitureMat, 0);
const pillow = addBox(2.115, -1.60, 0.62, 0.28, 0.12, softMat, 0.42);
pillow.castShadow = false;
// Mesa + silla
addBox(-0.84, -1.58, 1.0, 0.64, 0.74, furnitureMat);
addBox(0.01, -1.50, 0.46, 0.44, 0.45, softMat);
// Planta
const pot = new THREE.Mesh(
  new THREE.CylinderGeometry(0.15, 0.12, 0.34, 20),
  new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.85 })
);
pot.position.set(-2.22, 0.17, 1.72);
pot.castShadow = true;
stageGroup.add(pot);

// Esquinas de la habitación
const cornerGeo = new THREE.SphereGeometry(0.02, 8, 8);
const cornerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
[
  [ROOM_BOUNDS.minX, ROOM_BOUNDS.minZ],
  [ROOM_BOUNDS.minX, ROOM_BOUNDS.maxZ],
  [ROOM_BOUNDS.maxX, ROOM_BOUNDS.minZ],
  [ROOM_BOUNDS.maxX, ROOM_BOUNDS.maxZ]
].forEach(([x, z]) => {
  const m = new THREE.Mesh(cornerGeo, cornerMat);
  m.position.set(x, 0.01, z);
  stageGroup.add(m);
});

/* ============================================================
   3. Modelos, física, audio y locomoción
   ============================================================ */
const audio = new SpatialBioAudio();

const caneModel = new CaneSmartModel();
stageGroup.add(caneModel.root);

const patientAndRadar = new VirtualPatientAndRadar();
patientAndRadar.patientGroup.position.set(1.35, 0, 1.05);
patientAndRadar.patientGroup.rotation.y = -Math.PI / 2;
stageGroup.add(patientAndRadar.root);

const fallGps = new FallGpsHologram();
stageGroup.add(fallGps.root);

const spatialHud = new SpatialDiegeticHUD();
spatialHud.calloutsVisible = false;
stageGroup.add(spatialHud.root);

const locomotion = new RoomLocomotion({
  onStep: () => {
    audio.playImpactThud(0.22);
  }
});
locomotion.bindKeyboard();

let elapsedGlobal = 0;

const engine = new BiomechanicalEngine({
  onImpact: (intensity) => audio.playImpactThud(intensity),
  onFallDetected: (s) => {
    const caneWorld = new THREE.Vector3();
    caneModel.root.getWorldPosition(caneWorld);
    audio.startFallAlarm(`Latitud ${Math.abs(s.gpsLat).toFixed(2)} norte, longitud ${Math.abs(s.gpsLon).toFixed(2)} oeste.`);
    fallGps.triggerDeploy(caneWorld.x, caneWorld.z);
    showSosBanner(true, s);
  },
  onFallReset: () => {
    audio.stopFallAlarm(true);
    fallGps.hide();
    showSosBanner(false);
  },
  onSystolicBeat: () => audio.playVitalPulse(engine.state.measuredHr)
});

function getInteractiveTargets() {
  const list = [...caneModel.interactiveMeshes, ...patientAndRadar.interactiveMeshes];
  if (spatialHud.calloutsVisible || engine.state.showSpatialDock) list.push(...spatialHud.interactiveMeshes);
  if (fallGps.root.visible) list.push(...fallGps.interactiveMeshes);
  return list;
}

/* ============================================================
   4. WebXR (Meta Quest Passthrough)
   ============================================================ */
let webcamOn = false;

function setBackdropTransparent(on) {
  if (on) {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    outerFloor.visible = false;
    floor.material.opacity = 0.55;
    floor.material.transparent = true;
  } else {
    scene.background = new THREE.Color(0x050b16);
    renderer.setClearColor(0x050b16, 1);
    outerFloor.visible = true;
    floor.material.opacity = 1;
    floor.material.transparent = false;
  }
}

const xrManager = new MetaQuestXRManager({
  renderer,
  scene,
  stageGroup,
  caneModel,
  engine,
  interactiveTargetsGetter: getInteractiveTargets,
  onActionTriggered: handleAction,
  onSessionStateChange: (active, mode) => {
    setBackdropTransparent(active && mode === 'immersive-ar');
    setBtnLabel('btn-enter-xr', active ? 'Salir' : 'Realidad mixta');
  }
});

xrManager.checkSupport().then((res) => {
  if (res.ar || res.vr) $('btn-enter-xr').classList.add('is-on');
});

/* ============================================================
   5. UI: mapa, ondas, gráficas y estado
   ============================================================ */
const roomMap = new RoomMap($('room-map'));
const charts = new TelemetryCharts({
  anatomyCanvas: $('canvas-anatomy'),
  scopeForceCanvas: $('scope-force'),
  scopeRadarCanvas: $('scope-radar'),
  scopeImuCanvas: $('scope-imu')
});
const waveHr = new MiniWave($('spark-hr'), { color: '#fb7185', min: 0, max: 1 });
const waveRr = new MiniWave($('spark-rr'), { color: '#2dd4bf', min: 0, max: 1 });

const el = {
  mode: $('lbl-mode'),
  statusPill: $('system-status-pill'),
  presenceCard: $('card-presence'),
  presencePill: $('presence-pill'),
  presenceMsg: $('presence-msg'),
  presenceDist: $('lbl-presence-dist'),
  presenceAngle: $('lbl-presence-angle'),
  presenceSnr: $('lbl-presence-snr'),
  sigBars: [1, 2, 3, 4, 5].map((i) => $(`sigb-${i}`)),
  cardHr: $('card-hr'),
  cardRr: $('card-rr'),
  hr: $('val-hr'),
  rr: $('val-rr'),
  subHr: $('sub-hr'),
  subRr: $('sub-rr'),
  heart: $('hr-heart'),
  lung: $('rr-lung'),
  fsr: $('val-fsr'),
  axial: $('val-axial'),
  forceFill: $('force-fill'),
  forceState: $('force-state'),
  zBars: [0, 1, 2, 3, 4, 5].map((i) => $(`zbar-${i}`)),
  zVals: [0, 1, 2, 3, 4, 5].map((i) => $(`zval-${i}`)),
  distance: $('lbl-distance'),
  steps: $('lbl-steps'),
  gap: $('lbl-gap'),
  speed: $('chip-speed'),
  sos: $('sos-banner'),
  sosCoords: $('sos-coords'),
  gps: $('gps-box')
};

let toastTimer = 0;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

function showSosBanner(show, state) {
  el.sos.hidden = !show;
  if (show && state) {
    el.sosCoords.textContent = `LAT ${formatDMS(state.gpsLat, true)} · LON ${formatDMS(state.gpsLon, false)} · impacto ${state.peakImpactG.toFixed(2)} g`;
  }
  el.statusPill.classList.toggle('pill-bad', show);
  el.statusPill.classList.toggle('pill-live', !show);
}

/* ---------------- Actualización de tarjetas (≈14 Hz) ---------------- */
let uiAccum = 0;
function updateCards(dt) {
  uiAccum += dt;
  if (uiAccum < 0.07) return;
  uiAccum = 0;

  const s = engine.state;
  const locked = s.radarLocked;
  const presence = s.presenceDetected;

  // --- Presencia humana ---
  el.presenceCard.classList.toggle('locked', locked);
  el.presenceCard.classList.toggle('detected', presence && !locked);

  if (locked) {
    el.presencePill.className = 'pill pill-ok';
    el.presencePill.innerHTML = '<span class="dot"></span> DETECTADA';
    el.presenceMsg.textContent = 'Presencia confirmada. Midiendo ritmo cardíaco y respiración.';
  } else if (presence) {
    el.presencePill.className = 'pill pill-warn';
    el.presencePill.innerHTML = '<span class="dot"></span> PRESENCIA DÉBIL';
    el.presenceMsg.textContent = 'Hay alguien en el cono. Gira el bastón hacia su pecho para medir los signos vitales.';
  } else {
    el.presencePill.className = 'pill pill-warn';
    el.presencePill.innerHTML = '<span class="dot"></span> SIN PRESENCIA';
    el.presenceMsg.textContent = s.radarEnabled
      ? 'Nadie dentro del alcance del radar. Camina hacia la persona.'
      : 'Radar desactivado (actívalo en Telemetría avanzada).';
  }

  el.presenceDist.textContent = presence ? `${s.radarDistanceM.toFixed(2)} m` : '—';
  el.presenceAngle.textContent = presence ? `${s.radarOffAxisDeg.toFixed(0)}°` : '—';
  el.presenceSnr.textContent = locked ? `${s.radarSnrDb.toFixed(1)} dB` : '— dB';

  const level = locked ? clamp(Math.round((s.radarSnrDb / 32) * 5), 1, 5) : presence ? 1 : 0;
  el.sigBars.forEach((b, i) => b.classList.toggle('on', i < level));

  // --- Ritmo cardíaco ---
  el.cardHr.classList.toggle('is-live', locked);
  el.heart.classList.toggle('beating', locked);
  el.hr.textContent = locked ? String(Math.round(s.measuredHr)) : '--';
  el.subHr.textContent = locked
    ? `Onda Doppler del tórax · ${s.radarSnrDb > 18 ? 'señal estable' : 'señal débil, acércate'}`
    : presence
      ? 'Presencia detectada · apunta al pecho'
      : 'Sin señal de radar';

  // --- Frecuencia respiratoria ---
  el.cardRr.classList.toggle('is-live', locked);
  el.lung.classList.toggle('breathing', locked);
  el.rr.textContent = locked ? String(Math.round(s.measuredRr)) : '--';
  el.subRr.textContent = locked
    ? `Movimiento del tórax · ±${(0.9 + s.radarSnrDb / 30).toFixed(1)} mm`
    : presence
      ? 'Presencia detectada · apunta al pecho'
      : 'Sin señal de radar';

  // --- Presión en el bastón (FSR) ---
  const grip = s.totalGripN;
  el.fsr.textContent = grip.toFixed(1);
  el.fsr.style.color = thermalCSS(clamp(grip / 120, 0, 1));
  el.forceFill.style.width = `${clamp((grip / 140) * 100, 0, 100)}%`;
  el.axial.textContent = `${s.axialForceN.toFixed(0)} N`;
  el.forceState.textContent = grip < 12 ? 'REPOSO' : grip < 55 ? 'APOYO' : grip < 95 ? 'CARGA' : 'ALTA';

  for (let i = 0; i < 6; i++) {
    const val = s.fsrForcesN[i] || 0;
    const norm = clamp(val / 45, 0, 1);
    const color = thermalCSS(norm);
    el.zBars[i].style.backgroundImage = `linear-gradient(to top, ${color}, ${color})`;
    el.zBars[i].style.backgroundRepeat = 'no-repeat';
    el.zBars[i].style.backgroundPosition = 'bottom';
    el.zBars[i].style.backgroundSize = `100% ${Math.max(3, norm * 100).toFixed(0)}%`;
    el.zBars[i].style.boxShadow = norm > 0.25 ? `0 0 8px ${color}88` : 'none';
    el.zVals[i].textContent = val.toFixed(0);
  }

  // --- Estadísticas de desplazamiento ---
  el.distance.textContent = `${locomotion.distanceWalked.toFixed(1)} m`;
  el.steps.textContent = String(locomotion.stepMode ? locomotion.stepCount : Math.round(locomotion.distanceWalked / 0.64));
  el.speed.textContent = `${locomotion.speedNow.toFixed(2)} m/s`;
  const gap = Math.hypot(
    patientAndRadar.patientGroup.position.x - locomotion.canePosition.x,
    patientAndRadar.patientGroup.position.z - locomotion.canePosition.z
  );
  el.gap.textContent = `${gap.toFixed(2)} m`;

  // --- Barra de estado superior ---
  if (!s.isFallen) {
    el.mode.textContent = locomotion.isMoving ? 'CAMINANDO' : 'EN REPOSO';
    el.statusPill.classList.toggle('is-walking', locomotion.isMoving);
  } else {
    el.mode.textContent = 'ALERTA DE CAÍDA';
  }

  // --- GPS ---
  if (s.isFallen) {
    el.gps.classList.add('alert');
    el.gps.innerHTML =
      `<b>⚠ SOS ACTIVO · impacto ${s.peakImpactG.toFixed(2)} g</b><br/>` +
      `LAT ${formatDMS(s.gpsLat, true)} (${s.gpsLat.toFixed(5)}°)<br/>` +
      `LON ${formatDMS(s.gpsLon, false)} (${s.gpsLon.toFixed(5)}°)<br/>` +
      `ALT ${s.gpsAltM} m · holograma 3D desplegado`;
  } else {
    el.gps.classList.remove('alert');
    el.gps.textContent =
      `LAT ${Math.abs(s.gpsLat).toFixed(6)}° ${s.gpsLat >= 0 ? 'N' : 'S'} · ` +
      `LON ${Math.abs(s.gpsLon).toFixed(6)}° ${s.gpsLon >= 0 ? 'E' : 'W'} · ALT ${s.gpsAltM} m`;
  }

  charts.render(s);
}

/* ============================================================
   6. Acciones de la interfaz y de los botones 3D
   ============================================================ */
function handleAction(action) {
  audio.ensureContext();
  audio.playClick(720);
  switch (action) {
    case 'toggle_gait':
      toggleWalk();
      break;
    case 'cycle_vitals':
      engine.cyclePatientProfile();
      syncPatientUi();
      break;
    case 'trigger_fall':
    case 'trigger_manual_sos':
      engine.triggerFall(elapsedGlobal);
      break;
    case 'reset_cane':
      engine.resetCane();
      break;
    default:
      break;
  }
}

function toggleWalk() {
  const next = !locomotion.autoWalk;
  locomotion.setAutoWalk(next);
  locomotion.stick.x = 0;
  locomotion.stick.y = 0;
  updateWalkButtons();
  if (next) toast('Simulación de marcha activada · el radar buscará a la persona al pasar');
}

function setBtnLabel(id, text) {
  const b = $(id);
  if (!b) return;
  const span = b.querySelector('.lbl');
  if (span) span.textContent = text;
}

function updateWalkButtons() {
  const on = locomotion.autoWalk;
  ['btn-walk', 'btn-walk-top'].forEach((b) => $(b).classList.toggle('is-on', on));
  setBtnLabel('btn-walk', on ? 'Detener marcha' : 'Caminar solo');
  setBtnLabel('btn-walk-top', on ? 'Detener' : 'Caminar');
  $('btn-steps').classList.toggle('is-on', locomotion.stepMode);
  setBtnLabel('btn-steps', locomotion.stepMode ? 'Pasos ON' : 'Pasos reales');
}

function syncPatientUi() {
  const s = engine.state;
  $('slider-hr').value = String(Math.round(s.trueHrBpm));
  $('slider-rr').value = String(Math.round(s.trueRrRpm));
  $('lbl-hr-set').textContent = `${Math.round(s.trueHrBpm)} lpm`;
  $('lbl-rr-set').textContent = `${Math.round(s.trueRrRpm)} rpm`;
  document.querySelectorAll('#patient-profile-group .pill').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.profile === PATIENT_PROFILES[engine.patientProfileIndex]?.id);
  });
}

/* ---------------- Botones superiores ---------------- */
$('btn-walk').addEventListener('click', () => { audio.ensureContext(); toggleWalk(); });
$('btn-walk-top').addEventListener('click', () => { audio.ensureContext(); toggleWalk(); });

$('btn-steps').addEventListener('click', async () => {
  audio.ensureContext();
  if (locomotion.stepMode) {
    locomotion.disableStepMode();
    updateWalkButtons();
    toast('Modo de pasos reales desactivado');
    return;
  }
  const res = await locomotion.enableStepMode();
  if (!res.ok) {
    toast(res.reason, true);
    return;
  }
  updateWalkButtons();
  toast(res.warning || 'Camina con el teléfono en la mano: cada paso mueve tu posición en el mapa');
});

$('btn-reset-walk').addEventListener('click', () => {
  locomotion.reset();
  engine.resetCane();
  setBackdropTransparent(xrManager.isPassthroughActive || webcamOn);
  toast('Posición reiniciada');
});

$('btn-advanced').addEventListener('click', () => $('advanced').classList.toggle('open'));
$('btn-close-advanced').addEventListener('click', () => $('advanced').classList.remove('open'));

$('btn-audio').addEventListener('click', (e) => {
  audio.ensureContext();
  audio.setMuted(!audio.muted);
  e.currentTarget.classList.toggle('is-on', !audio.muted);
  e.currentTarget.title = audio.muted ? 'Audio silenciado' : 'Audio espacial 3D activo';
});

$('btn-enter-xr').addEventListener('click', async () => {
  audio.ensureContext();
  const res = await xrManager.toggleXrSession();
  if (!res.started && res.error) {
    $('xr-modal-msg').textContent = res.error;
    $('xr-modal').classList.add('open');
  }
});
$('btn-modal-close').addEventListener('click', () => $('xr-modal').classList.remove('open'));

async function toggleWebcam() {
  const video = $('webcam-feed');
  if (webcamOn) {
    video.srcObject?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    video.classList.remove('on');
    webcamOn = false;
    $('btn-webcam').classList.remove('is-on');
    setBackdropTransparent(xrManager.isPassthroughActive);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
    video.classList.add('on');
    webcamOn = true;
    $('btn-webcam').classList.add('is-on');
    setBackdropTransparent(true);
  } catch {
    toast('No se pudo abrir la cámara (permiso denegado o sin cámara disponible).', true);
  }
}
$('btn-webcam').addEventListener('click', toggleWebcam);
$('btn-modal-webcam').addEventListener('click', () => {
  $('xr-modal').classList.remove('open');
  toggleWebcam();
});

$('btn-blueprint').addEventListener('click', () => $('blueprint-card').classList.toggle('open'));
$('btn-close-blueprint').addEventListener('click', () => $('blueprint-card').classList.remove('open'));

$('btn-trigger-fall').addEventListener('click', () => {
  audio.ensureContext();
  engine.triggerFall(elapsedGlobal);
});
$('btn-reset-cane').addEventListener('click', () => engine.resetCane());
$('btn-sos-reset').addEventListener('click', () => engine.resetCane());

$('btn-real-gps').addEventListener('click', () => {
  audio.playClick();
  if (!navigator.geolocation) {
    toast('Este navegador no expone GPS; se mantienen las coordenadas de Bogotá.', true);
    return;
  }
  setBtnLabel('btn-real-gps', 'Buscando satélites…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      engine.updateGpsCoordinates(pos.coords.latitude, pos.coords.longitude, pos.coords.altitude || 2625, 'GPS DEL DISPOSITIVO');
      setBtnLabel('btn-real-gps', 'GPS real sincronizado');
      toast('Coordenadas GPS reales sincronizadas');
    },
    () => {
      engine.updateGpsCoordinates(4.710989 + (Math.random() - 0.5) * 0.001, -74.072092 + (Math.random() - 0.5) * 0.001, 2625, 'SIMULACIÓN GNSS · BOGOTÁ D.C.');
      setBtnLabel('btn-real-gps', 'Coordenadas Bogotá activas');
      toast('Sin permiso de GPS: usando Bogotá D.C.', true);
    },
    { enableHighAccuracy: true, timeout: 7000 }
  );
});

/* ---------------- Ajustes avanzados ---------------- */
$('chk-radar-beam').addEventListener('change', (e) => { engine.state.radarEnabled = e.target.checked; });
$('chk-spatial-hud').addEventListener('change', (e) => { spatialHud.calloutsVisible = e.target.checked; });
$('chk-spatial-dock').addEventListener('change', (e) => { engine.state.showSpatialDock = e.target.checked; });
$('chk-vital-beep').addEventListener('change', (e) => {
  audio.ensureContext();
  audio.vitalBeepEnabled = e.target.checked;
});

document.querySelectorAll('#patient-profile-group .pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playClick();
    engine.setPatientProfileById(btn.dataset.profile);
    document.querySelectorAll('#patient-profile-group .pill').forEach((b) => b.classList.remove('is-on'));
    btn.classList.add('is-on');
    syncPatientUi();
  });
});

document.querySelectorAll('#grip-profile-group .pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playClick();
    engine.setGripProfile(btn.dataset.grip);
    document.querySelectorAll('#grip-profile-group .pill').forEach((b) => b.classList.remove('is-on'));
    btn.classList.add('is-on');
  });
});

$('slider-hr').addEventListener('input', (e) => {
  engine.state.trueHrBpm = parseInt(e.target.value, 10);
  $('lbl-hr-set').textContent = `${e.target.value} lpm`;
});
$('slider-rr').addEventListener('input', (e) => {
  engine.state.trueRrRpm = parseInt(e.target.value, 10);
  $('lbl-rr-set').textContent = `${e.target.value} rpm`;
});
$('slider-grip').addEventListener('input', (e) => {
  engine.state.manualGripN = parseFloat(e.target.value);
  $('lbl-grip-set').textContent = `${e.target.value} N`;
});
$('slider-axial').addEventListener('input', (e) => {
  engine.state.manualAxialN = parseFloat(e.target.value);
  $('lbl-axial-set').textContent = `${e.target.value} N`;
});

/* ---------------- Joystick ---------------- */
(() => {
  const joy = $('joystick');
  const stick = $('joystick-stick');
  let activeId = null;

  const setFromEvent = (ev) => {
    const r = joy.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const max = r.width * 0.34;
    let dx = ev.clientX - cx;
    let dy = ev.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
    locomotion.setStick(dx / max, -dy / max);
    updateWalkButtons();
  };

  joy.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    activeId = ev.pointerId;
    joy.setPointerCapture(activeId);
    setFromEvent(ev);
  });
  joy.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== activeId) return;
    setFromEvent(ev);
  });
  const end = (ev) => {
    if (ev.pointerId !== activeId) return;
    activeId = null;
    stick.style.transform = 'translate(0px, 0px)';
    locomotion.setStick(0, 0);
  };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
})();

/* ============================================================
   7. Interacción 3D: empuñadura (presión) y arrastre de la persona
   ============================================================ */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tooltip = $('cursor-tooltip');
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let dragMode = null;
let dragStart = { x: 0, y: 0 };
let dragTiltBase = { x: 0, z: 0 };
let patientDragBase = new THREE.Vector3();

function updateNdc(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
}

renderer.domElement.addEventListener(
  'pointerdown',
  (ev) => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    audio.ensureContext();
    updateNdc(ev);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(getInteractiveTargets(), false);
    if (!hits.length) return;

    const action = hits[0].object.userData?.interactiveAction;
    if (action === 'grab_handle') {
      ev.stopPropagation();
      if (engine.state.isFallen) engine.resetCane();
      dragMode = 'handle';
      controls.enabled = false;
      dragStart = { x: ev.clientX, y: ev.clientY };
      dragTiltBase = { x: engine.state.tiltXRad, z: engine.state.tiltZRad };
      engine.state.isGrabbed = true;
      audio.playClick(520);
      renderer.domElement.setPointerCapture(ev.pointerId);
      toast('Presiona y arrastra: ↓ aumenta la fuerza · ↔ inclina el bastón');
    } else if (action === 'drag_patient') {
      ev.stopPropagation();
      dragMode = 'patient';
      controls.enabled = false;
      dragStart = { x: ev.clientX, y: ev.clientY };
      patientDragBase.copy(patientAndRadar.patientGroup.position);
      renderer.domElement.setPointerCapture(ev.pointerId);
    } else if (action) {
      ev.stopPropagation();
      handleAction(action);
    }
  },
  { capture: true }
);

window.addEventListener('pointermove', (ev) => {
  if (dragMode === 'handle') {
    const dx = ev.clientX - dragStart.x;
    const dy = ev.clientY - dragStart.y;
    const down = Math.max(0, dy);
    engine.state.interactiveGripBoostN = Math.min(115, down * 0.62);
    engine.state.interactiveAxialBoostN = Math.min(280, down * 1.5);
    engine.state.targetTiltXRad = clamp(dragTiltBase.x + dx * 0.0046, -1.2, 1.2);
    engine.state.targetTiltZRad = clamp(dragTiltBase.z + dx * 0.0018, -1.2, 1.2);
    return;
  }

  if (dragMode === 'patient') {
    updateNdc(ev);
    raycaster.setFromCamera(ndc, camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(floorPlane, point)) {
      const nx = clamp(point.x, ROOM_BOUNDS.minX + 0.3, ROOM_BOUNDS.maxX - 0.3);
      const nz = clamp(point.z, ROOM_BOUNDS.minZ + 0.3, ROOM_BOUNDS.maxZ - 0.3);
      patientAndRadar.patientGroup.position.set(nx, 0, nz);
    }
    return;
  }

  if (!renderer.xr.isPresenting) {
    updateNdc(ev);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(getInteractiveTargets(), false);
    if (hits.length && hits[0].object.userData?.label) {
      renderer.domElement.style.cursor = 'grab';
      tooltip.style.display = 'block';
      tooltip.style.left = `${ev.clientX}px`;
      tooltip.style.top = `${ev.clientY}px`;
      tooltip.textContent = hits[0].object.userData.label;
    } else {
      renderer.domElement.style.cursor = 'default';
      tooltip.style.display = 'none';
    }
  }
});

window.addEventListener('pointerup', () => {
  if (dragMode === 'handle') {
    engine.state.isGrabbed = false;
    engine.state.interactiveGripBoostN = 0;
    engine.state.interactiveAxialBoostN = 0;
    // Al soltar, el bastón vuelve solo a la vertical (si superó los 43° se dispara la caída)
    engine.state.targetTiltXRad = 0;
    engine.state.targetTiltZRad = 0;
  }
  if (dragMode) {
    dragMode = null;
    controls.enabled = true;
  }
});

/* ============================================================
   8. Redimensionado
   ============================================================ */
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  roomMap.resize();
  waveHr.resize();
  waveRr.resize();
}
window.addEventListener('resize', onResize);
setTimeout(onResize, 60);
window.addEventListener('load', onResize);
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => { roomMap.resize(); waveHr.resize(); waveRr.resize(); });
  ro.observe($('room-map'));
  ro.observe($('spark-hr'));
  ro.observe($('spark-rr'));
}

/* ============================================================
   9. Bucle principal
   ============================================================ */
const clock = new THREE.Clock();
const followTarget = new THREE.Vector3(-0.12, 0.82, 0.8);
const _desiredTarget = new THREE.Vector3();
const _canePos = new THREE.Vector3();
const _piezo = new THREE.Vector3();
const _xrHead = new THREE.Vector3();
const _xrDir = new THREE.Vector3();

let waveAccum = 0;
let mapAccum = 0;
let bootCompleted = false;
let wasMoving = false;

function getXrPose() {
  if (!renderer.xr.isPresenting) return null;
  const xrCam = renderer.xr.getCamera();
  xrCam.getWorldPosition(_xrHead);
  xrCam.getWorldDirection(_xrDir);
  stageGroup.updateMatrixWorld(true);
  const local = stageGroup.worldToLocal(_xrHead.clone());
  return { x: local.x, z: local.z, yaw: Math.atan2(_xrDir.x, _xrDir.z) };
}

renderer.setAnimationLoop((_time, frame) => {
  const dt = Math.min(0.05, clock.getDelta());
  elapsedGlobal += dt;

  // 1. Desplazamiento del usuario por la habitación
  locomotion.update(dt, elapsedGlobal, getXrPose(), patientAndRadar.patientGroup.position);

  // La marcha activa la curva bimodal de carga en los sensores
  engine.state.gaitAutoEnabled = locomotion.isMoving;
  if (wasMoving && !locomotion.isMoving) {
    engine.state.targetTiltXRad = 0;
    engine.state.targetTiltZRad = 0;
  }
  wasMoving = locomotion.isMoving;

  // 2. El bastón acompaña al usuario
  _canePos.copy(locomotion.canePosition);
  caneModel.root.position.set(_canePos.x, 0, _canePos.z);
  caneModel.root.rotation.y = locomotion.caneYaw;

  // 3. Física biomecánica + radar de 60 GHz
  engine.step(dt, elapsedGlobal);
  stageGroup.updateMatrixWorld(true);

  caneModel.update(engine.state, elapsedGlobal);
  patientAndRadar.update(caneModel, engine.state, elapsedGlobal);

  spatialHud.root.position.set(_canePos.x, 0, _canePos.z);
  spatialHud.update(engine.state, renderer.xr.isPresenting, elapsedGlobal);

  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  fallGps.update(engine.state, activeCamera, elapsedGlobal, dt);

  // 4. Audio espacial en la punta del bastón
  caneModel.getPiezoWorldPosition(_piezo);
  audio.updateSpatialTransform(_piezo, activeCamera);

  // 5. Cámara que sigue al usuario
  if (!renderer.xr.isPresenting) {
    _desiredTarget.copy(locomotion.position).addScaledVector(locomotion.forward, 0.55);
    _desiredTarget.y = 0.82;
    followTarget.lerp(_desiredTarget, 1 - Math.exp(-dt * 5));
    const shift = followTarget.clone().sub(controls.target);
    if (shift.lengthSq() > 1e-9) {
      camera.position.add(shift);
      controls.target.add(shift);
    }
    controls.update();
  }

  xrManager.update(frame);

  // 6. Tarjetas, ondas y mapa
  updateCards(dt);

  // Ondas biomédicas: series analíticas sobre el tiempo simulado (independientes de los FPS)
  waveAccum += dt;
  if (waveAccum >= 1 / 30) {
    waveAccum = 0;
    const s = engine.state;
    if (s.radarLocked) {
      waveHr.setSeries(cardiacSeries(s.cardiacPhaseRad, s.measuredHr, 7.2, 220));
      waveRr.setSeries(respirationSeries(s.respPhaseRad, s.measuredRr, 18, 220));
    } else {
      waveHr.setSeries(flatSeries(0.14, 220, 0.02));
      waveRr.setSeries(flatSeries(0.5, 220, 0.015));
    }
    waveHr.draw();
    waveRr.draw();
  }

  mapAccum += dt;
  if (mapAccum >= 1 / 24) {
    mapAccum = 0;
    roomMap.render({
      locomotion,
      state: engine.state,
      patient: patientAndRadar.patientGroup.position,
      elapsed: elapsedGlobal
    });
  }

  renderer.render(scene, camera);

  if (!bootCompleted) {
    bootCompleted = true;
    window.__CANESMART_BOOTED__ = true;
    const overlay = $('boot-overlay');
    if (overlay) {
      overlay.classList.add('is-hidden');
      setTimeout(() => overlay.remove(), 700);
    }
    syncPatientUi();
    updateWalkButtons();
    // Depuración opcional desde la consola del navegador
    window.__CS = { engine, locomotion, caneModel, patientAndRadar, waveHr, waveRr, roomMap };
  }
});
