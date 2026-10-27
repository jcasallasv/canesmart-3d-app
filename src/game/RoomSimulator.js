import * as THREE from 'three';

/**
 * Habitación métrica + peatón (jugador) que camina con el bastón CaneSmart.
 *
 * Sistema de coordenadas:
 *   - El suelo de la habitación está centrado en el origen del escenario.
 *   - El jugador tiene una posición (x, z) y una orientación `heading` (rad).
 *   - forward = (cos(heading), 0, -sin(heading))  →  heading = 0 mira hacia +X.
 *   - El bastón se lleva en la mano derecha: se coloca en
 *     player + right * 0.24 + forward * 0.15, con el eje +X del modelo apuntando
 *     exactamente hacia donde camina el jugador (el radomo 60 GHz queda al frente).
 */
export const ROOM = {
  width: 5.2,
  depth: 4.4,
  wallHeight: 2.45,
  margin: 0.24,
  door: { centerX: 1.25, halfWidth: 0.55, z: 2.2 },
  furniture: [
    { id: 'cama', label: 'Cama', x: -1.95, z: -1.2, w: 1.0, d: 2.1, h: 0.52 },
    { id: 'mesa', label: 'Mesa', x: 1.95, z: 1.5, w: 0.8, d: 0.8, h: 0.74 },
    { id: 'silla', label: 'Silla', x: 2.02, z: -1.55, w: 0.52, d: 0.52, h: 0.86 }
  ],
  patientSpots: [
    { x: 1.45, z: 0.35 },
    { x: -0.55, z: -1.5 },
    { x: 1.25, z: -1.65 },
    { x: 2.05, z: 0.55 },
    { x: 0.8, z: -0.6 }
  ],
  start: { x: -1.78, z: 1.62, heading: 0.72 }
};

const STRIDE_M = 0.68;
const WALK_SPEED = 1.35;
const RUN_SPEED = 2.15;

export class RoomSimulator {
  constructor({ parent, caneModel, patientAndRadar, engine, onFootstep, onPresenceChange }) {
    this.parent = parent;
    this.caneModel = caneModel;
    this.patientAndRadar = patientAndRadar;
    this.engine = engine;
    this.onFootstep = onFootstep || (() => {});
    this.onPresenceChange = onPresenceChange || (() => {});

    this.player = {
      x: ROOM.start.x,
      z: ROOM.start.z,
      heading: ROOM.start.heading,
      speed: 0,
      strideM: STRIDE_M,
      steps: 0,
      distanceM: 0,
      cadenceSpm: 0
    };

    this.gaitPhase = 0;
    this.autoWalk = false;
    this.autoWalkTurn = 1;
    this.joystick = { x: 0, y: 0 };
    this.keys = new Set();
    this.trail = [{ x: this.player.x, z: this.player.z }];
    this.patientSpotIndex = 0;
    this.patientWander = false;
    this._wanderTimer = 0;
    this._presencePrev = null;
    this.lastKnownPatient = { x: ROOM.patientSpots[0].x, z: ROOM.patientSpots[0].z };
    this._fallPose = null;
    this._stepAccum = 0;

    this._tmpForward = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpVec = new THREE.Vector3();
    this._tmpVec2 = new THREE.Vector3();

    this._buildRoom();
    this._buildPlayerMarker();
    this._bindKeyboard();
    this.placePatient(0);
  }

  /* ------------------------------------------------------------------ */
  /* Geometría de la habitación                                          */
  /* ------------------------------------------------------------------ */

  _buildRoom() {
    this.root = new THREE.Group();
    this.root.name = 'HabitacionMetrica';
    this.parent.add(this.root);

    const { width: W, depth: D, wallHeight: H } = ROOM;

    // Suelo
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0b1526,
      roughness: 0.82,
      metalness: 0.18
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    this.root.add(floor);

    // Rejilla métrica de 0.5 m
    const gridPts = [];
    for (let x = -W / 2; x <= W / 2 + 1e-6; x += 0.5) {
      gridPts.push(x, 0, -D / 2, x, 0, D / 2);
    }
    for (let z = -D / 2; z <= D / 2 + 1e-6; z += 0.5) {
      gridPts.push(-W / 2, 0, z, W / 2, 0, z);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    const grid = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0x1d3a5c, transparent: true, opacity: 0.55 })
    );
    grid.position.y = 0.004;
    this.root.add(grid);

    // Zócalo luminoso del perímetro
    const basePts = [
      -W / 2, 0.01, -D / 2, W / 2, 0.01, -D / 2,
      W / 2, 0.01, -D / 2, W / 2, 0.01, D / 2,
      W / 2, 0.01, D / 2, -W / 2, 0.01, D / 2,
      -W / 2, 0.01, D / 2, -W / 2, 0.01, -D / 2
    ];
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(basePts, 3));
    this.root.add(
      new THREE.LineSegments(
        baseGeo,
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })
      )
    );

    // Paredes semitransparentes
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x12304f,
      emissive: 0x0b4a6f,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.2,
      roughness: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mkWall = (w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      mesh.position.set(x, y, z);
      this.root.add(mesh);
      return mesh;
    };

    const t = 0.05;
    mkWall(W, H, t, 0, H / 2, -D / 2); // pared norte
    mkWall(t, H, D, -W / 2, H / 2, 0); // pared oeste
    mkWall(t, H, D, W / 2, H / 2, 0); // pared este

    // Pared sur con hueco de puerta
    const doorL = ROOM.door.centerX - ROOM.door.halfWidth + W / 2;
    const doorR = ROOM.door.centerX + ROOM.door.halfWidth + W / 2;
    mkWall(doorL, H, t, -W / 2 + doorL / 2, H / 2, D / 2);
    mkWall(W - doorR, H, t, -W / 2 + doorR + (W - doorR) / 2, H / 2, D / 2);

    // Marco de la puerta
    const doorFrameMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.7 });
    [-ROOM.door.halfWidth, ROOM.door.halfWidth].forEach((dx) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.1, 0.035), doorFrameMat);
      post.position.set(ROOM.door.centerX + dx, 1.05, D / 2);
      this.root.add(post);
    });
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM.door.halfWidth * 2, 0.035, 0.035),
      doorFrameMat
    );
    lintel.position.set(ROOM.door.centerX, 2.1, D / 2);
    this.root.add(lintel);

    // Mobiliario (silueta translúcida con aristas)
    this.furnitureMeshes = [];
    ROOM.furniture.forEach((f) => {
      const g = new THREE.Group();
      g.position.set(f.x, 0, f.z);

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(f.w, f.h, f.d),
        new THREE.MeshStandardMaterial({
          color: 0x1e3a5f,
          emissive: 0x0c4a6e,
          emissiveIntensity: 0.25,
          transparent: true,
          opacity: 0.32,
          roughness: 0.6,
          metalness: 0.2
        })
      );
      body.position.y = f.h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(f.w, f.h, f.d)),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 })
      );
      edges.position.y = f.h / 2;
      g.add(edges);

      this.root.add(g);
      this.furnitureMeshes.push(g);
    });
  }

  _buildPlayerMarker() {
    const g = new THREE.Group();
    this.playerMarker = g;
    this.root.add(g);

    const ringGeo = new THREE.RingGeometry(0.26, 0.3, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.playerRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    );
    this.playerRing.position.y = 0.012;
    g.add(this.playerRing);

    const dotGeo = new THREE.CircleGeometry(0.1, 28);
    dotGeo.rotateX(-Math.PI / 2);
    this.playerDot = new THREE.Mesh(
      dotGeo,
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.35 })
    );
    this.playerDot.position.y = 0.011;
    g.add(this.playerDot);

    // Flecha de orientación
    const arrowGeo = new THREE.ConeGeometry(0.09, 0.24, 18);
    arrowGeo.rotateZ(-Math.PI / 2); // apunta hacia +X local
    this.playerArrow = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 })
    );
    this.playerArrow.position.set(0.31, 0.03, 0);
    this.playerArrow.rotation.z = Math.PI / 2;
    g.add(this.playerArrow);
  }

  /* ------------------------------------------------------------------ */
  /* Entradas                                                            */
  /* ------------------------------------------------------------------ */

  _bindKeyboard() {
    const tracking = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight'
    ]);

    window.addEventListener('keydown', (e) => {
      if (!tracking.has(e.code)) return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (tracking.has(e.code)) this.keys.delete(e.code);
    });
  }

  setJoystick(x, y) {
    this.joystick.x = Math.max(-1, Math.min(1, x));
    this.joystick.y = Math.max(-1, Math.min(1, y));
  }

  setAutoWalk(active) {
    this.autoWalk = active;
  }

  /* ------------------------------------------------------------------ */
  /* Persona a monitorizar                                               */
  /* ------------------------------------------------------------------ */

  placePatient(index) {
    const spots = ROOM.patientSpots;
    this.patientSpotIndex = ((index % spots.length) + spots.length) % spots.length;
    const spot = spots[this.patientSpotIndex];
    this.patientAndRadar.patientGroup.position.set(spot.x, 0, spot.z);
    this.engine.state.patientRoomX = spot.x;
    this.engine.state.patientRoomZ = spot.z;
    this.engine.state.presenceDetected = false;
    this.engine.state.presenceMemoryAgeSec = 0;
    this.engine.state.patientDetectedOnce = false;
    if (this.onPresenceChange) this.onPresenceChange(false);
  }

  relocatePatient() {
    // Elegir el punto más lejano al jugador (para que haya que volver a buscarla)
    const spots = ROOM.patientSpots;
    let best = -1;
    let bestDist = -1;
    spots.forEach((spot, i) => {
      if (i === this.patientSpotIndex) return;
      const d = Math.hypot(spot.x - this.player.x, spot.z - this.player.z);
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best >= 0) this.placePatient(best);
    return this.patientSpotIndex;
  }

  setPatientWander(active) {
    this.patientWander = active;
    this._wanderTimer = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Actualización                                                       */
  /* ------------------------------------------------------------------ */

  update(dt, elapsedSec, ctx = {}) {
    const { renderer, camera, controls, xrCamera } = ctx;
    const s = this.engine.state;
    const isXr = renderer && renderer.xr && renderer.xr.isPresenting;

    const prevX = this.player.x;
    const prevZ = this.player.z;

    if (isXr && xrCamera) {
      this._updateFromXrHead(xrCamera, dt);
    } else {
      this._updateFromInput(dt, camera, controls);
    }

    // Desplazamiento efectivo → distancia, pasos, cadencia
    const dx = this.player.x - prevX;
    const dz = this.player.z - prevZ;
    const moved = Math.hypot(dx, dz);
    this.player.distanceM += moved;

    this.player.speed += (Math.min(moved / Math.max(dt, 0.0001), 3.2) - this.player.speed) * Math.min(1, dt * 6);
    const walking = this.player.speed > 0.12;
    s.walking = walking;
    s.walkSpeedMps = this.player.speed;

    const cycleDur = Math.max(0.55, Math.min(2.4, this.player.strideM / Math.max(0.3, this.player.speed)));
    if (walking) {
      const prevPhase = this.gaitPhase;
      this.gaitPhase = (this.gaitPhase + dt / cycleDur) % 1;
      // Un paso por ciclo: el bastón toca el suelo al entrar en fase de apoyo (0.34)
      if (prevPhase < 0.34 && this.gaitPhase >= 0.34) {
        this.player.steps += 1;
        this.onFootstep(Math.min(1, 0.35 + this.player.speed / 2));
      }
      this.player.cadenceSpm = (this.player.speed / this.player.strideM) * 60;
    } else {
      this.player.cadenceSpm += (0 - this.player.cadenceSpm) * Math.min(1, dt * 3);
    }

    // Motor biomecánico: genera la carga del bastón durante la marcha
    s.walkSpeedMps = this.player.speed;
    s.playerX = this.player.x;
    s.playerZ = this.player.z;
    s.playerHeadingRad = this.player.heading;
    s.stepsCount = this.player.steps;
    s.distanceWalkedM = this.player.distanceM;
    s.cadenceSpm = this.player.cadenceSpm;
    s.walking = walking;
    if (!s.isGrabbed) {
      s.gaitAutoEnabled = walking;
    }

    // Rastro de la ruta
    const last = this.trail[this.trail.length - 1];
    if (Math.hypot(this.player.x - last.x, this.player.z - last.z) > 0.07) {
      this.trail.push({ x: this.player.x, z: this.player.z });
      if (this.trail.length > 420) this.trail.shift();
    }

    // Persona: orientación hacia el bastón + deambular opcional
    this._updatePatient(dt, elapsedSec);

    // Última posición conocida por el radar (para el mapa)
    if (s.presenceDetected) {
      this.lastKnownPatient.x = this.patientAndRadar.patientGroup.position.x;
      this.lastKnownPatient.z = this.patientAndRadar.patientGroup.position.z;
    }

    // Marcador del jugador
    this.playerMarker.position.set(this.player.x, 0, this.player.z);
    this.playerMarker.rotation.y = this.player.heading;
    const pulse = 1 + 0.05 * Math.sin(elapsedSec * 4);
    this.playerRing.scale.setScalar(pulse);

    // Posicionar el bastón (congelado si está caído)
    this._placeCane(dt, elapsedSec, s);
  }

  _updateFromInput(dt, camera, controls) {
    let ix = this.joystick.x;
    let iy = this.joystick.y;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;

    // Marcha automática: patrulla la habitación mirando al frente y gira si choca
    if (this.autoWalk && Math.hypot(ix, iy) < 0.6) {
      const fx = Math.cos(this.player.heading);
      const fz = -Math.sin(this.player.heading);
      const stepLen = 0.92 * dt;
      const beforeX = this.player.x;
      const beforeZ = this.player.z;

      this.player.x += fx * stepLen;
      this.player.z += fz * stepLen;
      this._resolveRoomCollisions();

      const travelled = Math.hypot(this.player.x - beforeX, this.player.z - beforeZ);
      if (travelled < stepLen * 0.4) {
        this.player.x = beforeX;
        this.player.z = beforeZ;
        // Al chocar, gira hacia el centro de la habitación con algo de aleatoriedad
        const toCenter = Math.atan2(this.player.z, -this.player.x);
        this.player.heading = toCenter + (Math.random() - 0.5) * 1.1;
      }
      return;
    }

    const mag = Math.hypot(ix, iy);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const targetSpeed = Math.min(1, mag) * (running ? RUN_SPEED : WALK_SPEED);

    // Dirección relativa a la cámara
    let camForward = this._tmpForward.set(1, 0, 0);
    if (camera && controls) {
      camForward.copy(controls.target).sub(camera.position);
      camForward.y = 0;
      if (camForward.lengthSq() < 1e-6) camForward.set(1, 0, 0);
      camForward.normalize();
    }

    const camRight = this._tmpRight.set(-camForward.z, 0, camForward.x);

    let moveX = 0;
    let moveZ = 0;
    if (mag > 0.05) {
      const nx = ix / mag;
      const ny = iy / mag;
      moveX = camForward.x * ny + camRight.x * nx;
      moveZ = camForward.z * ny + camRight.z * nx;
      const len = Math.hypot(moveX, moveZ) || 1;
      moveX /= len;
      moveZ /= len;

      const targetHeading = Math.atan2(-moveZ, moveX);
      this.player.heading = lerpAngle(this.player.heading, targetHeading, Math.min(1, dt * 9));
    } else if (!this.autoWalk) {
      // Quieto: el bastón apunta hacia donde mira la cámara
      const targetHeading = Math.atan2(-camForward.z, camForward.x);
      this.player.heading = lerpAngle(this.player.heading, targetHeading, Math.min(1, dt * 2.2));
    }

    if (mag > 0.05) {
      this.player.x += moveX * targetSpeed * dt;
      this.player.z += moveZ * targetSpeed * dt;
      this._resolveRoomCollisions();
    }
  }

  _updateFromXrHead(xrCamera, dt) {
    // En Meta Quest: la posición real de la cabeza dentro de la habitación mueve al peatón
    const headWorld = xrCamera.getWorldPosition(new THREE.Vector3());
    const localHead = this.parent.worldToLocal(headWorld.clone());

    const targetX = THREE.MathUtils.clamp(localHead.x, -ROOM.width / 2 + ROOM.margin, ROOM.width / 2 - ROOM.margin);
    const targetZ = THREE.MathUtils.clamp(localHead.z, -ROOM.depth / 2 + ROOM.margin, ROOM.depth / 2 - ROOM.margin);

    const k = Math.min(1, dt * 12);
    this.player.x += (targetX - this.player.x) * k;
    this.player.z += (targetZ - this.player.z) * k;

    // Orientación: hacia dónde mira el visor
    const dirWorld = xrCamera.getWorldDirection(new THREE.Vector3());
    const parentQuat = new THREE.Quaternion();
    this.parent.getWorldQuaternion(parentQuat);
    const localDir = dirWorld.applyQuaternion(parentQuat.invert());

    if (Math.hypot(localDir.x, localDir.z) > 1e-4) {
      const targetHeading = Math.atan2(-localDir.z, localDir.x);
      this.player.heading = lerpAngle(this.player.heading, targetHeading, Math.min(1, dt * 6));
    }
  }

  _resolveRoomCollisions() {
    const halfW = ROOM.width / 2 - ROOM.margin;
    const halfD = ROOM.depth / 2 - ROOM.margin;
    this.player.x = THREE.MathUtils.clamp(this.player.x, -halfW, halfW);
    this.player.z = THREE.MathUtils.clamp(this.player.z, -halfD, halfD);

    // Colisión simple (AABB expandida) con el mobiliario
    const r = 0.22;
    ROOM.furniture.forEach((f) => {
      const minX = f.x - f.w / 2 - r;
      const maxX = f.x + f.w / 2 + r;
      const minZ = f.z - f.d / 2 - r;
      const maxZ = f.z + f.d / 2 + r;
      const p = this.player;
      if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
        const dl = p.x - minX;
        const dr = maxX - p.x;
        const dn = p.z - minZ;
        const df = maxZ - p.z;
        const m = Math.min(dl, dr, dn, df);
        if (m === dl) p.x = minX;
        else if (m === dr) p.x = maxX;
        else if (m === dn) p.z = minZ;
        else p.z = maxZ;
      }
    });
  }

  _updatePatient(dt, elapsedSec) {
    const pg = this.patientAndRadar.patientGroup;

    if (this.patientWander) {
      this._wanderTimer += dt;
      if (this._wanderTimer > 7.5) {
        this._wanderTimer = 0;
        this.relocatePatient();
      }
    }

    // La persona mira hacia el bastón (su tórax queda enfrentado al radar)
    const canePos = this.caneModel.root.position;
    const dx = canePos.x - pg.position.x;
    const dz = canePos.z - pg.position.z;
    if (Math.hypot(dx, dz) > 0.05) {
      pg.rotation.y = Math.atan2(dx, dz);
    }
  }

  _placeCane(dt, elapsedSec, s) {
    const root = this.caneModel.root;

    if (s.isFalling || s.isFallen) {
      if (!this._fallPose) {
        this._fallPose = { x: root.position.x, y: root.position.y, z: root.position.z, ry: root.rotation.y };
      }
      root.position.set(this._fallPose.x, this._fallPose.y, this._fallPose.z);
      root.rotation.y = this._fallPose.ry;
      return;
    }
    this._fallPose = null;

    const heading = this.player.heading;
    const fx = Math.cos(heading);
    const fz = -Math.sin(heading);
    const rx = -fz;
    const rz = fx;

    const walking = s.walking;
    const phase = this.gaitPhase;
    // Elevación del bastón durante la fase de balanceo
    const swingLift = walking && phase < 0.34 ? Math.sin((phase / 0.34) * Math.PI) * 0.045 : 0;

    const offR = 0.245 + (walking ? Math.sin(elapsedSec * 2.1) * 0.008 : 0);
    const offF = 0.15;

    const targetX = this.player.x + rx * offR + fx * offF;
    const targetZ = this.player.z + rz * offR + fz * offF;

    // Si el bastón está lejos (inicio o tras recogerlo) se coloca de inmediato en la mano
    const farFromHand = Math.hypot(targetX - root.position.x, targetZ - root.position.z) > 0.7;
    const k = farFromHand ? 1 : Math.min(1, dt * 18);
    root.position.x += (targetX - root.position.x) * k;
    root.position.z += (targetZ - root.position.z) * k;
    root.position.y = 0.004 + swingLift;

    // Balanceo lateral al caminar
    const sway = walking ? Math.sin(elapsedSec * 2.6) * 0.05 : 0;
    root.rotation.y = heading + sway;
  }

  getCameraTarget(out = new THREE.Vector3()) {
    return out.set(this.player.x, 0.95, this.player.z);
  }

  getMapData() {
    return {
      player: { x: this.player.x, z: this.player.z, heading: this.player.heading },
      cane: { x: this.caneModel.root.position.x, z: this.caneModel.root.position.z },
      patient: {
        x: this.patientAndRadar.patientGroup.position.x,
        z: this.patientAndRadar.patientGroup.position.z
      },
      patientLastKnown: this.lastKnownPatient,
      trail: this.trail,
      presenceDetected: this.engine.state.presenceDetected,
      vitalsLocked: this.engine.state.radarLocked,
      patientDetectedOnce: this.engine.state.patientDetectedOnce,
      isFallen: this.engine.state.isFallen,
      stats: {
        steps: this.player.steps,
        distanceM: this.player.distanceM,
        cadenceSpm: this.player.cadenceSpm,
        speedMps: this.player.speed
      }
    };
  }
}

function lerpAngle(current, target, t) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}
