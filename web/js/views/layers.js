import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID, LEVELS, boundsOf, cellSizeLabel, charToCell, clean, formatDigipin } from '../digipin.js';
import { disposeObject, glowTexture, makeTextSprite, setSpriteHeight } from '../sprites.js';
import { loadTileLayer, paintPlate, wantsTiles } from './platemap.js';

const PLATE = 2.4;
const PLATE_PX = 768;
const DEMO_POINT = { lat: 28.622788, lon: 77.213033, label: 'Dak Bhawan' };
const GAP = 1.0;
const DEMO_CODE = '39J49LL8T4'; // Dak Bhawan, New Delhi (from the DIGIPIN spec)

const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Level colour ramp: post-box red -> cream -> postal gold. */
function levelColor(i) {
  const t = i / (LEVELS - 1);
  const saffron = new THREE.Color(0xe31e24);
  const white = new THREE.Color(0xfff4e6);
  const green = new THREE.Color(0xffc20e);
  return t < 0.5 ? saffron.lerp(white, t * 2) : white.lerp(green, (t - 0.5) * 2);
}

/**
 * "Zoom funnel": ten translucent 4x4 plates, one per DIGIPIN level. Each plate highlights
 * the cell chosen at that level and a glass funnel shows how it expands into the next plate.
 */
export class LayersView {
  name = 'layers';
  onPick = () => {};
  onHover = () => {};

  constructor(canvas, data) {
    this.canvas = canvas;
    this.data = data;
    this.sel = null;
    this.token = 0;
    this.tilesStarted = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(9, 10.4, 15.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 5.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 30;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; clearTimeout(this.idle); });
    this.controls.addEventListener('end', () => {
      clearTimeout(this.idle);
      this.idle = setTimeout(() => { this.controls.autoRotate = true; }, 6000);
    });

    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
    this.stack = new THREE.Group();
    this.scene.add(this.stack);
    this.reveal = 0;
    this.time = 0;
    this.items = [];
    this.build(DEMO_CODE, true);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setActive(on) {
    this.active = on;
    this.controls.enabled = on;
    if (on) {
      this.reveal = Math.min(this.reveal, 0.15);
      this.ensureTiles();
    }
  }

  setSelection(sel) {
    const code = sel ? clean(sel.digipin) : DEMO_CODE;
    this.sel = sel || null;
    this.build(code, !sel);
  }

  /** Where the marker goes, its label and the "area covered" caption for each level. */
  pointInfo() {
    const sel = this.sel;
    if (!sel) {
      const d = DEMO_POINT;
      return { lat: d.lat, lon: d.lon, label: d.label, areas: ['India', 'Delhi', 'Delhi', 'New Delhi', 'New Delhi', 'Central Delhi', 'Parliament Street', 'Dak Bhawan', 'Dak Bhawan', 'Dak Bhawan'] };
    }
    const p = sel.place || {};
    const state = sel.state || p.state || '';
    const district = sel.district || p.district || '';
    const city = p.city || '';
    const locality = p.locality || '';
    const name = p.name || locality || city || '';
    const label = name || (sel.addressLoading ? 'Locating…' : 'Selected location');
    const chain = ['India', state, state, district || city, city || district, locality || city, locality, name, name, name];
    // fall back to the previous non-empty value so every plate gets a caption
    const areas = chain.map((v, i) => v || (i ? chain[i - 1] : 'India'));
    return { lat: sel.lat, lon: sel.lon, label, areas };
  }

  paint(item, i) {
    const info = this.pointInfo();
    const same = i > 0 && info.areas[i] === info.areas[i - 1];
    const text = info.areas[i];
    const caption = i === 0 ? 'INDIA' : same || !text ? text : `${i >= 4 ? 'near ' : ''}${text}`;
    paintPlate(item.canvas, {
      bounds: item.bounds,
      chosen: item.chosen,
      color: item.color,
      grid: GRID,
      states: this.data.states,
      land: this.data.world?.land,
      tiles: item.tiles,
      point: { lat: info.lat, lon: info.lon, label: info.label },
      caption
    });
    item.tex.needsUpdate = true;
  }

  /** Called when the address lookup finishes: refresh names without rebuilding the stack. */
  setPlace(sel) {
    this.sel = sel;
    this.items.forEach((it, i) => this.paint(it, i));
  }

  /**
   * Street tiles are only fetched while the funnel is on screen (and after a short pause), so
   * browsing the map or clicking around quickly never hammers the free OSM tile servers.
   */
  ensureTiles() {
    if (this.tilesStarted || !this.active || !this.items.length) return;
    this.tilesStarted = true;
    const token = this.token;
    setTimeout(() => token === this.token && this.loadTiles(token), 350);
  }

  /** Stream street-level tiles into the zoomed plates, top to bottom. */
  async loadTiles(token) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!wantsTiles(it.bounds)) continue;
      const tiles = await loadTileLayer(it.bounds, it.canvas.width);
      if (token !== this.token) return;
      if (!tiles) continue;
      it.tiles = tiles;
      this.paint(it, i);
    }
  }

  clearStack() {
    while (this.stack.children.length) {
      const c = this.stack.children[0];
      this.stack.remove(c);
      disposeObject(c);
    }
    this.items = [];
  }

  build(code, demo) {
    this.clearStack();
    this.code = code;
    this.demo = demo;
    this.reveal = 0;
    this.token++;
    this.tilesStarted = false;
    const cells = [...code].map((ch) => charToCell(ch));
    if (cells.some((c) => !c)) return;

    const yOf = (i) => (LEVELS - 1 - i) * GAP; // L1 on top
    const cellCenter = (i) => {
      const { row, col } = cells[i];
      return new THREE.Vector3(-PLATE / 2 + ((col + 0.5) * PLATE) / 4, yOf(i), -PLATE / 2 + ((row + 0.5) * PLATE) / 4);
    };

    const pathPts = [];
    for (let i = 0; i < LEVELS; i++) {
      const color = levelColor(i);
      const group = new THREE.Group();
      group.position.y = yOf(i);

      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = PLATE_PX;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(PLATE, PLATE),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
      );
      plate.rotation.x = -Math.PI / 2;
      group.add(plate);

      const h = PLATE / 2;
      const border = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-h, 0, -h), new THREE.Vector3(h, 0, -h), new THREE.Vector3(h, 0, h), new THREE.Vector3(-h, 0, h)]),
        new THREE.LineBasicMaterial({ color, transparent: true })
      );
      group.add(border);

      const size = cellSizeLabel(i + 1);
      const label = makeTextSprite(`L${i + 1}  ${code[i]}   ${size.degrees} ${size.distance}`, {
        color: `#${color.getHexString()}`, size: 52, padX: 0.5, bg: 'rgba(30,6,10,0.75)', border: `#${color.getHexString()}66`, depthTest: false
      });
      setSpriteHeight(label, 0.34);
      label.position.set(PLATE / 2 + 0.2 + (label.scale.x / 2), 0.02, PLATE / 2 - 0.25);
      group.add(label);

      this.stack.add(group);
      const item = { group, plate, border, label, funnel: null, color, canvas, tex, tiles: null, chosen: cells[i], bounds: boundsOf(code.slice(0, i)) };

      // funnel to next plate
      if (i < LEVELS - 1) {
        const c = cellCenter(i);
        const q = PLATE / 8;
        const topCorners = [[-q, -q], [q, -q], [q, q], [-q, q]].map(([dx, dz]) => new THREE.Vector3(c.x + dx, yOf(i), c.z + dz));
        const botCorners = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([dx, dz]) => new THREE.Vector3(dx, yOf(i + 1), dz));
        const verts = [...topCorners, ...botCorners];
        const idx = [];
        for (let k = 0; k < 4; k++) {
          const n = (k + 1) % 4;
          idx.push(k, n, 4 + k, n, 4 + n, 4 + k);
        }
        const g = new THREE.BufferGeometry().setFromPoints(verts);
        g.setIndex(idx);
        const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color: levelColor(i + 0.5), transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        const ls = [];
        for (let k = 0; k < 4; k++) ls.push(topCorners[k], botCorners[k]);
        const edges = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(ls),
          new THREE.LineBasicMaterial({ color: levelColor(i + 0.5), transparent: true, opacity: 0 })
        );
        this.stack.add(fill, edges);
        item.funnel = { fill, edges };
      }
      this.items.push(item);

      const center = cellCenter(i);
      pathPts.push(center);
    }

    this.items.forEach((it, i) => this.paint(it, i));
    this.ensureTiles();

    // descent path through the chosen cells
    const pathGeo = new THREE.BufferGeometry().setFromPoints(pathPts);
    const path = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0 }));
    this.stack.add(path);
    this.path = path;

    // glowing pin at the last cell
    const last = pathPts[LEVELS - 1];
    const beamGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.4, 8, 1, true);
    beamGeo.translate(0, 0.7, 0);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffc20e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.copy(last);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc20e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.9);
    glow.position.copy(last).add(new THREE.Vector3(0, 0.15, 0));
    this.stack.add(beam, glow);
    this.pin = { beam, glow };

    // headline
    const head = makeTextSprite(formatDigipin(code), { color: '#ffffff', size: 88, padX: 0.7, bg: 'rgba(30,6,10,0.75)', border: '#ffc20eaa', depthTest: false });
    setSpriteHeight(head, 0.62);
    head.position.set(0, yOf(0) + 1.2, 0);
    this.stack.add(head);
    this.head = head;
    head.material.opacity = 0;

    const sub = makeTextSprite(demo ? 'Sample — Dak Bhawan, New Delhi · search any place to see yours' : 'Each character narrows the area 4× in both directions', {
      color: '#ffd9a8', size: 40, mono: false, weight: 500, padX: 0.5, depthTest: false
    });
    setSpriteHeight(sub, 0.24);
    sub.position.set(0, yOf(0) + 0.65, 0);
    sub.material.opacity = 0;
    this.stack.add(sub);
    this.sub = sub;
  }

  update(dt) {
    this.time += dt;
    this.reveal = Math.min(1, this.reveal + dt / 3.2);
    const total = this.reveal * (LEVELS + 2);

    this.items.forEach((it, i) => {
      const p = ease(Math.max(0, Math.min(1, total - i)));
      it.plate.material.opacity = p * 0.95;
      it.border.material.opacity = p;
      it.label.material.opacity = p;
      it.group.scale.setScalar(0.85 + 0.15 * p);
      it.group.visible = p > 0.001;
      if (it.funnel) {
        const q = ease(Math.max(0, Math.min(1, total - i - 0.6)));
        it.funnel.fill.material.opacity = q * 0.1;
        it.funnel.edges.material.opacity = q * 0.9;
      }
    });
    const done = ease(Math.max(0, Math.min(1, total - LEVELS)));
    if (this.path) this.path.material.opacity = done;
    if (this.pin) {
      this.pin.beam.material.opacity = done * (0.55 + Math.sin(this.time * 3) * 0.2);
      this.pin.glow.material.opacity = done;
      this.pin.glow.scale.setScalar(0.8 + Math.sin(this.time * 3) * 0.12);
    }
    if (this.head) this.head.material.opacity = ease(Math.max(0, Math.min(1, total * 0.7)));
    if (this.sub) this.sub.material.opacity = ease(Math.max(0, Math.min(1, total - 2))) * 0.9;

    this.controls.update();
  }
}
