import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BOUNDS, GRID, boundsOf, clean } from '../digipin.js';
import { pointInPolygon, ringBBox } from '../geo.js';
import { CITIES } from '../cities.js';
import { disposeObject, glowTexture, makeTextSprite, setSpriteHeight } from '../sprites.js';

/** world units per degree: the 36° DIGIPIN box becomes a 3.6 x 3.6 square */
const S = 0.1;
const C_LON = 81.5;
const C_LAT = 20.5;
const FULL = (BOUNDS.maxLon - BOUNDS.minLon) * S;
const STATE_H = 0.02;
const MAX_FOCUS = 4; // prefix length; the overlay then shows level-5 cells (~3.9 km)

const X = (lon) => (lon - C_LON) * S;
const Z = (lat) => -(lat - C_LAT) * S;
const toLon = (x) => x / S + C_LON;
const toLat = (z) => C_LAT - z / S;

const letterMats = new Map();
function letterMaterial(ch) {
  if (letterMats.has(ch)) return letterMats.get(ch);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 92px "JetBrains Mono", ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.9)';
  g.shadowBlur = 8;
  g.fillStyle = '#ffe9b8';
  g.fillText(ch, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 });
  letterMats.set(ch, m);
  return m;
}

/** Extruded 3D map of India sitting on the 36° x 36° DIGIPIN coverage plate. */
export class IndiaView {
  name = 'india';
  onPick = () => {};
  onHover = () => {};
  onFocus = () => {};

  constructor(canvas, data) {
    this.canvas = canvas;
    this.data = data;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.003, 100);
    this.focusPrefix = '';
    this.zoomK = 1;
    this.zoomKTarget = 1;
    this.cam = null;
    this.time = 0;
    this.selection = null;
    this.hoverState = -1;
    this.pointerClient = null;
    this.hoverDirty = false;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.012;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => { this.cam = null; });
    this.camera.position.set(0, 4.6, 4.2);
    this.controls.target.set(0, 0, 0);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();

    this.buildLights();
    this.buildFloor();
    this.buildStates();
    this.buildCities();
    this.buildOverlayHolders();
    this.buildMarker();
    this.setFocus('', { animate: false });
    this.bindPointer();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xffe0c0, 0x2a1008, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(-2.5, 5, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc20e, 0.8);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);
  }

  buildFloor() {
    const N = 2048;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.75);
    grad.addColorStop(0, '#3a0f14');
    grad.addColorStop(1, '#1a0508');
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    const step = N / 36;
    for (let i = 0; i <= 36; i++) {
      g.strokeStyle = i % 9 === 0 ? 'rgba(255,194,14,0.55)' : i % 3 === 0 ? 'rgba(255,200,140,0.20)' : 'rgba(255,200,140,0.08)';
      g.lineWidth = i % 9 === 0 ? 3 : 1;
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, N); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(N, i * step); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(FULL, FULL),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.0003;
    this.scene.add(plane);

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(FULL + 0.06, 0.06, FULL + 0.06),
      new THREE.MeshStandardMaterial({ color: 0x2a0a10, roughness: 0.5, metalness: 0.4, emissive: 0x180406 })
    );
    slab.position.y = -0.0304;
    this.scene.add(slab);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(FULL + 0.06, 0.06, FULL + 0.06)),
      new THREE.LineBasicMaterial({ color: 0xffc20e, transparent: true, opacity: 0.6 })
    );
    edge.position.y = -0.0304;
    this.scene.add(edge);
  }

  buildStates() {
    this.statesRoot = new THREE.Group();
    this.states = [];
    this.data.states.forEach((st, i) => {
      const hue = ((350 + ((i * 47) % 60)) % 360) / 360;
      const color = new THREE.Color().setHSL(hue, 0.72, 0.4);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.1,
        emissive: color.clone().multiplyScalar(0.8),
        emissiveIntensity: 0.55
      });
      const group = new THREE.Group();
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0.85 });
      const lineGroup = [];
      const bboxes = [];
      for (const poly of st.polygons) {
        const outer = poly[0];
        if (outer.length < 4) continue;
        const shape = new THREE.Shape(outer.map(([lon, lat]) => new THREE.Vector2(X(lon), (lat - C_LAT) * S)));
        for (let h = 1; h < poly.length; h++) {
          shape.holes.push(new THREE.Path(poly[h].map(([lon, lat]) => new THREE.Vector2(X(lon), (lat - C_LAT) * S))));
        }
        const geo = new THREE.ExtrudeGeometry(shape, { depth: STATE_H, bevelEnabled: false, curveSegments: 1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        group.add(mesh);
        for (const ring of poly) {
          const pts = ring.map(([lon, lat]) => new THREE.Vector3(X(lon), STATE_H + 0.0004, Z(lat)));
          const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
          group.add(l);
          lineGroup.push(l);
        }
        bboxes.push(ringBBox(outer));
      }
      this.statesRoot.add(group);
      this.states.push({ name: st.name, polygons: st.polygons, bboxes, group, mat, baseEmissive: 0.5, lift: 0, liftTarget: 0 });
    });
    this.scene.add(this.statesRoot);
  }

  buildCities() {
    this.cityRoot = new THREE.Group();
    this.cityLabels = [];
    const pos = new Float32Array(CITIES.length * 3);
    CITIES.forEach((c, i) => pos.set([X(c.lon), 0, Z(c.lat)], i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.cityPoints = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.05, map: glowTexture(), color: 0xffc27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, depthTest: false
    }));
    this.cityPoints.renderOrder = 8;
    this.cityRoot.add(this.cityPoints);
    CITIES.forEach((c) => {
      const s = makeTextSprite(c.name, { color: '#ffe3bd', size: 54, mono: false, weight: 600, padX: 0.25, padY: 0.2 });
      s.position.set(X(c.lon), 0, Z(c.lat));
      s.userData.city = c;
      this.cityLabels.push(s);
      this.cityRoot.add(s);
    });
    this.scene.add(this.cityRoot);
  }

  buildOverlayHolders() {
    this.overlay = new THREE.Group(); // grid + labels for the current focus (rebuilt)
    this.scene.add(this.overlay);

    const flat = (color, opacity) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, depthTest: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 5;
      return m;
    };
    this.hoverQuad = flat(0xffffff, 0.25);
    this.selectQuad = flat(0xffc20e, 0.55);
    this.scene.add(this.hoverQuad, this.selectQuad);
  }

  buildMarker() {
    const m = new THREE.Group();
    const accent = 0xffc20e;
    const beamGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 10, 1, true);
    beamGeo.translate(0, 0.5, 0);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    head.position.y = 1;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.7);
    glow.position.y = 1;
    this.rings = [0, 1].map(() => {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 64),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      r.rotation.x = -Math.PI / 2;
      m.add(r);
      return r;
    });
    m.add(beam, head, glow);
    m.visible = false;
    this.marker = m;
    this.scene.add(m);
  }

  // ---- focus / overlay ------------------------------------------------------
  /** Rebuild the 4x4 overlay for a DIGIPIN prefix ('' = whole India) and fly there. */
  setFocus(prefix, { animate = true } = {}) {
    prefix = clean(prefix).slice(0, MAX_FOCUS);
    this.focusPrefix = prefix;
    const b = boundsOf(prefix);
    this.focusBounds = b;
    const w = (b.maxLon - b.minLon) * S;
    this.focusW = w;
    this.zoomKTarget = Math.min(1, Math.max(0.004, w / FULL));

    // dispose old overlay
    while (this.overlay.children.length) {
      const c = this.overlay.children[0];
      this.overlay.remove(c);
      c.traverse((o) => o.geometry?.dispose?.());
    }

    const lines = [];
    const cell = w / 4;
    const x0 = X(b.minLon);
    const z0 = Z(b.maxLat);
    for (let i = 0; i <= 4; i++) {
      lines.push(new THREE.Vector3(x0 + cell * i, 0, z0), new THREE.Vector3(x0 + cell * i, 0, z0 + w));
      lines.push(new THREE.Vector3(x0, 0, z0 + cell * i), new THREE.Vector3(x0 + w, 0, z0 + cell * i));
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(lines),
      new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.9, depthTest: false })
    );
    grid.renderOrder = 6;
    this.overlay.add(grid);

    const borderPts = [
      new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0 + w, 0, z0),
      new THREE.Vector3(x0 + w, 0, z0 + w), new THREE.Vector3(x0, 0, z0 + w)
    ];
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(borderPts),
      new THREE.LineBasicMaterial({ color: 0xffc20e, depthTest: false })
    );
    border.renderOrder = 7;
    this.overlay.add(border);

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), letterMaterial(GRID[r][c]));
        m.rotation.x = -Math.PI / 2;
        m.scale.setScalar(cell * 0.5);
        m.position.set(x0 + cell * (c + 0.5), 0, z0 + cell * (r + 0.5));
        m.renderOrder = 7;
        this.overlay.add(m);
      }
    }

    if (prefix) {
      // dim everything outside the focused cell
      const big = FULL / 2 + 0.05;
      const shape = new THREE.Shape([new THREE.Vector2(-big, -big), new THREE.Vector2(big, -big), new THREE.Vector2(big, big), new THREE.Vector2(-big, big)]);
      shape.holes.push(new THREE.Path([
        new THREE.Vector2(x0, -z0), new THREE.Vector2(x0 + w, -z0), new THREE.Vector2(x0 + w, -(z0 + w)), new THREE.Vector2(x0, -(z0 + w))
      ].reverse()));
      const mask = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0x140204, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
      );
      mask.rotation.x = -Math.PI / 2;
      mask.position.y = -0.0001;
      mask.renderOrder = 4;
      this.overlay.add(mask);
    }

    this.updateSelectQuad();
    this.hoverQuad.visible = false;

    const target = new THREE.Vector3(X((b.minLon + b.maxLon) / 2), 0, Z((b.minLat + b.maxLat) / 2));
    const dist = prefix ? w * 1.75 : 5.6;
    if (animate) this.flyCamera(target, dist);
    else {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.zoomK = this.zoomKTarget;
    }
    this.onFocus(prefix);
  }

  flyCamera(target, dist, seconds = 1.2) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const d0 = dir.length();
    this.cam = {
      t: 0, seconds, dir: dir.normalize(),
      t0: this.controls.target.clone(), t1: target,
      d0, d1: dist
    };
  }

  focusOn(sel, depth) {
    this.setFocus(clean(sel.digipin).slice(0, depth));
  }

  updateSelectQuad() {
    const sel = this.selection;
    if (!sel) { this.selectQuad.visible = false; return; }
    const code = clean(sel.digipin);
    if (!code.startsWith(this.focusPrefix) || this.focusPrefix.length >= code.length) { this.selectQuad.visible = false; return; }
    const b = boundsOf(code.slice(0, this.focusPrefix.length + 1));
    this.placeQuad(this.selectQuad, b);
  }

  placeQuad(quad, b) {
    const w = (b.maxLon - b.minLon) * S;
    quad.scale.set(w, w, 1);
    quad.position.set(X((b.minLon + b.maxLon) / 2), 0, Z((b.minLat + b.maxLat) / 2));
    quad.visible = true;
  }

  // ---- picking --------------------------------------------------------------
  latLonAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    const lat = toLat(this.hit.z);
    const lon = toLon(this.hit.x);
    if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lon < BOUNDS.minLon || lon > BOUNDS.maxLon) return null;
    return { lat, lon };
  }

  stateAt(lat, lon) {
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i];
      for (let p = 0; p < st.polygons.length; p++) {
        const bb = st.bboxes[p];
        if (!bb || lon < bb.minX || lon > bb.maxX || lat < bb.minY || lat > bb.maxY) continue;
        if (pointInPolygon(lon, lat, st.polygons[p])) return i;
      }
    }
    return -1;
  }

  bindPointer() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || !this.active) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved < 6 && dt < 450) {
        const p = this.latLonAt(e.clientX, e.clientY);
        if (p) {
          const b = this.focusBounds;
          const inside = p.lat >= b.minLat && p.lat < b.maxLat && p.lon >= b.minLon && p.lon < b.maxLon;
          this.pendingDepth = inside ? Math.min(this.focusPrefix.length + 1, MAX_FOCUS) : 1;
          this.onPick(p.lat, p.lon);
        }
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      this.pointerClient = { x: e.clientX, y: e.clientY };
      this.hoverDirty = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverQuad.visible = false;
      this.setHoverState(-1);
      this.onHover(null);
    });
  }

  setHoverState(i) {
    if (i === this.hoverState) return;
    if (this.hoverState >= 0) this.states[this.hoverState].liftTarget = 0;
    this.hoverState = i;
    if (i >= 0) this.states[i].liftTarget = 1;
  }

  // ---- API used by main.js --------------------------------------------------
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setActive(on) {
    this.active = on;
    this.controls.enabled = on;
  }

  setSelection(sel) {
    this.selection = sel;
    if (!sel) {
      this.marker.visible = false;
      this.selectQuad.visible = false;
      return;
    }
    const code = clean(sel.digipin);
    let depth;
    if (sel.source === 'india' && this.pendingDepth) depth = this.pendingDepth;
    else depth = 3;
    this.pendingDepth = 0;
    this.marker.visible = true;
    this.markerPos = new THREE.Vector3(X(sel.lon), 0, Z(sel.lat));
    this.setFocus(code.slice(0, depth));
  }

  update(dt) {
    this.time += dt;

    if (this.cam) {
      const f = this.cam;
      f.t = Math.min(1, f.t + dt / f.seconds);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(f.t0, f.t1, e);
      const d = f.d0 * Math.pow(f.d1 / f.d0, e);
      this.camera.position.copy(this.controls.target).addScaledVector(f.dir, d);
      if (f.t >= 1) this.cam = null;
    }

    // adapt controls to the zoom level so wheel/pan feel right at every scale
    this.controls.panSpeed = Math.max(0.4, this.focusW * 0.5);
    this.controls.update();

    this.zoomK += (this.zoomKTarget - this.zoomK) * Math.min(1, dt * 6);
    const k = this.zoomK;
    this.statesRoot.scale.y = k;
    const lift = STATE_H * 1.6 + 0.012;
    this.overlay.position.y = lift * k;
    this.hoverQuad.position.y = this.selectQuad.position.y = lift * k * 0.999;
    this.cityRoot.position.y = lift * k;

    // states: hover lift
    for (const st of this.states) {
      st.lift += (st.liftTarget - st.lift) * Math.min(1, dt * 10);
      st.group.scale.y = 1 + st.lift * 0.6;
      st.mat.emissiveIntensity = st.baseEmissive + st.lift * 0.9;
    }

    // city labels scale with the focus window
    const fw = this.focusW;
    const b = this.focusBounds;
    this.cityPoints.material.size = Math.max(fw * 0.016, 0.0006);
    for (const s of this.cityLabels) {
      const c = s.userData.city;
      const inside = c.lat >= b.minLat && c.lat <= b.maxLat && c.lon >= b.minLon && c.lon <= b.maxLon;
      s.visible = Boolean(inside && (this.focusPrefix.length >= 1 || c.major));
      if (s.visible) {
        setSpriteHeight(s, fw * 0.016);
        s.position.y = fw * 0.02;
      }
    }

    // selection marker
    if (this.marker.visible && this.markerPos) {
      const scale = Math.max(fw * 0.07, 0.0004);
      this.marker.position.copy(this.markerPos);
      this.marker.position.y = lift * k;
      this.marker.scale.setScalar(scale);
      this.rings.forEach((r, i) => {
        const t = (this.time * 0.75 + i * 0.5) % 1;
        r.scale.setScalar(0.3 + t * 1.5);
        r.material.opacity = (1 - t) * 0.9;
      });
    }
    this.selectQuad.material.opacity = 0.35 + Math.sin(this.time * 3) * 0.12;

    if (this.hoverDirty && this.pointerClient && this.active) {
      this.hoverDirty = false;
      this.handleHover(this.pointerClient.x, this.pointerClient.y);
    }
  }

  handleHover(x, y) {
    const p = this.latLonAt(x, y);
    if (!p) {
      this.hoverQuad.visible = false;
      this.setHoverState(-1);
      this.onHover(null);
      return;
    }
    const si = this.stateAt(p.lat, p.lon);
    this.setHoverState(this.focusPrefix.length <= 1 ? si : -1);
    const b = this.focusBounds;
    let cellCode = null;
    if (p.lat >= b.minLat && p.lat < b.maxLat && p.lon >= b.minLon && p.lon < b.maxLon) {
      const row = Math.min(3, Math.floor(((b.maxLat - p.lat) / (b.maxLat - b.minLat)) * 4));
      const col = Math.min(3, Math.floor(((p.lon - b.minLon) / (b.maxLon - b.minLon)) * 4));
      cellCode = this.focusPrefix + GRID[row][col];
      this.placeQuad(this.hoverQuad, boundsOf(cellCode));
    } else {
      this.hoverQuad.visible = false;
    }
    this.onHover({ ...p, state: si >= 0 ? this.states[si].name : null, cellCode });
  }

  get maxFocus() {
    return MAX_FOCUS;
  }
}
