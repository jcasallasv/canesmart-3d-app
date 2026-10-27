import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';

export class MetaQuestXRManager {
  constructor({
    renderer,
    scene,
    stageGroup,
    caneModel,
    engine,
    interactiveTargetsGetter,
    onActionTriggered,
    onSessionStateChange
  }) {
    this.renderer = renderer;
    this.scene = scene;
    this.stageGroup = stageGroup;
    this.caneModel = caneModel;
    this.engine = engine;
    this.getInteractiveTargets = interactiveTargetsGetter;
    this.onActionTriggered = onActionTriggered;
    this.onSessionStateChange = onSessionStateChange || (() => {});

    this.isArSupported = false;
    this.isVrSupported = false;
    this.currentSession = null;
    this.isPassthroughActive = false;

    this.controllers = [];
    this.raycaster = new THREE.Raycaster();
    this._tempMatrix = new THREE.Matrix4();
    this._grabbingController = null;
    this._grabStartPos = new THREE.Vector3();
    this._grabStartTiltX = 0;
    this._grabStartTiltZ = 0;

    // Hit-test floor reticle for real-room placement
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this._buildReticle();
    this._setupControllersAndHands();
  }

  _buildReticle() {
    const geo = new THREE.RingGeometry(0.11, 0.145, 36);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide
    });
    this.reticle = new THREE.Mesh(geo, mat);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  _setupControllersAndHands() {
    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);

      // Laser pointer ray + holographic tip sphere (always visible even offline)
      const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1.6)
      ]);
      const rayMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.75
      });
      const rayLine = new THREE.Line(rayGeo, rayMat);
      controller.add(rayLine);

      const tipMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      controller.add(tipMesh);

      controller.userData = {
        index: i,
        rayLine,
        tipMesh,
        selecting: false,
        squeezing: false,
        inputSource: null
      };

      controller.addEventListener('connected', (e) => {
        controller.userData.inputSource = e.data;
      });
      controller.addEventListener('disconnected', () => {
        controller.userData.inputSource = null;
      });

      controller.addEventListener('selectstart', () => this._onSelectStart(controller));
      controller.addEventListener('selectend', () => this._onSelectEnd(controller));
      controller.addEventListener('squeezestart', () => this._onSqueezeStart(controller));
      controller.addEventListener('squeezeend', () => this._onSqueezeEnd(controller));

      this.scene.add(controller);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(controllerModelFactory.createControllerModel(grip));
      this.scene.add(grip);

      const hand = this.renderer.xr.getHand(i);
      hand.add(handModelFactory.createHandModel(hand, 'boxes'));
      this.scene.add(hand);

      this.controllers.push(controller);
    }
  }

  async checkSupport() {
    if (!('xr' in navigator) || !navigator.xr) {
      return { ar: false, vr: false, reason: 'WebXR no detectado en este navegador (Use Vista 3D o Webcam AR aquí, o abra este enlace en Meta Quest Browser).' };
    }
    try {
      this.isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
    } catch (_) {
      this.isArSupported = false;
    }
    try {
      this.isVrSupported = await navigator.xr.isSessionSupported('immersive-vr');
    } catch (_) {
      this.isVrSupported = false;
    }
    return { ar: this.isArSupported, vr: this.isVrSupported };
  }

  async toggleXrSession() {
    if (this.currentSession) {
      await this.currentSession.end();
      return { started: false };
    }

    if (!navigator.xr) {
      return {
        started: false,
        error: 'Este navegador de escritorio no tiene gafas Meta Quest conectadas. Puedes usar el Modo Cámara Passthrough (Webcam AR) o abrir esta misma URL directamente en Meta Quest Browser.'
      };
    }

    const mode = this.isArSupported ? 'immersive-ar' : this.isVrSupported ? 'immersive-vr' : null;
    if (!mode) {
      return {
        started: false,
        error: 'No se detectó sesión inmersiva activa. Abre este enlace en Meta Quest Browser (Quest 2 / Pro / 3 / 3S) para activar Passthrough Mixed Reality, o activa Webcam AR arriba.'
      };
    }

    const sessionInit = {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'hit-test']
    };

    try {
      const session = await navigator.xr.requestSession(mode, sessionInit);
      this.currentSession = session;
      this.isPassthroughActive = mode === 'immersive-ar';

      session.addEventListener('end', () => {
        this.currentSession = null;
        this.isPassthroughActive = false;
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
        this.reticle.visible = false;
        this._grabbingController = null;
        this.engine.state.isGrabbed = false;
        this.engine.state.interactiveGripBoostN = 0;
        this.engine.state.interactiveAxialBoostN = 0;
        this.stageGroup.position.set(0, 0, 0);
        this.onSessionStateChange(false, null);
      });

      this.renderer.xr.setReferenceSpaceType('local-floor');
      await this.renderer.xr.setSession(session);

      // Place CaneSmart comfortably 0.72 m in front of the user on their real floor
      this.stageGroup.position.set(0, 0, -0.72);
      this.onSessionStateChange(true, mode);
      return { started: true, mode };
    } catch (err) {
      return { started: false, error: err?.message || 'Error al iniciar sesión WebXR.' };
    }
  }

  _tryGrabHandle(controller) {
    const ctrlPos = new THREE.Vector3();
    controller.getWorldPosition(ctrlPos);
    const handleWorldPos = new THREE.Vector3();
    this.caneModel.handleGrabTarget.getWorldPosition(handleWorldPos);

    if (ctrlPos.distanceTo(handleWorldPos) < 0.30) {
      if (this.engine.state.isFallen) {
        this.engine.resetCane();
      }
      this._grabbingController = controller;
      this._grabStartPos.copy(ctrlPos);
      this._grabStartTiltX = this.engine.state.tiltXRad;
      this._grabStartTiltZ = this.engine.state.tiltZRad;
      this.engine.state.isGrabbed = true;
      this._pulseHaptics(controller, 0.55, 45);
      return true;
    }
    return false;
  }

  _onSelectStart(controller) {
    controller.userData.selecting = true;

    // 1. Check raycast against 3D interactive buttons / GPS card / Cane buttons / Handle
    this._tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

    const targets = this.getInteractiveTargets();
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const action = hits[0].object.userData?.interactiveAction;
      if (action === 'grab_handle') {
        this._grabbingController = controller;
        controller.getWorldPosition(this._grabStartPos);
        this._grabStartTiltX = this.engine.state.tiltXRad;
        this._grabStartTiltZ = this.engine.state.tiltZRad;
        this.engine.state.isGrabbed = true;
        this._pulseHaptics(controller, 0.5, 40);
        return;
      }
      if (action) {
        this.onActionTriggered(action);
        this._pulseHaptics(controller, 0.65, 50);
        return;
      }
    }

    // 2. Proximity grab check
    if (this._tryGrabHandle(controller)) return;

    // 3. If floor reticle is visible, teleport/anchor CaneSmart to that real-room floor spot!
    if (this.reticle.visible) {
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(this.reticle.matrix);
      this.stageGroup.position.copy(pos);
      this._pulseHaptics(controller, 0.4, 35);
    }
  }

  _onSelectEnd(controller) {
    controller.userData.selecting = false;
    if (this._grabbingController === controller && !controller.userData.squeezing) {
      this._releaseGrab();
    }
  }

  _onSqueezeStart(controller) {
    controller.userData.squeezing = true;
    this._tryGrabHandle(controller);
  }

  _onSqueezeEnd(controller) {
    controller.userData.squeezing = false;
    if (this._grabbingController === controller && !controller.userData.selecting) {
      this._releaseGrab();
    }
  }

  _releaseGrab() {
    this._grabbingController = null;
    this.engine.state.isGrabbed = false;
    this.engine.state.interactiveGripBoostN = 0;
    this.engine.state.interactiveAxialBoostN = 0;
  }

  _pulseHaptics(controller, intensity = 0.5, durationMs = 40) {
    const gp = controller?.userData?.inputSource?.gamepad;
    const actuator = gp?.hapticActuators?.[0];
    if (actuator && typeof actuator.pulse === 'function') {
      actuator.pulse(Math.min(1, Math.max(0.05, intensity)), durationMs).catch(() => {});
    }
  }

  update(frame) {
    if (!this.renderer.xr.isPresenting) return;

    const session = this.renderer.xr.getSession();
    if (frame && session) {
      // Request hit-test source once for real physical floor anchoring on Meta Quest
      if (!this.hitTestSourceRequested && session.requestHitTestSource) {
        this.hitTestSourceRequested = true;
        session
          .requestReferenceSpace('viewer')
          .then((viewerSpace) => session.requestHitTestSource({ space: viewerSpace }))
          .then((source) => {
            this.hitTestSource = source;
          })
          .catch(() => {});
      }

      if (this.hitTestSource) {
        const refSpace = this.renderer.xr.getReferenceSpace();
        const hitResults = frame.getHitTestResults(this.hitTestSource);
        if (hitResults.length > 0 && !this._grabbingController) {
          const hit = hitResults[0];
          const pose = hit.getPose(refSpace);
          if (pose) {
            this.reticle.visible = true;
            this.reticle.matrix.fromArray(pose.transform.matrix);
          }
        } else {
          this.reticle.visible = false;
        }
      }
    }

    // Process physical controller manipulation & analog grip/axial pressure
    if (this._grabbingController) {
      const ctrl = this._grabbingController;
      const curPos = new THREE.Vector3();
      ctrl.getWorldPosition(curPos);

      const dx = curPos.x - this._grabStartPos.x;
      const dy = curPos.y - this._grabStartPos.y;
      const dz = curPos.z - this._grabStartPos.z;

      // Horizontal displacement tilts the cane around its floor base (L = 0.85 m)
      this.engine.state.targetTiltXRad = Math.max(-1.25, Math.min(1.25, this._grabStartTiltX + dx / 0.72));
      this.engine.state.targetTiltZRad = Math.max(-1.25, Math.min(1.25, this._grabStartTiltZ + dz / 0.72));

      // Analog buttons on Meta Quest Touch Controller:
      // buttons[0] = Index Trigger (0..1), buttons[1] = Middle Finger Squeeze Grip (0..1)
      const gp = ctrl.userData.inputSource?.gamepad;
      const triggerVal = gp?.buttons?.[0]?.value || (ctrl.userData.selecting ? 0.65 : 0);
      const gripVal = gp?.buttons?.[1]?.value || (ctrl.userData.squeezing ? 0.75 : 0);

      // Downward push (-dy) + analog squeeze drives FSR Grip + Axial Load Cell!
      const pushDownN = Math.max(0, -dy * 1650);
      const analogGripN = (gripVal * 0.65 + triggerVal * 0.45) * 115;
      const analogAxialN = pushDownN + triggerVal * 230 + gripVal * 95;

      this.engine.state.interactiveGripBoostN = analogGripN;
      this.engine.state.interactiveAxialBoostN = analogAxialN;

      // Continuous subtle haptic resistance proportional to force
      const forceNorm = Math.min(1, (analogAxialN + analogGripN) / 380);
      if (forceNorm > 0.18) {
        this._pulseHaptics(ctrl, forceNorm * 0.45, 22);
      }
    }
  }
}
