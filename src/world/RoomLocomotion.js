import * as THREE from 'three';

/**
 * RoomLocomotion — Desplazamiento del usuario (y del bastón) dentro de la habitación.
 *
 * Fuentes de movimiento soportadas:
 *  1. Teclado (WASD / flechas) + Q/E para girar.
 *  2. Joystick táctil en pantalla.
 *  3. "Caminar automático" (simulación de marcha con el bastón por una ruta guiada).
 *  4. Pasos reales detectados con el acelerómetro del teléfono (DeviceMotion).
 *  5. Meta Quest: la posición y orientación reales de la cabeza (local-floor) mueven al usuario.
 */

export const ROOM_BOUNDS = { minX: -2.6, maxX: 2.6, minZ: -2.1, maxZ: 2.1 };
const WALK_MARGIN = 0.32;
const STEP_LENGTH_M = 0.64;

export class RoomLocomotion {
  constructor({ onStep = null } = {}) {
    this.room = ROOM_BOUNDS;
    this.onStep = onStep;

    // Pose del usuario (pies) dentro de la habitación y dirección de la mirada/marcha
    this.position = new THREE.Vector3(-0.55, 0, 0.55);
    this.yaw = 1.02; // forward = (sin(yaw), 0, cos(yaw))
    this.aimYaw = this.yaw; // orientación del bastón (puede apuntar distinto al cuerpo)
    this.forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.speed = 0.62; // m/s (marcha asistida con bastón)
    this.speedNow = 0;
    this.baseSpeed = 0.62;

    this.autoWalk = false;
    this.stepMode = false;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 }; // -1..1 (x = lateral, y = adelante)

    // Ruta de rehabilitación: pasa frente a la persona monitorizada dos veces por vuelta
    this.waypoints = [
      { x: 0.05, z: 1.45 },
      { x: -1.45, z: 1.20 },
      { x: -1.55, z: -0.55 },
      { x: -0.35, z: -1.30 },
      { x: 1.20, z: -1.05 },
      { x: 0.55, z: 0.05 },
      { x: 1.05, z: 1.30 }
    ];
    this.wpIndex = 0;

    this.trail = [{ x: this.position.x, z: this.position.z, t: 0 }];
    this.distanceWalked = 0;
    this.stepCount = 0;
    this.isMoving = false;
    this.motionAvailable = false;

    this._pendingStepDist = 0;
    this._trailTimer = 0;
    this._lastStepTs = 0;
    this._lpAccel = 9.81;
    this._prevAccelDyn = 0;
    this._onMotion = this._handleMotion.bind(this);
    this._keysBound = false;
  }

  bindKeyboard(target = window) {
    if (this._keysBound) return;
    this._keysBound = true;
    const isFormField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    target.addEventListener('keydown', (e) => {
      if (isFormField(e.target)) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();
        if (this.autoWalk) this.setAutoWalk(false);
        this.keys.add(k);
      }
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    target.addEventListener('blur', () => this.keys.clear());
  }

  setStick(x, y) {
    this.stick.x = THREE.MathUtils.clamp(x, -1, 1);
    this.stick.y = THREE.MathUtils.clamp(y, -1, 1);
    if ((Math.abs(x) > 0.08 || Math.abs(y) > 0.08) && this.autoWalk) this.setAutoWalk(false);
  }

  setAutoWalk(enabled) {
    this.autoWalk = enabled;
    if (enabled) {
      // Arranca desde el punto de la ruta más cercano a la posición actual
      let best = 0;
      let bestD = Infinity;
      this.waypoints.forEach((wp, i) => {
        const d = (wp.x - this.position.x) ** 2 + (wp.z - this.position.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      this.wpIndex = best;
    }
  }

  async enableStepMode() {
    if (typeof window === 'undefined' || typeof window.DeviceMotionEvent === 'undefined') {
      return {
        ok: false,
        reason: 'Este dispositivo/navegador no expone el acelerómetro (DeviceMotion). Usa el joystick, el teclado o "Caminar".'
      };
    }
    try {
      if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
        const res = await window.DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          return { ok: false, reason: 'Permiso de movimiento denegado por el navegador.' };
        }
      }
      window.addEventListener('devicemotion', this._onMotion, { passive: true });
      this.stepMode = true;
      this.setAutoWalk(false);
      // Espera breve para comprobar si llegan muestras reales
      await new Promise((r) => setTimeout(r, 900));
      return this.motionAvailable
        ? { ok: true }
        : { ok: true, warning: 'Permiso concedido, pero aún no llegan muestras del acelerómetro. Camina con el teléfono en la mano.' };
    } catch (err) {
      return { ok: false, reason: err?.message || 'No fue posible activar el acelerómetro.' };
    }
  }

  disableStepMode() {
    window.removeEventListener('devicemotion', this._onMotion);
    this.stepMode = false;
    this._pendingStepDist = 0;
  }

  _handleMotion(event) {
    const a = event.accelerationIncludingGravity || event.acceleration;
    if (!a || (a.x === null && a.y === null && a.z === null)) return;
    this.motionAvailable = true;
    const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);

    // Filtro paso-bajo para aislar la gravedad y quedarnos con la componente dinámica del paso
    this._lpAccel += (mag - this._lpAccel) * 0.28;
    const dyn = mag - this._lpAccel;

    const now = performance.now();
    const crossedPeak = dyn > 1.55 && this._prevAccelDyn <= 1.55;
    this._prevAccelDyn = dyn;

    if (crossedPeak && now - this._lastStepTs > 290) {
      this._lastStepTs = now;
      this.stepCount += 1;
      this._pendingStepDist += STEP_LENGTH_M;
      if (this.onStep) this.onStep();
    }
  }

  get canePosition() {
    // El bastón se apoya en el suelo delante y a la derecha del usuario
    const f = this.forward;
    const r = this.right;
    return new THREE.Vector3(
      this.position.x + f.x * 0.34 + r.x * 0.15,
      0,
      this.position.z + f.z * 0.34 + r.z * 0.15
    );
  }

  get caneYaw() {
    // El haz del radar sigue la orientación del bastón (aimYaw)
    return this.aimYaw - Math.PI / 2;
  }

  clampToRoom(v) {
    v.x = THREE.MathUtils.clamp(v.x, this.room.minX + WALK_MARGIN, this.room.maxX - WALK_MARGIN);
    v.z = THREE.MathUtils.clamp(v.z, this.room.minZ + WALK_MARGIN, this.room.maxZ - WALK_MARGIN);
    return v;
  }

  /**
   * @param {number} dt segundos
   * @param {number} elapsed segundos globales
   * @param {{x:number,z:number,yaw:number}|null} xrPose pose real de la cabeza en Meta Quest
   */
  update(dt, elapsed, xrPose = null, focusPoint = null) {
    let movedX = 0;
    let movedZ = 0;
    let desiredSpeed = 0;
    let turnRate = 0;
    const prevX = this.position.x;
    const prevZ = this.position.z;

    if (xrPose) {
      // ---- Meta Quest: caminar de verdad por la habitación ----
      const target = this.clampToRoom(new THREE.Vector3(xrPose.x, 0, xrPose.z));
      const lerp = Math.min(1, dt * 9);
      movedX = (target.x - this.position.x) * lerp;
      movedZ = (target.z - this.position.z) * lerp;
      this.position.x += movedX;
      this.position.z += movedZ;
      this.yaw = xrPose.yaw;
      desiredSpeed = Math.hypot(movedX, movedZ) / Math.max(dt, 0.001);
    } else if (this.autoWalk) {
      // ---- Marcha guiada automática ----
      const wp = this.waypoints[this.wpIndex];
      const dx = wp.x - this.position.x;
      const dz = wp.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.33) {
        this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      } else {
        const desiredYaw = Math.atan2(dx, dz);
        let delta = desiredYaw - this.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.yaw += THREE.MathUtils.clamp(delta, -1.9 * dt, 1.9 * dt);
        desiredSpeed = this.baseSpeed;
      }
      movedX = Math.sin(this.yaw) * desiredSpeed * dt;
      movedZ = Math.cos(this.yaw) * desiredSpeed * dt;
      this.position.x += movedX;
      this.position.z += movedZ;
      this.clampToRoom(this.position);
    } else {
      // ---- Teclado + joystick ----
      const k = this.keys;
      const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + this.stick.y;
      const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + this.stick.x;
      turnRate = (k.has('e') || k.has('arrowright') ? -1 : 0) + (k.has('q') || k.has('arrowleft') ? 1 : 0);

      this.yaw += turnRate * 1.7 * dt;

      const magnitude = Math.min(1, Math.hypot(fwd, strafe));
      if (magnitude > 0.06) {
        desiredSpeed = this.baseSpeed * magnitude;
        // El desplazamiento del bastón también consume pasos propios
        const dirX = Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * strafe * 0.85;
        const dirZ = Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * strafe * 0.85;
        const len = Math.hypot(dirX, dirZ) || 1;
        movedX = (dirX / len) * desiredSpeed * dt;
        movedZ = (dirZ / len) * desiredSpeed * dt;

        // En modo pasos sólo avanza si llegan impactos del acelerómetro
        if (this.stepMode) {
          const stepBudget = Math.min(this._pendingStepDist, desiredSpeed * dt);
          this._pendingStepDist -= stepBudget;
          const stepFactor = stepBudget / Math.max(desiredSpeed * dt, 1e-6);
          movedX *= stepFactor;
          movedZ *= stepFactor;
        }
        this.position.x += movedX;
        this.position.z += movedZ;
        this.clampToRoom(this.position);
      }
      this.stick.x *= 0.86;
      this.stick.y *= 0.86;
      if (Math.abs(this.stick.x) < 0.02) this.stick.x = 0;
      if (Math.abs(this.stick.y) < 0.02) this.stick.y = 0;
    }

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // ---- Orientación del bastón (apuntado) ----
    // En marcha guiada el bastón se orienta hacia la persona monitorizada cuando está cerca
    // (como haría alguien que camina observando a otra persona); si no, sigue la marcha.
    let desiredAim = this.yaw;
    let aimToward = false;
    if (this.autoWalk && focusPoint) {
      const dx = focusPoint.x - this.position.x;
      const dz = focusPoint.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      const bearing = Math.atan2(dx, dz);
      let delta = bearing - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (dist < 3.6 && Math.abs(delta) < 2.0) {
        desiredAim = bearing;
        aimToward = true;
      }
    }
    let aimDelta = desiredAim - this.aimYaw;
    while (aimDelta > Math.PI) aimDelta -= Math.PI * 2;
    while (aimDelta < -Math.PI) aimDelta += Math.PI * 2;
    const aimRate = aimToward ? 2.1 : 1.4;
    this.aimYaw += THREE.MathUtils.clamp(aimDelta, -aimRate * dt, aimRate * dt);
    this.aimYaw = Math.atan2(Math.sin(this.aimYaw), Math.cos(this.aimYaw));
    this.aimingAtFocus = aimToward;

    const travelled = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.distanceWalked += travelled;
    this.speedNow = travelled / Math.max(dt, 1e-4);
    this.isMoving = this.speedNow > 0.06;

    // Rastro de la ruta recorrida
    this._trailTimer += dt;
    if (this._trailTimer > 0.12) {
      this._trailTimer = 0;
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - this.position.x, last.z - this.position.z) > 0.045) {
        this.trail.push({ x: this.position.x, z: this.position.z, t: elapsed });
        if (this.trail.length > 320) this.trail.shift();
      }
    }

    return { travelled, speed: this.speedNow, turnRate };
  }

  reset(startX = -0.55, startZ = 0.55, yaw = 1.02) {
    this.position.set(startX, 0, startZ);
    this.yaw = yaw;
    this.aimYaw = yaw;
    this.trail = [{ x: startX, z: startZ, t: 0 }];
    this.distanceWalked = 0;
    this.stepCount = 0;
    this._pendingStepDist = 0;
    this.setAutoWalk(false);
    this.keys.clear();
  }
}
