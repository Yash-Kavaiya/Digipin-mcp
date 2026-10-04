/**
 * Builds the compact geodata used by the 3D website.
 *
 *   node scripts/build-geodata.mjs
 *
 * Inputs  (downloaded once, not committed):
 *   web/data/_alt.json            datameet India states GeoJSON
 *   node_modules/world-atlas      Natural Earth 110m world topology
 * Outputs (committed):
 *   web/data/india-states.json    simplified state polygons
 *   web/data/world.json           simplified land + country borders
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';

const round = (n, d) => Number(n.toFixed(d));

/** Perpendicular distance squared from p to segment ab (planar, degrees). */
function segDist2(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker (iterative). */
function simplify(points, tol) {
  if (points.length <= 2) return points;
  const t2 = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = t2;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segDist2(points[i], points[first], points[last]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx !== -1) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

function processPolygons(geometry, tol, minArea, minAreaHole) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const out = [];
  for (const poly of polys) {
    const rings = [];
    poly.forEach((ring, i) => {
      const s = simplify(ring, tol);
      if (s.length < 4) return;
      const area = ringArea(s);
      if (area < (i === 0 ? minArea : minAreaHole)) return;
      rings.push(s.map(([x, y]) => [round(x, 3), round(y, 3)]));
    });
    if (rings.length && poly[0]) {
      // outer ring must survive for the polygon to count
      if (ringArea(rings[0]) >= minArea) out.push(rings);
    }
  }
  return out;
}

// ---- India states ---------------------------------------------------------
const NAME_FIX = {
  'Andaman & Nicobar Island': 'Andaman & Nicobar Islands',
  'Arunanchal Pradesh': 'Arunachal Pradesh',
  'Dadara & Nagar Havelli': 'Dadra & Nagar Haveli',
  'Daman & Diu': 'Daman & Diu',
  'NCT of Delhi': 'Delhi',
  'Jammu & Kashmir': 'Jammu & Kashmir and Ladakh'
};
const ISLAND_STATES = new Set(['Andaman & Nicobar Islands', 'Lakshadweep']);

const rawPath = 'web/data/_alt.json';
if (!existsSync(rawPath)) {
  console.error(`Missing ${rawPath}. Download it with:\n  curl -L -o ${rawPath} https://raw.githubusercontent.com/datameet/maps/master/website/docs/data/geojson/states.geojson`);
  process.exit(1);
}
const states = JSON.parse(readFileSync(rawPath, 'utf8'));
const outStates = states.features.map((f) => {
  const name = NAME_FIX[f.properties.ST_NM] ?? f.properties.ST_NM;
  const island = ISLAND_STATES.has(name);
  const polygons = processPolygons(f.geometry, 0.02, island ? 0.0003 : 0.003, 0.02);
  return { name, polygons };
}).filter((s) => s.polygons.length);

writeFileSync('web/data/india-states.json', JSON.stringify(outStates));
console.log('india-states.json', outStates.length, 'states');

// ---- World ----------------------------------------------------------------
const topo = JSON.parse(readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'));
const land = feature(topo, topo.objects.land ?? topo.objects.countries);
const landGeoms = land.type === 'FeatureCollection' ? land.features.map((f) => f.geometry) : [land.geometry];
const landPolys = [];
for (const g of landGeoms) landPolys.push(...processPolygons(g, 0.05, 0.1, 1));
const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
const lines = borders.type === 'MultiLineString' ? borders.coordinates : [borders.coordinates];
const outLines = lines
  .map((l) => simplify(l, 0.05).map(([x, y]) => [round(x, 2), round(y, 2)]))
  .filter((l) => l.length > 1);
writeFileSync('web/data/world.json', JSON.stringify({ land: landPolys, borders: outLines }));
console.log('world.json', landPolys.length, 'land polygons,', outLines.length, 'border lines');
