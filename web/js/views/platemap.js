import { CITIES } from '../cities.js';

/**
 * Map painting for the zoom-funnel plates. Every plate shows the real map of the area that
 * level covers: vector India for the wide levels, OpenStreetMap tiles (re-projected so DIGIPIN
 * cells stay exact squares) for the zoomed levels, plus place names and the selected point.
 */

const TILE = 256;
const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';

const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/** Wide levels use the vector map; narrow ones get street-level tiles. */
export const wantsTiles = (b) => b.maxLon - b.minLon <= 2.3;

function loadImage(url, ms = 9000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), ms);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

/**
 * Fetch the OSM tiles covering `b` and re-project them (Web-Mercator -> plate-carree) into
 * an N x N canvas. Resolves to null when nothing could be loaded (offline, blocked...).
 */
export async function loadTileLayer(b, N) {
  const span = b.maxLon - b.minLon;
  let z = Math.min(19, Math.ceil(Math.log2(504 / span)));
  let x0, x1, y0, y1;
  for (;;) {
    x0 = Math.floor(tileX(b.minLon, z));
    x1 = Math.floor(tileX(b.maxLon, z));
    y0 = Math.floor(tileY(b.maxLat, z));
    y1 = Math.floor(tileY(b.minLat, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 12 || z <= 0) break;
    z--;
  }
  const jobs = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) jobs.push(loadImage(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`).then((img) => ({ img, x, y })));
  }
  const tiles = await Promise.all(jobs);
  if (!tiles.some((t) => t.img)) return null;

  const mosaic = document.createElement('canvas');
  mosaic.width = (x1 - x0 + 1) * TILE;
  mosaic.height = (y1 - y0 + 1) * TILE;
  const mg = mosaic.getContext('2d');
  mg.fillStyle = '#2b1a14';
  mg.fillRect(0, 0, mosaic.width, mosaic.height);
  for (const t of tiles) if (t.img) mg.drawImage(t.img, (t.x - x0) * TILE, (t.y - y0) * TILE, TILE, TILE);

  const out = document.createElement('canvas');
  out.width = out.height = N;
  const g = out.getContext('2d');
  const sx = (tileX(b.minLon, z) - x0) * TILE;
  const sw = (tileX(b.maxLon, z) - tileX(b.minLon, z)) * TILE;
  for (let r = 0; r < N; r++) {
    const lat = b.maxLat - ((r + 0.5) / N) * (b.maxLat - b.minLat);
    g.drawImage(mosaic, sx, (tileY(lat, z) - y0) * TILE, sw, 1, 0, r, N, 1);
  }
  return out;
}

// ---------------------------------------------------------------- painting

const bboxCache = new WeakMap();
function stateAnchor(st) {
  let a = bboxCache.get(st);
  if (a) return a;
  let best = null;
  for (const poly of st.polygons) {
    let minX = 999, maxX = -999, minY = 999, maxY = -999;
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area > best.area) best = { area, lon: (minX + maxX) / 2, lat: (minY + maxY) / 2 };
  }
  a = best || { area: 0, lon: 0, lat: 0 };
  bboxCache.set(st, a);
  return a;
}

const overlaps = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);

function chip(g, x, y, w, h, fill, stroke) {
  g.beginPath();
  g.roundRect(x, y, w, h, 8);
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
}

/**
 * Paint one plate.
 * opts: bounds, chosen {row,col}, color (THREE.Color), states, land, tiles (canvas|null),
 *       point {lat, lon, label}, caption (string)
 */
export function paintPlate(canvas, opts) {
  const { bounds: b, chosen, color, states, land, tiles, point, caption } = opts;
  const N = canvas.width;
  const g = canvas.getContext('2d');
  const span = b.maxLon - b.minLon;
  const px = (lon) => ((lon - b.minLon) / span) * N;
  const py = (lat) => ((b.maxLat - lat) / span) * N;
  const hex = `#${color.getHexString()}`;
  const trace = (rings) => {
    g.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], i) => (i ? g.lineTo(px(lon), py(lat)) : g.moveTo(px(lon), py(lat))));
      g.closePath();
    }
  };

  g.clearRect(0, 0, N, N);
  g.fillStyle = '#1d0609';
  g.fillRect(0, 0, N, N);

  // ---- base map
  g.lineJoin = 'round';
  if (tiles) {
    g.drawImage(tiles, 0, 0);
    g.fillStyle = 'rgba(70, 10, 14, 0.2)';
    g.fillRect(0, 0, N, N);
  } else {
    if (land) {
      g.fillStyle = 'rgba(130, 88, 52, 0.55)';
      g.strokeStyle = 'rgba(255, 226, 170, 0.25)';
      g.lineWidth = 1.2;
      for (const rings of land) { trace(rings); g.fill('evenodd'); g.stroke(); }
    }
    g.fillStyle = 'rgba(190, 74, 42, 0.8)';
    g.strokeStyle = 'rgba(255, 228, 170, 0.8)';
    g.lineWidth = span > 20 ? 1.3 : 2;
    for (const st of states) for (const poly of st.polygons) { trace(poly); g.fill('evenodd'); g.stroke(); }
  }
  if (tiles) {
    g.strokeStyle = 'rgba(227, 30, 36, 0.85)';
    g.lineWidth = 3;
    for (const st of states) for (const poly of st.polygons) { trace(poly); g.stroke(); }
  }

  // ---- DIGIPIN grid + chosen cell
  const cell = N / 4;
  g.globalAlpha = 0.3;
  g.fillStyle = hex;
  g.fillRect(chosen.col * cell, chosen.row * cell, cell, cell);
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(255, 194, 14, 0.9)';
  g.lineWidth = 2.5;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, N); g.stroke();
    g.beginPath(); g.moveTo(0, i * cell); g.lineTo(N, i * cell); g.stroke();
  }
  g.strokeStyle = hex;
  g.lineWidth = 7;
  g.strokeRect(chosen.col * cell + 4, chosen.row * cell + 4, cell - 8, cell - 8);

  // ---- labels (collision-aware)
  const taken = [];
  const free = (r) => r.x > 4 && r.y > 4 && r.x + r.w < N - 4 && r.y + r.h < N - 4 && !taken.some((t) => overlaps(r, t));
  const reserve = (r) => { taken.push(r); return r; };

  // reserve the corners used by the cell letters, caption and north arrow
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) reserve({ x: c * cell, y: r * cell, w: 62, h: 62 });
  reserve({ x: 0, y: N - 62, w: N, h: 62 });
  reserve({ x: N - 80, y: 0, w: 80, h: 70 });

  // selected point (reserved first so city labels avoid it)
  let marker = null;
  if (point) {
    const mx = px(point.lon);
    const my = py(point.lat);
    g.font = `700 27px ${FONT}`;
    const tw = Math.min(g.measureText(point.label).width, N * 0.5);
    const w = tw + 22;
    const h = 40;
    let x = mx + 22;
    if (x + w > N - 6) x = mx - 22 - w;
    let y = my - h - 8;
    if (y < 6) y = my + 12;
    marker = { mx, my, x, y, w, h, tw };
    taken.push({ x: mx - 18, y: my - 18, w: 36, h: 36 }, { x, y, w, h });
  }

  // city / place names inside the area
  const inset = span * 0.03;
  const cities = CITIES
    .filter((c) => c.lat > b.minLat + inset && c.lat < b.maxLat - inset && c.lon > b.minLon + inset && c.lon < b.maxLon - inset)
    .filter((c) => span > 20 ? c.major : true)
    .sort((a, c) => Number(Boolean(c.major)) - Number(Boolean(a.major)));
  const fs = span > 20 ? 21 : 26;
  g.font = `600 ${fs}px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (const c of cities) {
    const x = px(c.lon);
    const y = py(c.lat);
    const w = g.measureText(c.name).width + 14;
    let rect = { x: x + 10, y: y - fs / 2 - 3, w, h: fs + 6 };
    if (!free(rect)) rect = { x: x - 10 - w, y: y - fs / 2 - 3, w, h: fs + 6 };
    if (!free(rect)) continue;
    reserve(rect);
    g.fillStyle = 'rgba(24, 5, 8, 0.62)';
    g.beginPath(); g.roundRect(rect.x, rect.y, rect.w, rect.h, 6); g.fill();
    g.fillStyle = '#ffe9b8';
    g.fillText(c.name, rect.x + 7, rect.y + rect.h / 2 + 1);
    g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2);
    g.fillStyle = '#ffc20e'; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#2a0508'; g.stroke();
  }

  // state names on the wide levels
  if (span >= 8) {
    const sfs = span > 20 ? 16 : 22;
    g.font = `700 ${sfs}px ${FONT}`;
    g.textAlign = 'center';
    const list = states
      .map((st) => ({ st, a: stateAnchor(st) }))
      .filter(({ a }) => a.lon > b.minLon && a.lon < b.maxLon && a.lat > b.minLat && a.lat < b.maxLat && a.area > (span > 20 ? 4 : 0.6))
      .sort((p, q) => q.a.area - p.a.area);
    for (const { st, a } of list) {
      const name = st.name.toUpperCase();
      const w = g.measureText(name).width + 10;
      const rect = { x: px(a.lon) - w / 2, y: py(a.lat) - sfs / 2 - 2, w, h: sfs + 4 };
      if (!free(rect)) continue;
      reserve(rect);
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(30, 6, 10, 0.85)';
      g.strokeText(name, px(a.lon), py(a.lat));
      g.fillStyle = 'rgba(255, 244, 230, 0.92)';
      g.fillText(name, px(a.lon), py(a.lat));
    }
  }

  // selected point on top
  if (marker) {
    const { mx, my, x, y, w, h } = marker;
    g.beginPath(); g.arc(mx, my, 15, 0, Math.PI * 2);
    g.fillStyle = 'rgba(227, 30, 36, 0.35)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#ffc20e'; g.stroke();
    g.beginPath(); g.arc(mx, my, 6, 0, Math.PI * 2);
    g.fillStyle = '#ffffff'; g.fill();
    chip(g, x, y, w, h, '#e31e24', '#ffc20e');
    g.font = `700 27px ${FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillText(point.label, x + 11, y + h / 2 + 1);
    g.restore();
  }

  // ---- cell letters (top-left of every cell)
  g.font = `700 32px ${MONO}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const on = r === chosen.row && c === chosen.col;
      chip(g, c * cell + 8, r * cell + 8, 46, 46, on ? hex : 'rgba(30, 6, 10, 0.78)', on ? null : 'rgba(255, 194, 14, 0.45)');
      g.fillStyle = on ? '#2a0508' : '#ffe9b8';
      g.fillText(opts.grid[r][c], c * cell + 31, r * cell + 32);
    }
  }

  // ---- caption, north arrow, attribution
  if (caption) {
    g.font = `700 30px ${FONT}`;
    g.textAlign = 'left';
    const w = Math.min(g.measureText(caption).width + 26, N - 24);
    chip(g, 12, N - 54, w, 42, 'rgba(30, 6, 10, 0.88)', hex);
    g.fillStyle = '#fff4e6';
    g.save();
    g.beginPath(); g.rect(12, N - 54, w, 42); g.clip();
    g.fillText(caption, 25, N - 32);
    g.restore();
  }
  g.font = `700 24px ${FONT}`;
  g.textAlign = 'center';
  chip(g, N - 62, 10, 50, 56, 'rgba(30, 6, 10, 0.78)', 'rgba(255, 194, 14, 0.5)');
  g.fillStyle = '#ffc20e';
  g.fillText('N', N - 37, 51);
  g.beginPath(); g.moveTo(N - 37, 14); g.lineTo(N - 47, 36); g.lineTo(N - 27, 36); g.closePath(); g.fill();
  if (tiles) {
    g.font = `500 15px ${FONT}`;
    g.textAlign = 'right';
    g.fillStyle = 'rgba(255, 244, 230, 0.85)';
    g.fillText('© OpenStreetMap contributors', N - 12, N - 14);
  }
}
