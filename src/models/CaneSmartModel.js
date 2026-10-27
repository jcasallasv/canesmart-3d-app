import * as THREE from 'three';
import { applyThermalToThreeColor, thermalCSS, thermalRGB } from '../utils/heatmap.js';

/**
 * 1:1 Metric 3D Digital Twin of CaneSmart (0.88 m height)
 * Faithfully modeled from the attached CaneSmart Meta.jpg technical drawing:
 * - Curved 5-segment ribbed crook handle + double transition collars
 * - Central T-saddle + upward-swept anterior smart nose
 * - Recessed lateral OLED telemetry window + beveled 60GHz mmWave radome cap
 * - Dual upper-shaft oval tactile buttons
 * - Axial strain-gauge load cell collar + 4-legged articulated rubber quad-pod base
 */
export class CaneSmartModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'CaneSmartRoot';

    // Pivot at ground level so tilting & falling rotate naturally around floor contact
    this.tiltPivot = new THREE.Group();
    this.tiltPivot.position.set(0, 0.012, 0);
    this.root.add(this.tiltPivot);

    // Axial elastic compression group (deflects slightly under heavy vertical load)
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.set(0, -0.012, 0);
    this.tiltPivot.add(this.bodyGroup);

    // Interactive raycast targets
    this.interactiveMeshes = [];
    this.handleGrabTarget = null;
    this.fsrMeshes = []; // 6 FSR sensor zones
    this.footAssemblies = []; // 4 articulated feet + floor pressure rings
    this.radomeSocket = new THREE.Object3D();
    this.piezoSocket = new THREE.Object3D();

    this.heatmapVisible = true;
    this._oledLastUpdate = 0;

    this._initMaterials();
    this._buildQuadBaseAndLoadCell();
    this._buildShaftAndButtons();
    this._buildSmartHandle();
    this._buildForceVectors();
  }

  _initMaterials() {
    this.shaftMat = new THREE.MeshStandardMaterial({
      color: 0xe6edf5,
      metalness: 0.58,
      roughness: 0.26
    });

    this.collarMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.72,
      roughness: 0.24
    });

    this.darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.35,
      roughness: 0.55
    });

    this.rubberMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      metalness: 0.08,
      roughness: 0.82
    });

    this.baseShellMat = new THREE.MeshStandardMaterial({
      color: 0xd8e2ec,
      metalness: 0.35,
      roughness: 0.34
    });

    this.loadCellMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      emissive: 0x0f172a,
      emissiveIntensity: 0.45,
      metalness: 0.45,
      roughness: 0.28
    });

    this.radomeMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      emissive: 0x00bcd4,
      emissiveIntensity: 0.42,
      metalness: 0.2,
      roughness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1
    });

    // Dynamic lateral OLED screen texture
    this.oledCanvas = document.createElement('canvas');
    this.oledCanvas.width = 256;
    this.oledCanvas.height = 96;
    this.oledCtx = this.oledCanvas.getContext('2d');
    this.oledTexture = new THREE.CanvasTexture(this.oledCanvas);
    this.oledTexture.colorSpace = THREE.SRGBColorSpace;

    this.oledMat = new THREE.MeshBasicMaterial({
      map: this.oledTexture
    });
  }

  _buildQuadBaseAndLoadCell() {
    const baseGroup = new THREE.Group();
    baseGroup.name = 'QuadBaseAndLoadCell';
    this.bodyGroup.add(baseGroup);

    // Central molded star hub skirt (flares smoothly from r=0.026 at y=0.078 down to r=0.056 at y=0.048)
    const hubPoints = [
      new THREE.Vector2(0.018, 0.042),
      new THREE.Vector2(0.056, 0.046),
      new THREE.Vector2(0.052, 0.062),
      new THREE.Vector2(0.032, 0.075),
      new THREE.Vector2(0.025, 0.082)
    ];
    const hubGeo = new THREE.LatheGeometry(hubPoints, 36);
    const hubMesh = new THREE.Mesh(hubGeo, this.baseShellMat);
    hubMesh.castShadow = true;
    hubMesh.receiveShadow = true;
    baseGroup.add(hubMesh);

    // Axial Strain-Gauge Load Cell Housing (y = 0.076 .. 0.106 m)
    const lcBodyGeo = new THREE.CylinderGeometry(0.0235, 0.0265, 0.028, 36);
    this.loadCellMesh = new THREE.Mesh(lcBodyGeo, this.loadCellMat);
    this.loadCellMesh.position.set(0, 0.091, 0);
    this.loadCellMesh.castShadow = true;
    this.loadCellMesh.userData = { type: 'sensor_zone', zoneName: 'Celda de Carga Axial (HX711)' };
    baseGroup.add(this.loadCellMesh);

    // Load cell machined rings (top & bottom ferrules)
    const ferruleGeo = new THREE.TorusGeometry(0.024, 0.0028, 14, 36);
    const topFerrule = new THREE.Mesh(ferruleGeo, this.collarMat);
    topFerrule.rotation.x = Math.PI / 2;
    topFerrule.position.y = 0.105;
    baseGroup.add(topFerrule);

    const botFerrule = new THREE.Mesh(ferruleGeo, this.collarMat);
    botFerrule.rotation.x = Math.PI / 2;
    botFerrule.scale.set(1.08, 1.08, 1);
    botFerrule.position.y = 0.077;
    baseGroup.add(botFerrule);

    // Translucent holographic thermal halo around Load Cell
    const lcHaloGeo = new THREE.CylinderGeometry(0.033, 0.036, 0.030, 32, 1, true);
    this.lcHaloMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.lcHaloMesh = new THREE.Mesh(lcHaloGeo, this.lcHaloMat);
    this.lcHaloMesh.position.set(0, 0.091, 0);
    baseGroup.add(this.lcHaloMesh);

    // 4 Radial Sculpted Quad-Pod Legs (+X Right, -X Left, +Z Front, -Z Back — matches CaneSmart Meta.jpg!)
    const footDefs = [
      { id: 'right', label: 'Apoyo Derecho (+X)', angle: 0, dx: 0.122, dz: 0 },
      { id: 'front', label: 'Apoyo Frontal (+Z)', angle: Math.PI / 2, dx: 0, dz: 0.122 },
      { id: 'left',  label: 'Apoyo Izquierdo (-X)', angle: Math.PI, dx: -0.122, dz: 0 },
      { id: 'back',  label: 'Apoyo Trasero (-Z)', angle: -Math.PI / 2, dx: 0, dz: -0.122 }
    ];

    footDefs.forEach((def) => {
      const armCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.018 * Math.cos(def.angle), 0.066, 0.018 * Math.sin(def.angle)),
        new THREE.Vector3(0.062 * Math.cos(def.angle), 0.060, 0.062 * Math.sin(def.angle)),
        new THREE.Vector3(0.104 * Math.cos(def.angle), 0.055, 0.104 * Math.sin(def.angle)),
        new THREE.Vector3(0.122 * Math.cos(def.angle), 0.050, 0.122 * Math.sin(def.angle))
      ]);
      const armGeo = new THREE.TubeGeometry(armCurve, 20, 0.0135, 16, false);
      armGeo.scale(1, 0.72, 1); // Flattened organic profile matching drawing
      const armMesh = new THREE.Mesh(armGeo, this.baseShellMat);
      armMesh.position.y = 0.015;
      armMesh.castShadow = true;
      armMesh.receiveShadow = true;
      baseGroup.add(armMesh);

      // End cap dome at each leg tip (r=0.022)
      const capGeo = new THREE.CylinderGeometry(0.021, 0.022, 0.014, 24);
      const capMesh = new THREE.Mesh(capGeo, this.baseShellMat);
      capMesh.position.set(def.dx, 0.048, def.dz);
      capMesh.castShadow = true;
      baseGroup.add(capMesh);

      // Articulated foot sub-group (compresses individually under tilt load)
      const footGroup = new THREE.Group();
      footGroup.position.set(def.dx, 0, def.dz);
      baseGroup.add(footGroup);

      // Narrow ball-joint neck stem (visible in CaneSmart Meta.jpg between leg & rubber pad!)
      const stemGeo = new THREE.CylinderGeometry(0.0068, 0.0078, 0.018, 16);
      const stemMesh = new THREE.Mesh(stemGeo, this.collarMat);
      stemMesh.position.y = 0.033;
      footGroup.add(stemMesh);

      // Upper rubber flange disc
      const upperPadGeo = new THREE.CylinderGeometry(0.019, 0.021, 0.007, 24);
      const upperPad = new THREE.Mesh(upperPadGeo, this.darkTrimMat);
      upperPad.position.y = 0.021;
      footGroup.add(upperPad);

      // Main thick cylindrical anti-slip rubber tip (with thermal tint material per foot)
      const footPadMat = this.rubberMat.clone();
      const padGeo = new THREE.CylinderGeometry(0.0225, 0.0215, 0.017, 24);
      const padMesh = new THREE.Mesh(padGeo, footPadMat);
      padMesh.position.y = 0.0085;
      padMesh.castShadow = true;
      footGroup.add(padMesh);

      // Floor Force-Plate Pressure Halo Ring (stays at floor level under each foot)
      const ringGeo = new THREE.RingGeometry(0.016, 0.042, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.set(def.dx, 0.002, def.dz);
      this.tiltPivot.parent.add(ringMesh); // Anchored on floor plane in root space

      this.footAssemblies.push({
        id: def.id,
        label: def.label,
        dx: def.dx,
        dz: def.dz,
        footGroup,
        padMat: footPadMat,
        floorRing: ringMesh,
        floorRingMat: ringMat
      });
    });
  }

  _buildShaftAndButtons() {
    // Main vertical tubular shaft (y = 0.105 .. 0.775 m, radius = 0.0195 m)
    const shaftHeight = 0.670;
    const shaftGeo = new THREE.CylinderGeometry(0.0192, 0.0198, shaftHeight, 36);
    const shaftMesh = new THREE.Mesh(shaftGeo, this.shaftMat);
    shaftMesh.position.set(0, 0.105 + shaftHeight / 2, 0);
    shaftMesh.castShadow = true;
    shaftMesh.receiveShadow = true;
    this.bodyGroup.add(shaftMesh);

    // Upper neck collar ring (y = 0.774 m, right below handle T-joint as in drawing)
    const neckRingGeo = new THREE.CylinderGeometry(0.0222, 0.0212, 0.014, 36);
    const neckRing = new THREE.Mesh(neckRingGeo, this.collarMat);
    neckRing.position.set(0, 0.774, 0);
    this.bodyGroup.add(neckRing);

    const grooveGeo = new THREE.TorusGeometry(0.0202, 0.0014, 12, 36);
    const groove1 = new THREE.Mesh(grooveGeo, this.darkTrimMat);
    groove1.rotation.x = Math.PI / 2;
    groove1.position.y = 0.767;
    this.bodyGroup.add(groove1);

    // Two stacked horizontal stadium/pill buttons on the upper shaft (y = 0.746 and y = 0.724)
    const btnConfigs = [
      { y: 0.747, action: 'toggle_radar_focus', label: 'Botón Superior: Modo Radar 60GHz', color: 0x06b6d4 },
      { y: 0.724, action: 'trigger_manual_sos', label: 'Botón Inferior: Test SOS / Alerta Caída', color: 0xf43f5e }
    ];

    btnConfigs.forEach((cfg) => {
      const btnGeo = new THREE.CapsuleGeometry(0.0052, 0.012, 8, 16);
      btnGeo.rotateZ(Math.PI / 2);
      const btnMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        emissive: cfg.color,
        emissiveIntensity: 0.45,
        metalness: 0.3,
        roughness: 0.35
      });

      // Front (+Z) button matching drawing view
      const btnFront = new THREE.Mesh(btnGeo, btnMat);
      btnFront.position.set(0, cfg.y, 0.0175);
      btnFront.userData = { interactiveAction: cfg.action, label: cfg.label };
      this.bodyGroup.add(btnFront);
      this.interactiveMeshes.push(btnFront);
    });
  }

  _buildSmartHandle() {
    this.handleGroup = new THREE.Group();
    this.handleGroup.name = 'ErgonomicSmartHandle';
    this.bodyGroup.add(this.handleGroup);

    // Helper to create an FSR-instrumented mesh segment
    const makeFsrMat = () =>
      new THREE.MeshStandardMaterial({
        color: 0xdbe4ef,
        emissive: 0x0f172a,
        emissiveIntensity: 0.25,
        metalness: 0.18,
        roughness: 0.44
      });

    // --- FSR ZONE 5: Central T-Saddle & Palmar Bridge (x = -0.062 .. +0.032, y = 0.780 .. 0.846) ---
    const neckGeo = new THREE.CylinderGeometry(0.028, 0.0215, 0.056, 32);
    const fsr5Mat = makeFsrMat();
    const neckMesh = new THREE.Mesh(neckGeo, fsr5Mat);
    neckMesh.position.set(0, 0.808, 0);
    neckMesh.castShadow = true;
    this.handleGroup.add(neckMesh);

    const saddleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.064, 0.845, 0),
      new THREE.Vector3(-0.018, 0.843, 0),
      new THREE.Vector3(0.032, 0.845, 0)
    ]);
    const saddleGeo = new THREE.TubeGeometry(saddleCurve, 24, 0.029, 24, false);
    saddleGeo.scale(1, 0.96, 0.82);
    const saddleMesh = new THREE.Mesh(saddleGeo, fsr5Mat);
    saddleMesh.castShadow = true;
    this.handleGroup.add(saddleMesh);

    // --- FSR ZONE 6: Anterior Smart Nose / Index-Thumb Rest (x = +0.030 .. +0.136, y = 0.845 .. 0.851) ---
    const fsr6Mat = makeFsrMat();
    const noseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.028, 0.845, 0),
      new THREE.Vector3(0.082, 0.848, 0),
      new THREE.Vector3(0.136, 0.850, 0)
    ]);
    const noseGeo = new THREE.TubeGeometry(noseCurve, 24, 0.0285, 24, false);
    noseGeo.scale(1, 0.98, 0.82);
    const noseMesh = new THREE.Mesh(noseGeo, fsr6Mat);
    noseMesh.castShadow = true;
    this.handleGroup.add(noseMesh);

    // Beveled Front 60GHz mmWave Radome End-Cap (x = +0.136 .. +0.152 m, matching right tip of drawing!)
    const seamRingGeo = new THREE.TorusGeometry(0.0265, 0.0018, 12, 32);
    seamRingGeo.rotateY(Math.PI / 2);
    seamRingGeo.scale(1, 0.98, 0.82);
    const seamRing = new THREE.Mesh(seamRingGeo, this.darkTrimMat);
    seamRing.position.set(0.136, 0.850, 0);
    this.handleGroup.add(seamRing);

    const radomeCapGeo = new THREE.SphereGeometry(0.0282, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.52);
    radomeCapGeo.rotateZ(-Math.PI / 2);
    radomeCapGeo.scale(0.58, 0.97, 0.81);
    this.radomeMesh = new THREE.Mesh(radomeCapGeo, this.radomeMat);
    this.radomeMesh.position.set(0.136, 0.850, 0);
    this.handleGroup.add(this.radomeMesh);

    // Radome world socket pointing strictly forward (+X of cane handle)
    this.radomeSocket.position.set(0.152, 0.850, 0);
    this.handleGroup.add(this.radomeSocket);

    // Piezo buzzer audio socket in the handle nose
    this.piezoSocket.position.set(0.09, 0.848, 0);
    this.handleGroup.add(this.piezoSocket);

    // Lateral Recessed OLED Display Window (+Z and -Z faces at x = +0.088, y = 0.848)
    const bezelGeo = new THREE.BoxGeometry(0.046, 0.018, 0.049);
    const bezelMesh = new THREE.Mesh(bezelGeo, this.darkTrimMat);
    bezelMesh.position.set(0.088, 0.848, 0);
    this.handleGroup.add(bezelMesh);

    const screenGeo = new THREE.PlaneGeometry(0.041, 0.014);
    const screenFront = new THREE.Mesh(screenGeo, this.oledMat);
    screenFront.position.set(0.088, 0.848, 0.0248);
    this.handleGroup.add(screenFront);

    const screenBack = new THREE.Mesh(screenGeo, this.oledMat);
    screenBack.rotation.y = Math.PI;
    screenBack.position.set(0.088, 0.848, -0.0248);
    this.handleGroup.add(screenBack);

    // Double Transition Collar Rings on left of T-Saddle (x = -0.068 and x = -0.084, matching drawing!)
    [-0.066, -0.082].forEach((rx) => {
      const collarCyl = new THREE.CylinderGeometry(0.0298, 0.0298, 0.012, 28);
      collarCyl.rotateZ(Math.PI / 2);
      collarCyl.scale(1, 0.96, 0.83);
      const cMesh = new THREE.Mesh(collarCyl, this.collarMat);
      cMesh.position.set(rx, 0.845, 0);
      this.handleGroup.add(cMesh);

      const groove = new THREE.TorusGeometry(0.0295, 0.0016, 10, 28);
      groove.rotateY(Math.PI / 2);
      groove.scale(1, 0.96, 0.83);
      const gMesh = new THREE.Mesh(groove, this.darkTrimMat);
      gMesh.position.set(rx - 0.006, 0.845, 0);
      this.handleGroup.add(gMesh);
    });

    // --- Curved Shepherd/Derby Crook Spine (5 ribbed segments -> FSR-4 down to FSR-1) ---
    const crookSpine = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.089, 0.845, 0),
      new THREE.Vector3(-0.135, 0.843, 0),
      new THREE.Vector3(-0.178, 0.824, 0),
      new THREE.Vector3(-0.199, 0.788, 0),
      new THREE.Vector3(-0.192, 0.751, 0),
      new THREE.Vector3(-0.162, 0.735, 0),
      new THREE.Vector3(-0.144, 0.742, 0)
    ]);

    const segmentRanges = [
      { t0: 0.00, t1: 0.24, fsrIndex: 3, name: 'FSR-4 Arco Superior' },
      { t0: 0.24, t1: 0.48, fsrIndex: 2, name: 'FSR-3 Curva Dorsal' },
      { t0: 0.48, t1: 0.74, fsrIndex: 1, name: 'FSR-2 Gancho Medio' },
      { t0: 0.74, t1: 1.00, fsrIndex: 0, name: 'FSR-1 Punta Gancho' }
    ];

    const crookMats = [makeFsrMat(), makeFsrMat(), makeFsrMat(), makeFsrMat()];

    segmentRanges.forEach((seg) => {
      const pts = [];
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const u = seg.t0 + (seg.t1 - seg.t0) * (i / steps);
        pts.push(crookSpine.getPoint(u));
      }
      const subCurve = new THREE.CatmullRomCurve3(pts);
      const radius = seg.fsrIndex === 0 ? 0.0255 : 0.0278;
      const segGeo = new THREE.TubeGeometry(subCurve, 18, radius, 22, false);
      segGeo.scale(1, 1, 0.84);
      const segMesh = new THREE.Mesh(segGeo, crookMats[seg.fsrIndex]);
      segMesh.castShadow = true;
      this.handleGroup.add(segMesh);

      // Rib groove separator ring at t1 (matching the radial segment lines in CaneSmart Meta.jpg!)
      if (seg.t1 < 0.99) {
        const p = crookSpine.getPoint(seg.t1);
        const tangent = crookSpine.getTangent(seg.t1).normalize();
        const ribGeo = new THREE.TorusGeometry(0.0272, 0.0018, 10, 24);
        ribGeo.scale(1, 0.84, 1);
        const ribMesh = new THREE.Mesh(ribGeo, this.darkTrimMat);
        ribMesh.position.copy(p);
        ribMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
        this.handleGroup.add(ribMesh);
      }
    });

    // Rounded bulbous tip cap at the end of the curved hook (FSR-1)
    const tipPoint = crookSpine.getPoint(1.0);
    const tipCapGeo = new THREE.SphereGeometry(0.0252, 22, 18);
    tipCapGeo.scale(1, 1, 0.84);
    const tipCap = new THREE.Mesh(tipCapGeo, crookMats[0]);
    tipCap.position.copy(tipPoint);
    this.handleGroup.add(tipCap);

    // Store ordered 6 FSR Zone materials:
    // [0]: FSR-1 Hook Tip, [1]: FSR-2 Lower Hook, [2]: FSR-3 Mid Hook,
    // [3]: FSR-4 Upper Hook, [4]: FSR-5 Central Palm T-Saddle, [5]: FSR-6 Anterior Finger Nose
    this.fsrZones = [
      { id: 'FSR-1', name: 'Punta Gancho', mat: crookMats[0] },
      { id: 'FSR-2', name: 'Arco Inferior', mat: crookMats[1] },
      { id: 'FSR-3', name: 'Curva Media', mat: crookMats[2] },
      { id: 'FSR-4', name: 'Arco Palmar Post.', mat: crookMats[3] },
      { id: 'FSR-5', name: 'Silla Palmar Central', mat: fsr5Mat },
      { id: 'FSR-6', name: 'Apoyo Índice/Pulgar', mat: fsr6Mat }
    ];

    // Translucent thermal aura shell around handle for high-visibility biomechanical heatmap in MR
    const auraCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.150, 0.742, 0),
      new THREE.Vector3(-0.198, 0.785, 0),
      new THREE.Vector3(-0.150, 0.842, 0),
      new THREE.Vector3(-0.020, 0.845, 0),
      new THREE.Vector3(0.125, 0.850, 0)
    ]);
    const auraGeo = new THREE.TubeGeometry(auraCurve, 36, 0.0345, 18, false);
    auraGeo.scale(1, 1, 0.88);
    const posAttr = auraGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    auraGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.handleAuraGeo = auraGeo;
    this.handleAuraMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.handleAuraMesh = new THREE.Mesh(auraGeo, this.handleAuraMat);
    this.handleGroup.add(this.handleAuraMesh);

    // Invisible ergonomic bounding collider for easy mouse & Quest controller grabbing
    const grabGeo = new THREE.BoxGeometry(0.42, 0.19, 0.12);
    const grabMat = new THREE.MeshBasicMaterial({ visible: false });
    this.handleGrabTarget = new THREE.Mesh(grabGeo, grabMat);
    this.handleGrabTarget.position.set(-0.04, 0.815, 0);
    this.handleGrabTarget.userData = { interactiveAction: 'grab_handle', label: 'Empuñadura Inteligente CaneSmart' };
    this.handleGroup.add(this.handleGrabTarget);
    this.interactiveMeshes.push(this.handleGrabTarget);
  }

  _buildForceVectors() {
    // 3D Ground Reaction Force (GRF) Vector Arrow rising from the dynamic Center of Pressure (CoP)
    this.grfGroup = new THREE.Group();
    this.root.add(this.grfGroup);

    const shaftGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 12);
    shaftGeo.translate(0, 0.5, 0);
    this.grfMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.85
    });
    this.grfShaft = new THREE.Mesh(shaftGeo, this.grfMat);
    this.grfGroup.add(this.grfShaft);

    const coneGeo = new THREE.ConeGeometry(0.014, 0.036, 16);
    coneGeo.translate(0, 0.018, 0);
    this.grfCone = new THREE.Mesh(coneGeo, this.grfMat);
    this.grfGroup.add(this.grfCone);

    // CoP floor bullseye marker
    const copGeo = new THREE.RingGeometry(0.005, 0.015, 24);
    copGeo.rotateX(-Math.PI / 2);
    this.copMarker = new THREE.Mesh(copGeo, this.grfMat);
    this.copMarker.position.y = 0.003;
    this.grfGroup.add(this.copMarker);
  }

  update(state, elapsedSec) {
    // 1. Apply Cane Tilt / Fall rotation around base pivot
    this.tiltPivot.rotation.set(state.tiltZRad, state.yawRad || 0, -state.tiltXRad, 'YXZ');

    // 2. Apply elastic vertical compression under axial load (0 .. 6 mm)
    const compMeters = Math.min(0.0065, (state.axialForceN / 450) * 0.0065);
    this.bodyGroup.position.y = -0.012 - compMeters;

    // 3. Update 6 FSR Handle Heatmap Zones
    const showHeat = this.heatmapVisible;
    let maxZoneNorm = 0;

    for (let i = 0; i < 6; i++) {
      const forceN = state.fsrForcesN[i] || 0;
      const norm = Math.min(1, forceN / 38); // Each individual FSR zone saturates around ~38 N
      if (norm > maxZoneNorm) maxZoneNorm = norm;

      const zMat = this.fsrZones[i].mat;
      if (showHeat) {
        applyThermalToThreeColor(zMat.color, norm, 0xdce5f0, 0.08);
        const rgb = thermalRGB(norm);
        zMat.emissive.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
        zMat.emissiveIntensity = norm > 0.04 ? 0.16 + norm * 0.68 : 0.04;
      } else {
        zMat.color.setHex(0xdce5f0);
        zMat.emissive.setHex(0x000000);
        zMat.emissiveIntensity = 0;
      }
    }

    // Update continuous vertex-colored thermal aura around the handle
    if (showHeat && maxZoneNorm > 0.03) {
      this.handleAuraMesh.visible = true;
      this.handleAuraMat.opacity = Math.min(0.46, 0.08 + maxZoneNorm * 0.38);
      const posAttr = this.handleAuraGeo.attributes.position;
      const colAttr = this.handleAuraGeo.attributes.color;
      for (let v = 0; v < posAttr.count; v++) {
        const vx = posAttr.getX(v);
        const vy = posAttr.getY(v);
        // Map vertex (vx, vy) to nearest FSR zone along handle arc
        let zoneIdx = 4;
        if (vx > 0.03) zoneIdx = 5;
        else if (vx > -0.075) zoneIdx = 4;
        else if (vy > 0.825) zoneIdx = 3;
        else if (vy > 0.790) zoneIdx = 2;
        else if (vy > 0.755) zoneIdx = 1;
        else zoneIdx = 0;

        const norm = Math.min(1, (state.fsrForcesN[zoneIdx] || 0) / 38);
        const rgb = thermalRGB(norm);
        colAttr.setXYZ(v, rgb.r / 255, rgb.g / 255, rgb.b / 255);
      }
      colAttr.needsUpdate = true;
    } else {
      this.handleAuraMesh.visible = false;
    }

    // 4. Update Axial Load Cell Collar & 4 Articulated Quad-Pod Feet
    const lcNorm = Math.min(1, state.axialForceN / 360);
    if (showHeat) {
      applyThermalToThreeColor(this.loadCellMat.color, lcNorm, 0x3b82f6, 0.25);
      const lcRgb = thermalRGB(lcNorm);
      this.loadCellMat.emissive.setRGB(lcRgb.r / 255, lcRgb.g / 255, lcRgb.b / 255, THREE.SRGBColorSpace);
      this.loadCellMat.emissiveIntensity = 0.22 + lcNorm * 0.85;
      this.lcHaloMesh.visible = lcNorm > 0.02 && !state.isFallen;
      this.lcHaloMat.color.setRGB(lcRgb.r / 255, lcRgb.g / 255, lcRgb.b / 255, THREE.SRGBColorSpace);
      this.lcHaloMat.opacity = 0.14 + lcNorm * 0.42;
    } else {
      this.loadCellMat.color.setHex(0x64748b);
      this.loadCellMat.emissiveIntensity = 0.05;
      this.lcHaloMesh.visible = false;
    }

    // Update each of the 4 quad-pod feet & floor pressure rings
    const isUprightContact = Math.abs(state.tiltXRad) < 0.75 && Math.abs(state.tiltZRad) < 0.75 && !state.isFallen;
    this.footAssemblies.forEach((foot, idx) => {
      const fLoad = isUprightContact ? (state.footForcesN[idx] || 0) : 0;
      const fNorm = Math.min(1, fLoad / 130);
      foot.footGroup.position.y = -Math.min(0.004, fNorm * 0.004);

      if (showHeat && fNorm > 0.02) {
        const rgb = thermalRGB(fNorm);
        foot.padMat.emissive.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
        foot.padMat.emissiveIntensity = fNorm * 0.55;
        foot.floorRing.visible = true;
        foot.floorRingMat.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
        foot.floorRingMat.opacity = 0.20 + fNorm * 0.65;
        const s = 0.75 + fNorm * 0.85;
        foot.floorRing.scale.set(s, s, 1);
      } else {
        foot.padMat.emissive.setHex(0x000000);
        foot.padMat.emissiveIntensity = 0;
        foot.floorRing.visible = false;
      }
    });

    // 5. Update 3D Ground Reaction Force (GRF) Vector Arrow at Center of Pressure (CoP)
    if (showHeat && isUprightContact && state.axialForceN > 5) {
      this.grfGroup.visible = true;
      this.grfGroup.position.set(state.copX, 0.002, state.copZ);
      const vecLen = Math.min(0.46, 0.06 + (state.axialForceN / 420) * 0.40);
      this.grfShaft.scale.set(1, vecLen, 1);
      this.grfCone.position.y = vecLen;
      const rgb = thermalRGB(lcNorm);
      this.grfMat.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
    } else {
      this.grfGroup.visible = false;
    }

    // 6. Pulse 60GHz Radome lens glow & update lateral OLED micro-screen (throttled ~12 Hz)
    const radarPulse = 0.35 + 0.25 * Math.sin(elapsedSec * 7.0);
    if (state.isFallen) {
      this.radomeMat.emissive.setHex(0xff1744);
      this.radomeMat.emissiveIntensity = 0.5 + 0.5 * Math.sin(elapsedSec * 14.0);
    } else {
      this.radomeMat.emissive.setHex(state.radarEnabled ? 0x00e5ff : 0x1e293b);
      this.radomeMat.emissiveIntensity = state.radarEnabled ? radarPulse : 0.05;
    }

    if (elapsedSec - this._oledLastUpdate > 0.085) {
      this._oledLastUpdate = elapsedSec;
      this._renderLateralOLED(state);
    }
  }

  _renderLateralOLED(state) {
    const ctx = this.oledCtx;
    const w = this.oledCanvas.width;
    const h = this.oledCanvas.height;

    ctx.fillStyle = state.isFallen ? '#3b0712' : '#050d1a';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = state.isFallen ? '#ff2e4c' : '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    if (state.isFallen) {
      ctx.fillStyle = '#ff4d6d';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('⚠ ALERTA SOS', 26, 40);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('GPS TRANSMITIENDO', 24, 74);
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(`CARGA: ${Math.round(state.axialForceN)} N`, 14, 30);

      ctx.fillStyle = thermalCSS(Math.min(1, state.totalGripN / 120));
      ctx.fillText(`AGARRE: ${Math.round(state.totalGripN)} N`, 14, 56);

      ctx.fillStyle = state.radarLocked ? '#34d399' : '#94a3b8';
      ctx.font = 'bold 17px monospace';
      const vitalsTxt = state.radarLocked
        ? `♥${Math.round(state.measuredHr)}  ~${Math.round(state.measuredRr)}rpm`
        : '60GHz BUSCANDO';
      ctx.fillText(vitalsTxt, 14, 82);
    }
    this.oledTexture.needsUpdate = true;
  }

  getRadomeWorldPose(targetPos, targetDir) {
    this.radomeSocket.getWorldPosition(targetPos);
    const caneQuat = new THREE.Quaternion();
    this.handleGroup.getWorldQuaternion(caneQuat);
    targetDir.set(1, 0, 0).applyQuaternion(caneQuat).normalize();
  }

  getPiezoWorldPosition(targetPos) {
    this.piezoSocket.getWorldPosition(targetPos);
    return targetPos;
  }
}
