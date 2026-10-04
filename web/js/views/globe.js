import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { latLonToXYZ, xyzToLatLon } from '../geo.js';
import { BOUNDS, GRID, boundsOf, clean } from '../digipin.js';
import { CITIES } from '../cities.js';
import { glowTexture, makeTextSprite, setSpriteHeight } from '../sprites.js';

const R = 1;
const v3 = (lat, lon, r) => new THREE.Vector3(...latLonToXYZ(lat, lon, r));

/** Interactive 3D Earth with the DIGIPIN coverage grid wrapped around India. */
export class GlobeView {
  name = 'globe';
  onPick = () => {};
  onHover = () => {};

  constructor(canvas, data) {
    this.canvas = canvas;
    this.data = data;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.camera.position.copy(v3(22, 78, 3.4));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.18;
    this.controls.maxDistance = 7;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.addEventListener('start', () => {
      this.fly = null;
      this.controls.autoRotate = false;
    });

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverDirty = false;
    this.fly = null;
    this.selection = null;
    this.time = 0;

    this.buildLights();
    this.buildStars();
    this.buildEarth();
    this.buildIndia();
    this.buildGrid();
    this.buildCities();
    this.buildAtmosphere();
    this.buildMarker();
    this.buildHighlight();
    this.bindPointer();
  }

  // ---- construction -------------------------------------------------------
  buildLights() {
    this.scene.add(new THREE.AmbientLight(0xc9a090, 0.9));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.sun);
  }

  buildStars() {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 40 + Math.random() * 40;
      pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
      const warm = Math.random();
      col.set([1, 0.78 + warm * 0.16, 0.55 + warm * 0.2], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    this.scene.add(this.stars);
  }

  makeEarthTexture() {
    const W = 4096;
    const H = 2048;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const X = (lon) => ((lon + 180) / 360) * W;
    const Y = (lat) => ((90 - lat) / 180) * H;

    const ocean = g.createLinearGradient(0, 0, 0, H);
    ocean.addColorStop(0, '#2a0a10');
    ocean.addColorStop(0.5, '#3a1019');
    ocean.addColorStop(1, '#210810');
    g.fillStyle = ocean;
    g.fillRect(0, 0, W, H);

    // graticule
    g.strokeStyle = 'rgba(255,200,120,0.10)';
    g.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 10) {
      g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), H); g.stroke();
    }
    for (let lat = -80; lat <= 80; lat += 10) {
      g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(W, Y(lat)); g.stroke();
    }

    // land
    const tracePoly = (rings) => {
      g.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => (i ? g.lineTo(X(lon), Y(lat)) : g.moveTo(X(lon), Y(lat))));
        g.closePath();
      }
    };
    const landGrad = g.createLinearGradient(0, 0, 0, H);
    landGrad.addColorStop(0, '#8a5a2e');
    landGrad.addColorStop(0.45, '#94632f');
    landGrad.addColorStop(1, '#7d4f2c');
    g.fillStyle = landGrad;
    g.strokeStyle = 'rgba(255,214,150,0.6)';
    g.lineWidth = 1.6;
    for (const rings of this.data.world.land) {
      tracePoly(rings);
      g.fill('evenodd');
      g.stroke();
    }
    // country borders
    g.strokeStyle = 'rgba(255,232,196,0.3)';
    g.lineWidth = 1;
    for (const line of this.data.world.borders) {
      g.beginPath();
      line.forEach(([lon, lat], i) => (i ? g.lineTo(X(lon), Y(lat)) : g.moveTo(X(lon), Y(lat))));
      g.stroke();
    }
    // India fill
    g.fillStyle = 'rgba(227,30,36,0.62)';
    for (const st of this.data.states) {
      for (const poly of st.polygons) {
        tracePoly(poly);
        g.fill('evenodd');
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  buildEarth() {
    const map = this.makeEarthTexture();
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: 0.78,
      metalness: 0.05,
      emissive: new THREE.Color(0x4a1a14),
      emissiveMap: map,
      emissiveIntensity: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), mat);
    this.scene.add(this.earth);
  }

  /** Crisp 3D state borders around India. */
  buildIndia() {
    const pts = [];
    const push = (ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        pts.push(v3(a[1], a[0], R * 1.0012), v3(b[1], b[0], R * 1.0012));
      }
    };
    for (const st of this.data.states) for (const poly of st.polygons) push(poly[0]);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.indiaLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.85 }));
    this.scene.add(this.indiaLines);
  }

  /** DIGIPIN coverage box + level-1 4x4 grid (16 cells, each labelled). */
  buildGrid() {
    this.gridGroup = new THREE.Group();
    const seg = [];
    const line = (lat1, lon1, lat2, lon2) => {
      const steps = Math.max(2, Math.ceil(Math.max(Math.abs(lat2 - lat1), Math.abs(lon2 - lon1)) / 0.75));
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        seg.push(
          v3(lat1 + (lat2 - lat1) * t0, lon1 + (lon2 - lon1) * t0, R * 1.0025),
          v3(lat1 + (lat2 - lat1) * t1, lon1 + (lon2 - lon1) * t1, R * 1.0025)
        );
      }
    };
    const { minLat, maxLat, minLon, maxLon } = BOUNDS;
    for (let i = 0; i <= 4; i++) {
      const la = minLat + ((maxLat - minLat) * i) / 4;
      const lo = minLon + ((maxLon - minLon) * i) / 4;
      line(la, minLon, la, maxLon);
      line(minLat, lo, maxLat, lo);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(seg);
    this.gridLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffc20e, transparent: true, opacity: 0.55 }));
    this.gridGroup.add(this.gridLines);

    // cell labels
    this.gridLabels = [];
    const dLat = (maxLat - minLat) / 4;
    const dLon = (maxLon - minLon) / 4;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const s = makeTextSprite(GRID[r][c], { color: '#ffe27a', size: 72, padX: 0.35, depthTest: true, opacity: 0.9 });
        s.position.copy(v3(maxLat - dLat * (r + 0.5), minLon + dLon * (c + 0.5), R * 1.012));
        setSpriteHeight(s, 0.05);
        this.gridLabels.push(s);
        this.gridGroup.add(s);
      }
    }
    this.scene.add(this.gridGroup);
  }

  buildCities() {
    const n = CITIES.length;
    const pos = new Float32Array(n * 3);
    CITIES.forEach((c, i) => pos.set(latLonToXYZ(c.lat, c.lon, R * 1.004), i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.cityPoints = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.035, map: glowTexture(), color: 0xffd08a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    this.scene.add(this.cityPoints);

    this.cityLabels = new THREE.Group();
    for (const c of CITIES.filter((x) => x.major)) {
      const s = makeTextSprite(c.name, { color: '#ffe8c8', size: 56, mono: false, weight: 600, padX: 0.3, depthTest: true });
      s.position.copy(v3(c.lat + 0.9, c.lon, R * 1.012));
      setSpriteHeight(s, 0.028);
      this.cityLabels.add(s);
    }
    this.scene.add(this.cityLabels);
  }

  buildAtmosphere() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { c: { value: new THREE.Color(0xe3501e) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform vec3 c; void main(){ float f = pow(0.72 - dot(vN, vV), 3.2); gl_FragColor = vec4(c, 1.) * clamp(f, 0., 1.) * 1.6; }'
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), mat);
    this.scene.add(this.atmosphere);

    // thin rim just above the surface (front side)
    const rim = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - max(dot(vN, vV), 0.), 3.); gl_FragColor = vec4(1., 0.55, 0.15, 1.) * f * 0.55; }'
    });
    this.rim = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 96, 64), rim);
    this.scene.add(this.rim);
  }

  buildMarker() {
    const m = new THREE.Group();
    const accent = 0xffc20e;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    core.position.y = 0.002;
    const beamGeo = new THREE.CylinderGeometry(0.0016, 0.0016, 0.2, 8, 1, true);
    beamGeo.translate(0, 0.1, 0);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.09);
    glow.position.y = 0.2;
    this.rings = [0, 1].map(() => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 56),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      m.add(ring);
      return ring;
    });
    m.add(core, beam, glow);
    m.visible = false;
    this.marker = m;
    this.scene.add(m);
  }

  buildHighlight() {
    this.highlight = new THREE.Group();
    this.scene.add(this.highlight);
  }

  // ---- interaction --------------------------------------------------------
  bindPointer() {
    const el = this.canvas;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || !this.active) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved < 6 && dt < 450) {
        const hit = this.pick(e.clientX, e.clientY);
        if (hit) this.onPick(hit.lat, hit.lon);
      }
    });
    el.addEventListener('pointermove', (e) => {
      this.pointerClient = { x: e.clientX, y: e.clientY };
      this.hoverDirty = true;
    });
    el.addEventListener('pointerleave', () => this.onHover(null));
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.earth, false)[0];
    return hit ? xyzToLatLon(hit.point.x, hit.point.y, hit.point.z) : null;
  }

  // ---- API used by main.js ------------------------------------------------
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setActive(on) {
    this.active = on;
    this.controls.enabled = on;
  }

  flyTo(lat, lon, dist = 1.85, seconds = 1.8) {
    const from = this.camera.position.clone();
    const d0 = from.clone().normalize();
    const d1 = v3(lat, lon, 1).normalize();
    this.fly = { t: 0, seconds, d0, d1, dist0: from.length(), dist1: dist, q: new THREE.Quaternion().setFromUnitVectors(d0, d1) };
    this.controls.autoRotate = false;
  }

  setSelection(sel) {
    this.selection = sel;
    this.highlight.clear();
    if (!sel) {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    const p = v3(sel.lat, sel.lon, R * 1.003);
    this.marker.position.copy(p);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());

    const code = clean(sel.digipin);
    const colors = [0xfff0c0, 0xffd23a, 0xffa31a, 0xff4a50];
    for (let level = 1; level <= 4; level++) {
      this.highlight.add(this.cellOutline(boundsOf(code.slice(0, level)), colors[level - 1], 0.95));
    }
    const current = this.camera.position.length();
    this.flyTo(sel.lat, sel.lon, sel.source === 'globe' ? Math.min(current, 2.1) : 1.7, sel.source === 'globe' ? 1.1 : 1.8);
  }

  cellOutline(b, color, opacity) {
    const pts = [];
    const edge = (la1, lo1, la2, lo2) => {
      const n = 12;
      for (let i = 0; i < n; i++) {
        pts.push(v3(la1 + ((la2 - la1) * i) / n, lo1 + ((lo2 - lo1) * i) / n, R * 1.0035));
        pts.push(v3(la1 + ((la2 - la1) * (i + 1)) / n, lo1 + ((lo2 - lo1) * (i + 1)) / n, R * 1.0035));
      }
    };
    edge(b.minLat, b.minLon, b.minLat, b.maxLon);
    edge(b.minLat, b.maxLon, b.maxLat, b.maxLon);
    edge(b.maxLat, b.maxLon, b.maxLat, b.minLon);
    edge(b.maxLat, b.minLon, b.minLat, b.minLon);
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    );
  }

  update(dt) {
    this.time += dt;
    const dist = this.camera.position.length();

    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.seconds);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      const q = new THREE.Quaternion().slerp(f.q, e);
      const dir = f.d0.clone().applyQuaternion(q);
      // arc outwards a little during the flight for a cinematic feel
      const arc = Math.sin(e * Math.PI) * 0.25;
      this.camera.position.copy(dir.multiplyScalar(f.dist0 + (f.dist1 - f.dist0) * e + arc));
      if (f.t >= 1) this.fly = null;
    }

    // slow down rotation when zoomed in
    this.controls.rotateSpeed = Math.min(1, (dist - 1) * 0.55 + 0.12);
    this.controls.zoomSpeed = 0.8;
    this.controls.update();

    // key light follows the viewer so the visible hemisphere is always lit
    this.sun.position.copy(this.camera.position).add(new THREE.Vector3(2, 1.5, 1.5));

    // label visibility by zoom
    const showGrid = dist < 3.4;
    this.gridLabels.forEach((s) => {
      s.visible = showGrid;
      setSpriteHeight(s, 0.022 + (dist - 1) * 0.02);
    });
    const showCities = dist < 2.7;
    this.cityLabels.visible = showCities;
    this.cityLabels.children.forEach((s) => setSpriteHeight(s, 0.012 + (dist - 1) * 0.011));
    this.cityPoints.material.size = 0.02 + (dist - 1) * 0.012;

    // marker pulse + constant on-screen presence
    if (this.marker.visible) {
      const k = Math.max(0.45, (dist - 1) * 0.9);
      this.marker.scale.setScalar(k);
      this.rings.forEach((r, i) => {
        const t = (this.time * 0.7 + i * 0.5) % 1;
        r.scale.setScalar(0.012 + t * 0.05);
        r.material.opacity = (1 - t) * 0.9;
      });
    }

    // hover
    if (this.hoverDirty && this.pointerClient && this.active) {
      this.hoverDirty = false;
      const hit = this.pick(this.pointerClient.x, this.pointerClient.y);
      this.onHover(hit);
    }
  }
}
