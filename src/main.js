import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { CaneSmartModel } from './models/CaneSmartModel.js';
import { VirtualPatientAndRadar } from './models/VirtualPatientAndRadar.js';
import { FallGpsHologram } from './models/FallGpsHologram.js';
import { SpatialDiegeticHUD } from './xr/SpatialDiegeticHUD.js';
import { MetaQuestXRManager } from './xr/MetaQuestXRManager.js';
import { BiomechanicalEngine } from './physics/BiomechanicalEngine.js';
import { SpatialBioAudio } from './audio/SpatialBioAudio.js';
import { TelemetryCharts } from './ui/TelemetryCharts.js';
import { RoomMap, drawSparkline } from './ui/RoomMap.js';
import { RoomSimulator, ROOM } from './game/RoomSimulator.js';
import { formatDMS, thermalCSS } from './utils/heatmap.js';

// --- 1. Initialize Renderer, Scene, Camera & Lighting ---
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040914);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.05, 40);
camera.position.set(0.36, 1.16, 1.92);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.target.set(0.32, 0.62, 0);
controls.minDistance = 0.35;
controls.maxDistance = 5.5;
controls.maxPolarAngle = Math.PI * 0.495;

// Studio & Passthrough-friendly Lighting
const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.9);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
keyLight.position.set(-1.4, 2.8, 2.1);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.2;
keyLight.shadow.camera.far = 8;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
rimLight.position.set(2.2, 1.6, -1.6);
scene.add(rimLight);

// --- 2. Build Mixed-Reality Stage & Studio Backdrop ---
const studioEnvGroup = new THREE.Group();
scene.add(studioEnvGroup);

// Subtle dark reflective floor + metric spatial grid
const floorPlane = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.MeshStandardMaterial({
    color: 0x060d1b,
    roughness: 0.72,
    metalness: 0.25
  })
);
floorPlane.rotation.x = -Math.PI / 2;
floorPlane.receiveShadow = true;
studioEnvGroup.add(floorPlane);

const mainGrid = new THREE.GridHelper(6, 30, 0x0ea5e9, 0x1e293b);
mainGrid.position.y = 0.001;
mainGrid.material.transparent = true;
mainGrid.material.opacity = 0.45;
studioEnvGroup.add(mainGrid);

// Transparent shadow-catcher disc when in Passthrough AR / Webcam AR
const arShadowFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(5, 5),
  new THREE.ShadowMaterial({ opacity: 0.35 })
);
arShadowFloor.rotation.x = -Math.PI / 2;
arShadowFloor.receiveShadow = true;
arShadowFloor.visible = false;
scene.add(arShadowFloor);

// Stage group (holds CaneSmart + Virtual Patient + 60GHz Beam + 3D GPS Hologram + Spatial HUD)
// In Meta Quest Passthrough AR, this entire metric stage anchors onto the user's real floor!
const stageGroup = new THREE.Group();
scene.add(stageGroup);

// --- 3. Instantiate Audio, Physics, Models & XR Subsystems ---
const audio = new SpatialBioAudio();
let elapsedGlobalSec = 0;

const caneModel = new CaneSmartModel();
stageGroup.add(caneModel.root);

const patientAndRadar = new VirtualPatientAndRadar();
stageGroup.add(patientAndRadar.root);

const fallGpsHologram = new FallGpsHologram();
stageGroup.add(fallGpsHologram.root);

const spatialHud = new SpatialDiegeticHUD();
stageGroup.add(spatialHud.root);

const engine = new BiomechanicalEngine({
  onImpact: (intensity) => {
    audio.playImpactThud(intensity);
  },
  onFallDetected: (s) => {
    const coordSpeech = `Latitud ${Math.abs(s.gpsLat).toFixed(2)} norte, longitud ${Math.abs(s.gpsLon).toFixed(2)} oeste.`;
    audio.startFallAlarm(coordSpeech);
    fallGpsHologram.triggerDeploy(caneModel.root.position.x, caneModel.root.position.z);
    syncUiEmergencyState(true);
  },
  onFallReset: () => {
    audio.stopFallAlarm(true);
    fallGpsHologram.hide();
    syncUiEmergencyState(false);
  },
  onSystolicBeat: (hr) => {
    audio.playVitalPulse(hr);
  }
});

// --- 3b. Habitación métrica + peatón que camina con el bastón (modo juego) ---
const room = new RoomSimulator({
  parent: stageGroup,
  caneModel,
  patientAndRadar,
  engine,
  onFootstep: (intensity) => audio.playCaneTap(intensity)
});

const roomMap = new RoomMap(document.getElementById('room-map'));
const hrSparkBuffer = new Array(180).fill(0.15);
const rrSparkBuffer = new Array(180).fill(0.5);

// Cámara en tercera persona: detrás del jugador, siguiendo su posición
const startForward = new THREE.Vector3(Math.cos(room.player.heading), 0, -Math.sin(room.player.heading));
camera.position.set(room.player.x, 1.62, room.player.z).addScaledVector(startForward, -2.15);
controls.target.copy(room.getCameraTarget());
controls.enablePan = false;
controls.minDistance = 0.65;
controls.maxDistance = 5.5;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

// Gather all 3D interactive meshes for mouse & Quest controller raycasting
function getInteractiveTargets() {
  const list = [
    ...caneModel.interactiveMeshes,
    ...patientAndRadar.interactiveMeshes,
    ...spatialHud.interactiveMeshes
  ];
  if (fallGpsHologram.root.visible) {
    list.push(...fallGpsHologram.interactiveMeshes);
  }
  return list;
}

function handleInteractiveAction(action) {
  audio.ensureContext();
  audio.playClick(740);

  switch (action) {
    case 'toggle_gait':
      toggleGaitAuto();
      break;
    case 'cycle_vitals': {
      const p = engine.cyclePatientProfile();
      syncPatientSlidersFromState();
      highlightPatientProfileBtn(p.id);
      break;
    }
    case 'drag_patient':
      if (typeof room !== 'undefined' && room) room.relocatePatient();
      break;
    case 'trigger_fall':
    case 'trigger_manual_sos':
      engine.triggerFall(elapsedGlobalSec);
      break;
    case 'reset_cane':
      engine.resetCane();
      document.getElementById('slider-tilt-x').value = '0';
      document.getElementById('slider-tilt-z').value = '0';
      break;
    case 'toggle_radar_focus':
      animateCameraPreset('radar');
      break;
    default:
      break;
  }
}

let webcamActive = false;

function updateBackdropTransparency(isTransparent) {
  if (isTransparent) {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    studioEnvGroup.visible = false;
    arShadowFloor.visible = true;
  } else {
    scene.background = new THREE.Color(0x040914);
    renderer.setClearColor(0x040914, 1);
    studioEnvGroup.visible = true;
    arShadowFloor.visible = false;
  }
}

const xrManager = new MetaQuestXRManager({
  renderer,
  scene,
  stageGroup,
  caneModel,
  engine,
  interactiveTargetsGetter: getInteractiveTargets,
  onActionTriggered: handleInteractiveAction,
  onSessionStateChange: (active, mode) => {
    const isTransparent = (active && mode === 'immersive-ar') || webcamActive;
    updateBackdropTransparency(isTransparent);
    const xrBtn = document.getElementById('btn-enter-xr');
    xrBtn.textContent = active ? '✕ Salir de Meta Quest MR' : '🥽 Meta Quest MR (Passthrough)';
  }
});

xrManager.checkSupport().then((res) => {
  const xrBtn = document.getElementById('btn-enter-xr');
  if (res.ar) {
    xrBtn.textContent = '🥽 Entrar en Passthrough MR (Quest)';
  }
});

// --- 4. Initialize Telemetry Charts ---
const charts = new TelemetryCharts({
  anatomyCanvas: document.getElementById('canvas-anatomy'),
  scopeForceCanvas: document.getElementById('scope-force'),
  scopeRadarCanvas: document.getElementById('scope-radar'),
  scopeImuCanvas: document.getElementById('scope-imu')
});

// --- 5. Direct 3D Pointer Manipulation (Grab Handle to Press/Tilt/Drop, Drag Patient, Click 3D Buttons) ---
const pointerRaycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const tooltipEl = document.getElementById('cursor-tooltip');

let dragMode = null; // 'handle' | 'patient' | null
let dragStartClient = { x: 0, y: 0 };
let dragBaseTiltX = 0;
let dragBaseTiltZ = 0;
let dragBasePatientX = 0.95;

function updatePointerNDC(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  audio.ensureContext();
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;

  updatePointerNDC(ev);
  pointerRaycaster.setFromCamera(pointerNDC, camera);
  const hits = pointerRaycaster.intersectObjects(getInteractiveTargets(), false);

  if (hits.length > 0) {
    const hitObj = hits[0].object;
    const action = hitObj.userData?.interactiveAction;

    if (action === 'grab_handle') {
      if (engine.state.isFallen) {
        engine.resetCane();
      }
      dragMode = 'handle';
      controls.enabled = false;
      dragStartClient = { x: ev.clientX, y: ev.clientY };
      dragBaseTiltX = engine.state.tiltXRad;
      dragBaseTiltZ = engine.state.tiltZRad;
      engine.state.isGrabbed = true;
      audio.playClick(540);
      renderer.domElement.setPointerCapture(ev.pointerId);
      return;
    }

    if (action === 'drag_patient') {
      // La persona se reubica en otro punto de la habitación (hay que volver a encontrarla)
      room.relocatePatient();
      audio.playClick(600);
      showToast('👤 La persona se movió a otro punto de la habitación');
      return;
    }

    if (action) {
      handleInteractiveAction(action);
    }
  }
});

window.addEventListener('pointermove', (ev) => {
  if (dragMode === 'handle') {
    const dx = ev.clientX - dragStartClient.x;
    const dy = ev.clientY - dragStartClient.y;

    // Pulling downward (dy > 0) exerts biomechanical grip + axial force on CaneSmart!
    const pressDownPx = Math.max(0, dy);
    engine.state.interactiveGripBoostN = Math.min(115, pressDownPx * 0.62);
    engine.state.interactiveAxialBoostN = Math.min(285, pressDownPx * 1.55);

    // Dragging horizontally tilts the cane (past 43° + release -> triggers physical fall!)
    const newTiltX = Math.max(-1.18, Math.min(1.18, dragBaseTiltX + dx * 0.0046));
    const newTiltZ = Math.max(-1.18, Math.min(1.18, dragBaseTiltZ + (dx * 0.0022)));
    engine.state.targetTiltXRad = newTiltX;
    engine.state.targetTiltZRad = newTiltZ;

    document.getElementById('slider-tilt-x').value = ((newTiltX * 180) / Math.PI).toFixed(1);
    document.getElementById('slider-tilt-z').value = ((newTiltZ * 180) / Math.PI).toFixed(1);
    return;
  }


  // Hover tooltip raycast
  if (!renderer.xr.isPresenting) {
    updatePointerNDC(ev);
    pointerRaycaster.setFromCamera(pointerNDC, camera);
    const hits = pointerRaycaster.intersectObjects(getInteractiveTargets(), false);
    if (hits.length > 0 && hits[0].object.userData?.label) {
      renderer.domElement.style.cursor = 'grab';
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = `${ev.clientX}px`;
      tooltipEl.style.top = `${ev.clientY}px`;
      tooltipEl.textContent = hits[0].object.userData.label;
    } else {
      renderer.domElement.style.cursor = 'default';
      tooltipEl.style.display = 'none';
    }
  }
});

window.addEventListener('pointerup', () => {
  if (dragMode === 'handle') {
    dragMode = null;
    controls.enabled = true;
    engine.state.isGrabbed = false;
    engine.state.interactiveGripBoostN = 0;
    engine.state.interactiveAxialBoostN = 0;
  }
});

// --- 6. Smooth Camera Presets ---
// Presets relativos a la posición actual del bastón / del jugador
const CAM_PRESETS = {
  overview: { dist: 2.35, height: 1.62, yaw: -0.55, targetY: 0.95, usePlayer: true },
  handle:   { dist: 0.72, height: 0.95, yaw: 0.95, targetY: 0.82, usePlayer: false },
  base:     { dist: 0.85, height: 0.38, yaw: 0.62, targetY: 0.1, usePlayer: false },
  radar:    { dist: 1.55, height: 1.18, yaw: -1.15, targetY: 0.9, usePlayer: false }
};

let camAnim = null;

function animateCameraPreset(name) {
  const preset = CAM_PRESETS[name];
  if (!preset) return;

  const canePos = caneModel.root.position;
  const base = preset.usePlayer
    ? new THREE.Vector3(room.player.x, preset.targetY, room.player.z)
    : new THREE.Vector3(canePos.x, preset.targetY, canePos.z);

  const dir = new THREE.Vector3(Math.sin(preset.yaw), 0, Math.cos(preset.yaw));
  const pos = base.clone().addScaledVector(dir, preset.dist);
  pos.y = Math.max(0.25, preset.height);

  camAnim = {
    startPos: camera.position.clone(),
    endPos: pos,
    startTarget: controls.target.clone(),
    endTarget: base.clone(),
    t: 0
  };
  ['overview', 'handle', 'base', 'radar'].forEach((k) => {
    document.getElementById(`btn-cam-${k}`)?.classList.toggle('active', k === name);
  });
}

// --- 7. Wire Up DOM Controls & Modals ---
const sliderGrip = document.getElementById('slider-grip');
const sliderAxial = document.getElementById('slider-axial');
const sliderTiltX = document.getElementById('slider-tilt-x');
const sliderTiltZ = document.getElementById('slider-tilt-z');
const sliderHr = document.getElementById('slider-hr');
const sliderRr = document.getElementById('slider-rr');
const sliderDist = document.getElementById('slider-dist');

sliderGrip.addEventListener('input', () => {
  engine.state.manualGripN = parseFloat(sliderGrip.value);
  document.getElementById('lbl-grip-val').textContent = `${Math.round(engine.state.manualGripN)} N`;
});

sliderAxial.addEventListener('input', () => {
  engine.state.manualAxialN = parseFloat(sliderAxial.value);
  document.getElementById('lbl-axial-val').textContent = `${Math.round(engine.state.manualAxialN)} N`;
});

function onTiltSlidersInput() {
  if (engine.state.isFallen) engine.resetCane();
  engine.state.gaitAutoEnabled = false;
  document.getElementById('btn-gait-auto').classList.remove('active');
  const degX = parseFloat(sliderTiltX.value);
  const degZ = parseFloat(sliderTiltZ.value);
  engine.state.targetTiltXRad = THREE.MathUtils.degToRad(degX);
  engine.state.targetTiltZRad = THREE.MathUtils.degToRad(degZ);
}
sliderTiltX.addEventListener('input', onTiltSlidersInput);
sliderTiltZ.addEventListener('input', onTiltSlidersInput);

function toggleGaitAuto() {
  if (engine.state.isFallen) engine.resetCane();
  const active = !room.autoWalk;
  room.setAutoWalk(active);
  engine.state.gaitAutoEnabled = active;

  const btn = document.getElementById('btn-gait-auto');
  btn.classList.toggle('active', active);
  btn.textContent = active ? '⏸ Detener Marcha Automática' : '🚶 Simular Ciclo de Marcha Activa';

  const btn2 = document.getElementById('btn-autowalk');
  if (btn2) {
    btn2.classList.toggle('active', active);
    btn2.textContent = active ? '⏸ Detener caminata' : '🚶 Caminar automático';
  }
}
document.getElementById('btn-gait-auto').addEventListener('click', () => {
  audio.playClick();
  toggleGaitAuto();
});

// Grip profile buttons
document.querySelectorAll('#grip-profile-group .pill-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playClick();
    document.querySelectorAll('#grip-profile-group .pill-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    engine.setGripProfile(btn.dataset.grip);
  });
});

// Patient profile buttons & sliders
function syncPatientSlidersFromState() {
  sliderHr.value = String(engine.state.trueHrBpm);
  sliderRr.value = String(engine.state.trueRrRpm);
  document.getElementById('lbl-hr-val').textContent = `${engine.state.trueHrBpm} BPM`;
  document.getElementById('lbl-rr-val').textContent = `${engine.state.trueRrRpm} RPM`;
}

function highlightPatientProfileBtn(profileId) {
  document.querySelectorAll('#patient-profile-group .pill-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.profile === profileId);
  });
}

document.querySelectorAll('#patient-profile-group .pill-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playClick();
    const id = btn.dataset.profile;
    engine.setPatientProfileById(id);
    highlightPatientProfileBtn(id);
    syncPatientSlidersFromState();
  });
});

sliderHr.addEventListener('input', () => {
  engine.state.trueHrBpm = parseInt(sliderHr.value, 10);
  document.getElementById('lbl-hr-val').textContent = `${engine.state.trueHrBpm} BPM`;
});

sliderRr.addEventListener('input', () => {
  engine.state.trueRrRpm = parseInt(sliderRr.value, 10);
  document.getElementById('lbl-rr-val').textContent = `${engine.state.trueRrRpm} RPM`;
});

// En el modo habitación la persona se ubica con el botón "Mover persona";
// este deslizador la desplaza en línea recta frente al bastón (modo técnico).
sliderDist.addEventListener('input', () => {
  const d = parseFloat(sliderDist.value);
  const canePos = caneModel.root.position;
  const h = room.player.heading;
  patientAndRadar.patientGroup.position.set(
    canePos.x + Math.cos(h) * d,
    0,
    canePos.z - Math.sin(h) * d
  );
  engine.state.presenceDetected = false;
  document.getElementById('lbl-dist-val').textContent = `${d.toFixed(2)} m`;
});

document.getElementById('chk-radar-beam').addEventListener('change', (e) => {
  engine.state.radarEnabled = e.target.checked;
});

document.getElementById('chk-vital-beep').addEventListener('change', (e) => {
  audio.ensureContext();
  audio.vitalBeepEnabled = e.target.checked;
});

document.getElementById('chk-spatial-hud').addEventListener('change', (e) => {
  spatialHud.calloutsVisible = e.target.checked;
});

document.getElementById('chk-spatial-dock').addEventListener('change', (e) => {
  engine.state.showSpatialDock = e.target.checked;
});

// Fall & Reset & Real GPS buttons
document.getElementById('btn-trigger-fall').addEventListener('click', () => {
  audio.ensureContext();
  engine.triggerFall(elapsedGlobalSec);
});

document.getElementById('btn-reset-cane').addEventListener('click', () => {
  audio.ensureContext();
  engine.resetCane();
  sliderTiltX.value = '0';
  sliderTiltZ.value = '0';
});

document.getElementById('btn-real-gps').addEventListener('click', () => {
  audio.playClick();
  const btn = document.getElementById('btn-real-gps');
  if (!navigator.geolocation) {
    btn.textContent = '⚠ GPS navegador no disponible (Usando Bogotá D.C.)';
    return;
  }
  btn.textContent = '📡 Obteniendo satélites GPS...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      engine.updateGpsCoordinates(
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.altitude || 2625,
        'GNSS DISPOSITIVO EN VIVO'
      );
      btn.textContent = '✓ GPS Real Sincronizado';
    },
    () => {
      // Fallback subtle coordinate jitter in Bogotá D.C.
      engine.updateGpsCoordinates(
        4.710989 + (Math.random() - 0.5) * 0.0008,
        -74.072092 + (Math.random() - 0.5) * 0.0008,
        2625,
        'SIMULACIÓN GNSS BOGOTÁ D.C.'
      );
      btn.textContent = '📍 Coordenadas GNSS Bogotá Activas';
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
});

// Top Header Actions: Meta Quest MR, Webcam Passthrough, Blueprint, Camera Views, Audio, Panels
const xrModal = document.getElementById('xr-modal');
document.getElementById('btn-enter-xr').addEventListener('click', async () => {
  audio.ensureContext();
  const res = await xrManager.toggleXrSession();
  if (!res.started && res.error) {
    document.getElementById('xr-modal-msg').textContent = res.error;
    xrModal.classList.add('open');
  }
});

document.getElementById('btn-modal-close').addEventListener('click', () => {
  xrModal.classList.remove('open');
});

async function toggleWebcamPassthrough() {
  const video = document.getElementById('webcam-feed');
  const btn = document.getElementById('btn-webcam-ar');

  if (webcamActive) {
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    video.classList.remove('active');
    webcamActive = false;
    btn.classList.remove('active');
    updateBackdropTransparency(xrManager.isPassthroughActive);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    video.classList.add('active');
    webcamActive = true;
    btn.classList.add('active');
    updateBackdropTransparency(true);
  } catch (_) {
    // Even if sandboxed/no camera hardware, toggle clean transparent grid-free preview note
    alert('No se detectó cámara física disponible en este navegador, o el permiso fue denegado.');
  }
}

document.getElementById('btn-webcam-ar').addEventListener('click', toggleWebcamPassthrough);
document.getElementById('btn-modal-webcam').addEventListener('click', () => {
  xrModal.classList.remove('open');
  toggleWebcamPassthrough();
});

const blueprintCard = document.getElementById('blueprint-card');
const btnBlueprint = document.getElementById('btn-blueprint');
btnBlueprint.addEventListener('click', () => {
  const vis = blueprintCard.classList.toggle('visible');
  btnBlueprint.classList.toggle('active', vis);
});
document.getElementById('btn-close-blueprint').addEventListener('click', () => {
  blueprintCard.classList.remove('visible');
  btnBlueprint.classList.remove('active');
});

['overview', 'handle', 'base', 'radar'].forEach((presetName) => {
  document.getElementById(`btn-cam-${presetName}`).addEventListener('click', () => {
    audio.playClick();
    animateCameraPreset(presetName);
  });
});

document.getElementById('btn-audio-mute').addEventListener('click', (e) => {
  audio.ensureContext();
  audio.setMuted(!audio.muted);
  e.currentTarget.textContent = audio.muted ? '🔇 Silenciado' : '🔊 Audio 3D';
  e.currentTarget.classList.toggle('active', !audio.muted);
});

let panelsVisible = true;
document.getElementById('btn-toggle-panels').addEventListener('click', (e) => {
  panelsVisible = !panelsVisible;
  document.getElementById('left-dock').classList.toggle('collapsed', !panelsVisible);
  document.getElementById('right-dock').classList.toggle('collapsed', !panelsVisible);
  e.currentTarget.classList.toggle('active', !panelsVisible);
});

// --- 7b. Modo juego: alternancia, joystick táctil y controles de marcha ---
const gameHudEl = document.getElementById('game-hud');

// Toast efímero dentro del HUD de juego
const toastEl = document.createElement('div');
toastEl.id = 'game-toast';
gameHudEl.appendChild(toastEl);
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

const btnMode = document.getElementById('btn-mode');
function setGameMode(isGame) {
  document.body.classList.toggle('mode-game', isGame);
  btnMode.textContent = isGame ? '🔬 Modo técnico' : '🎮 Modo juego';
  btnMode.classList.toggle('active', !isGame);
  if (isGame) {
    roomsResize();
  }
  showToast(isGame
    ? '🎮 Modo juego: solo los datos importantes'
    : '🔬 Modo técnico: telemetría completa');
}
function roomsResize() {
  try { roomMap.resize(); } catch (_) {}
}
btnMode.addEventListener('click', () => {
  audio.playClick();
  setGameMode(!document.body.classList.contains('mode-game'));
});

// Joystick táctil
const joystickEl = document.getElementById('joystick');
const knobEl = document.getElementById('joystick-knob');
let joyPointerId = null;

function updateJoystickFromEvent(ev) {
  const rect = joystickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxR = rect.width * 0.34;
  let dx = ev.clientX - cx;
  let dy = ev.clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR) {
    dx = (dx / dist) * maxR;
    dy = (dy / dist) * maxR;
  }
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  room.setJoystick(dx / maxR, -dy / maxR);
}

function resetJoystick() {
  joyPointerId = null;
  knobEl.style.transform = 'translate(0px, 0px)';
  room.setJoystick(0, 0);
}

joystickEl.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  audio.ensureContext();
  joyPointerId = ev.pointerId;
  joystickEl.setPointerCapture(ev.pointerId);
  updateJoystickFromEvent(ev);
});
joystickEl.addEventListener('pointermove', (ev) => {
  if (joyPointerId !== ev.pointerId) return;
  updateJoystickFromEvent(ev);
});
joystickEl.addEventListener('pointerup', (ev) => {
  if (joyPointerId === ev.pointerId) resetJoystick();
});
joystickEl.addEventListener('pointercancel', resetJoystick);

// Botones del modo juego
document.getElementById('btn-autowalk').addEventListener('click', () => {
  audio.playClick();
  toggleGaitAuto();
});

document.getElementById('btn-relocate-person').addEventListener('click', () => {
  audio.playClick();
  room.relocatePatient();
  showToast('👤 La persona se movió: vuelve a buscarla con el radar');
});

document.getElementById('btn-game-fall').addEventListener('click', () => {
  audio.ensureContext();
  room.setAutoWalk(false);
  engine.triggerFall(elapsedGlobalSec);
});

document.getElementById('btn-game-reset').addEventListener('click', () => {
  audio.ensureContext();
  engine.resetCane();
  showToast('↻ Bastón recuperado en la mano');
});

// --- 8. UI Telemetry DOM Updater ---
const statusPill = document.getElementById('system-status-pill');
const kpiAxial = document.getElementById('kpi-axial');
const kpiGrip = document.getElementById('kpi-grip');
const kpiHr = document.getElementById('kpi-hr');
const kpiRr = document.getElementById('kpi-rr');
const lblTiltVal = document.getElementById('lbl-tilt-val');
const badgeCop = document.getElementById('badge-cop-state');
const badgeSnr = document.getElementById('badge-snr');
const lblRadarLock = document.getElementById('lbl-radar-lock');
const lblImuG = document.getElementById('lbl-imu-g');
const badgeSos = document.getElementById('badge-sos');
const gpsBox = document.getElementById('gps-box');

function syncUiEmergencyState(isEmergency) {
  if (isEmergency) {
    statusPill.classList.add('emergency');
    statusPill.textContent = '⚠ ALERTA DE CAÍDA · BALIZA SOS GPS 3D ACTIVA';
    badgeSos.textContent = 'SOS TRANSMITIENDO';
    badgeSos.style.background = 'rgba(255, 46, 76, 0.25)';
    badgeSos.style.color = '#fda4af';
    gpsBox.classList.add('alert');
  } else {
    statusPill.classList.remove('emergency');
    statusPill.textContent = '● MONITOREO BIOMÉTRICO ACTIVO';
    badgeSos.textContent = 'EN ESPERA';
    badgeSos.style.background = '';
    badgeSos.style.color = '';
    gpsBox.classList.remove('alert');
  }
}

let uiRefreshAccum = 0;
function updateDomTelemetry(dt) {
  uiRefreshAccum += dt;
  if (uiRefreshAccum < 0.06) return;
  uiRefreshAccum = 0;

  const s = engine.state;
  kpiAxial.textContent = `${s.axialForceN.toFixed(1)} N`;
  kpiAxial.style.color = thermalCSS(Math.min(1, s.axialForceN / 360));

  kpiGrip.textContent = `${s.totalGripN.toFixed(1)} N`;
  kpiGrip.style.color = thermalCSS(Math.min(1, s.totalGripN / 120));

  if (s.radarLocked) {
    kpiHr.textContent = `${Math.round(s.measuredHr)} BPM`;
    kpiRr.textContent = `${Math.round(s.measuredRr)} RPM`;
    badgeSnr.textContent = `SNR ${s.radarSnrDb.toFixed(1)} dB`;
    lblRadarLock.textContent = `ENGANCHADO (${s.radarDistanceM.toFixed(2)}m)`;
    lblRadarLock.style.color = '#34d399';
  } else {
    kpiHr.textContent = '-- BPM';
    kpiRr.textContent = '-- RPM';
    badgeSnr.textContent = 'SIN ECO';
    lblRadarLock.textContent = 'FUERA DE CONO';
    lblRadarLock.style.color = '#fbbf24';
  }

  lblTiltVal.textContent = `${s.fallAngleDeg.toFixed(1)}°`;
  lblImuG.textContent = `${s.imuAccelG.toFixed(2)} g`;

  if (s.isFallen) {
    badgeCop.textContent = 'CAÍDA EN SUELO';
    badgeCop.style.color = '#ff4d6d';
    gpsBox.innerHTML =
      `<strong>⚠ SOS ACTIVO · IMPACTO ${s.peakImpactG.toFixed(2)} g</strong><br/>` +
      `LAT: ${formatDMS(s.gpsLat, true)} (${s.gpsLat.toFixed(5)}°)<br/>` +
      `LON: ${formatDMS(s.gpsLon, false)} (${s.gpsLon.toFixed(5)}°)<br/>` +
      `ALT: ${s.gpsAltM} m · HOLOGRAMA 3D DESPLEGADO`;
  } else {
    const stable = s.fallAngleDeg < 22;
    badgeCop.textContent = stable ? 'CoP ESTABLE' : 'INCLINACIÓN ALTA';
    badgeCop.style.color = stable ? '#67e8f9' : '#fbbf24';
    gpsBox.innerHTML =
      `LAT: ${Math.abs(s.gpsLat).toFixed(6)}° ${s.gpsLat >= 0 ? 'N' : 'S'} · ` +
      `LON: ${Math.abs(s.gpsLon).toFixed(6)}° ${s.gpsLon >= 0 ? 'E' : 'W'}<br/>` +
      `ALT: ${s.gpsAltM} m · ${s.gpsSourceLabel}`;
  }

  charts.render(s);
  updateGameHud(s);
}

// --- 8b. HUD del modo juego (solo datos importantes) ---
const presenceBanner = document.getElementById('presence-banner');
const presenceTitle = document.getElementById('presence-title');
const presenceSub = document.getElementById('presence-sub');
const presenceDist = document.getElementById('presence-dist');
const fsrForceEl = document.getElementById('fsr-force');
const fsrKgEl = document.getElementById('fsr-kg');
const fsrBarEl = document.getElementById('fsr-bar');
const axialForceEl = document.getElementById('axial-force');
const axialKgEl = document.getElementById('axial-kg');
const peakForceEl = document.getElementById('peak-force');
const vitalHrEl = document.getElementById('vital-hr');
const vitalRrEl = document.getElementById('vital-rr');
const hrQualityEl = document.getElementById('hr-quality');
const rrQualityEl = document.getElementById('rr-quality');
const vitalCardHr = document.getElementById('vital-card-hr');
const vitalCardRr = document.getElementById('vital-card-rr');
const mapCoordsEl = document.getElementById('map-coords');
const walkStepsEl = document.getElementById('walk-steps');
const walkDistEl = document.getElementById('walk-dist');
const walkCadenceEl = document.getElementById('walk-cadence');
const mapObjectiveEl = document.getElementById('map-objective');

let lastPresenceState = null;

function updateGameHud(s) {
  // --- Detección de presencia ---
  const present = s.presenceDetected;
  const locked = s.radarLocked;

  presenceBanner.classList.toggle('detected', present && !locked);
  presenceBanner.classList.toggle('locked', locked);

  if (locked) {
    presenceTitle.textContent = 'PRESENCIA DETECTADA · MIDIENDO SIGNOS VITALES';
    presenceSub.textContent = 'Mantén el bastón apuntado al tórax para estabilizar la lectura';
  } else if (present) {
    presenceTitle.textContent = 'PRESENCIA HUMANA DETECTADA';
    presenceSub.textContent = 'Acércate y apunta el bastón hacia el tórax para medir FC y FR';
  } else {
    presenceTitle.textContent = 'BUSCANDO PRESENCIA HUMANA';
    presenceSub.textContent = 'Camina por la habitación y apunta el bastón hacia la persona';
  }
  presenceDist.textContent = present ? `${s.presenceDistanceM.toFixed(2)} m` : '-- m';

  if (lastPresenceState !== present) {
    lastPresenceState = present;
    if (present && !locked) showToast('📡 Presencia detectada · apunta al tórax');
    if (locked) showToast('❤️ Signos vitales enganchados');
  }

  // --- Presión del bastón (FSR) y celda de carga ---
  const gripN = s.totalGripN;
  fsrForceEl.textContent = gripN.toFixed(1);
  fsrKgEl.textContent = `${(gripN / 9.81).toFixed(1)} kg`;
  fsrBarEl.style.width = `${Math.min(100, (gripN / 165) * 100)}%`;
  fsrForceEl.style.color = thermalCSS(Math.min(1, gripN / 140));

  axialForceEl.textContent = `${s.axialForceN.toFixed(1)} N`;
  axialKgEl.textContent = `${(s.axialForceN / 9.81).toFixed(1)} kg`;
  peakForceEl.textContent = `${Math.round(Math.max(s.peakGripN, s.peakAxialN))} N`;

  // --- Signos vitales ---
  if (locked) {
    vitalHrEl.textContent = String(Math.round(s.measuredHr));
    vitalRrEl.textContent = String(Math.round(s.measuredRr));
    const q = Math.round(s.vitalsQuality01 * 100);
    hrQualityEl.textContent = `CALIDAD ${q}%`;
    rrQualityEl.textContent = `SNR ${s.radarSnrDb.toFixed(1)} dB`;
    vitalCardHr.classList.add('active');
    vitalCardRr.classList.add('active');
  } else {
    vitalHrEl.textContent = '--';
    vitalRrEl.textContent = '--';
    hrQualityEl.textContent = present ? 'SIN ENGANCHAR' : '—';
    rrQualityEl.textContent = present ? 'SIN ENGANCHAR' : '—';
    vitalCardHr.classList.remove('active');
    vitalCardRr.classList.remove('active');
  }

  // Esparcogramas en vivo
  hrSparkBuffer.push(locked ? s.systolicPulse01 : 0.12 + Math.random() * 0.02);
  if (hrSparkBuffer.length > 180) hrSparkBuffer.shift();
  rrSparkBuffer.push(locked ? 0.5 + 0.5 * Math.sin(s.respPhaseRad) : 0.5);
  if (rrSparkBuffer.length > 180) rrSparkBuffer.shift();
  drawSparkline(document.getElementById('spark-hr'), hrSparkBuffer, locked ? '#fb7185' : '#475569');
  drawSparkline(document.getElementById('spark-rr'), rrSparkBuffer, locked ? '#2dd4bf' : '#475569');

  // --- Mapa y estadísticas de marcha ---
  mapCoordsEl.textContent = `X ${room.player.x.toFixed(1)} · Z ${room.player.z.toFixed(1)}`;
  walkStepsEl.textContent = String(s.stepsCount);
  walkDistEl.textContent = `${s.distanceWalkedM.toFixed(1)} m`;
  walkCadenceEl.textContent = `${Math.round(s.cadenceSpm)} ppm`;

  const objectiveDone = s.measurementSeconds > 4;
  mapObjectiveEl.classList.toggle('done', objectiveDone);
  mapObjectiveEl.textContent = objectiveDone
    ? '✅ Objetivo cumplido: FC y FR medidas'
    : '🎯 Localiza a la persona y mide su FC y FR';
}

// --- 9. Resize Handler & Main WebGL / WebXR Render Loop ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  roomMap.resize();
});

const clock = new THREE.Clock();
const _piezoWorld = new THREE.Vector3();
const _followTarget = new THREE.Vector3();
const _followDelta = new THREE.Vector3();
let bootCompleted = false;

renderer.setAnimationLoop((timestampMs, xrFrame) => {
  const dt = clock.getDelta();
  elapsedGlobalSec += Math.min(0.05, dt);

  // Camera preset transition (when not in XR)
  if (camAnim && !renderer.xr.isPresenting) {
    camAnim.t = Math.min(1, camAnim.t + dt * 2.6);
    const ease = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, ease);
    controls.target.lerpVectors(camAnim.startTarget, camAnim.endTarget, ease);
    if (camAnim.t >= 1) camAnim = null;
  }

  // Step XR controllers / hand tracking / hit-test floor reticle
  xrManager.update(xrFrame);

  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;

  // --- Habitación: mueve al peatón y coloca el bastón en su mano ---
  room.update(dt, elapsedGlobalSec, {
    renderer,
    camera,
    controls,
    xrCamera: renderer.xr.isPresenting ? activeCamera : null
  });

  // Cámara en tercera persona que sigue al jugador (sin pelear con la órbita del usuario)
  if (!renderer.xr.isPresenting && !camAnim) {
    const followTarget = room.getCameraTarget(_followTarget);
    _followDelta.copy(followTarget).sub(controls.target);
    controls.target.copy(followTarget);
    camera.position.add(_followDelta);
    controls.update();
  }

  // Step biomechanical physics & 60 GHz signal synthesis
  engine.step(dt, elapsedGlobalSec);

  // Update 3D Digital Twin of CaneSmart
  caneModel.update(engine.state, elapsedGlobalSec);

  // Ensure world matrices are fresh before computing 60 GHz beam & spatial audio transforms
  stageGroup.updateMatrixWorld(true);

  // Update Virtual Biometric Patient & 60 GHz Electromagnetic Beam
  patientAndRadar.update(caneModel, engine.state, elapsedGlobalSec);

  // Update 3D Spatial GPS Hologram (when fallen) & Diegetic Spatial Panels
  fallGpsHologram.update(engine.state, activeCamera, elapsedGlobalSec, dt);
  if (!engine.state.isFallen) {
    spatialHud.root.position.set(caneModel.root.position.x, 0, caneModel.root.position.z);
  }
  spatialHud.update(engine.state, renderer.xr.isPresenting, elapsedGlobalSec);

  // Update 3D Spatial Audio Listener & Cane Piezo Source
  caneModel.getPiezoWorldPosition(_piezoWorld);
  audio.updateSpatialTransform(_piezoWorld, activeCamera);

  // Refresh 2D HUD, Oscilloscopes & Mapa de la habitación
  updateDomTelemetry(dt);
  roomMap.render(room.getMapData(), elapsedGlobalSec);

  renderer.render(scene, camera);

  // First successful frame -> dismiss the boot overlay & arm the diagnostics watchdog
  if (!bootCompleted) {
    bootCompleted = true;
    window.__CANESMART_BOOTED__ = true;
    const bootOverlay = document.getElementById('boot-overlay');
    if (bootOverlay) {
      bootOverlay.classList.add('is-hidden');
      window.setTimeout(() => bootOverlay.remove(), 700);
    }
    window.setTimeout(() => {
      showToast('🎮 Camina con WASD / joystick y apunta el bastón a la persona para medir FC y FR');
    }, 1100);
  }
});
