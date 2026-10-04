/**
 * DIGIPIN core (browser + Node), mirrors src/digipin.ts and adds the helpers the
 * 3D site needs (cell bounds for any prefix, input parsing).
 *
 * Spec: Department of Posts DIGIPIN technical document (March 2025).
 * 10 levels, 4x4 grid per level, bounding box 2.5-38.5 N / 63.5-99.5 E.
 */

export const GRID = [
  ['F', 'C', '9', '8'],
  ['J', '3', '2', '7'],
  ['K', '4', '5', '6'],
  ['L', 'M', 'P', 'T']
];

export const BOUNDS = Object.freeze({ minLat: 2.5, maxLat: 38.5, minLon: 63.5, maxLon: 99.5 });
export const LEVELS = 10;
const DIV = 4;
const CHARS = new Set(GRID.flat());

/** @returns {{valid:boolean,error?:string}} */
export function validateCoordinates(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { valid: false, error: 'Latitude and longitude must be numbers' };
  }
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat) {
    return { valid: false, error: `Latitude ${lat} is outside DIGIPIN coverage (${BOUNDS.minLat}° to ${BOUNDS.maxLat}° N)` };
  }
  if (lon < BOUNDS.minLon || lon > BOUNDS.maxLon) {
    return { valid: false, error: `Longitude ${lon} is outside DIGIPIN coverage (${BOUNDS.minLon}° to ${BOUNDS.maxLon}° E)` };
  }
  return { valid: true };
}

/** Insert hyphens: XXX-XXX-XXXX (works for partial codes too). */
export function formatDigipin(code) {
  const c = clean(code);
  const parts = [c.slice(0, 3), c.slice(3, 6), c.slice(6, 10)].filter(Boolean);
  return parts.join('-');
}

export function clean(code) {
  return String(code ?? '').replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Encode lat/lon to a 10-character DIGIPIN (hyphenated).
 * Throws if the point is outside the coverage box.
 */
export function encode(lat, lon) {
  const v = validateCoordinates(lat, lon);
  if (!v.valid) throw new Error(v.error);

  let minLat = BOUNDS.minLat;
  let maxLat = BOUNDS.maxLat;
  let minLon = BOUNDS.minLon;
  let maxLon = BOUNDS.maxLon;
  let out = '';

  for (let level = 1; level <= LEVELS; level++) {
    const latDiv = (maxLat - minLat) / DIV;
    const lonDiv = (maxLon - minLon) / DIV;

    let row = DIV - 1; // lat === minLat falls into the last row
    let nextMaxLat = maxLat;
    let nextMinLat = maxLat - latDiv;
    for (let x = 0; x < DIV; x++) {
      if (lat >= nextMinLat && lat < nextMaxLat) { row = x; break; }
      if (x < DIV - 1) { nextMaxLat = nextMinLat; nextMinLat = nextMaxLat - latDiv; }
    }

    let col = DIV - 1; // lon === maxLon falls into the last column
    let nextMinLon = minLon;
    let nextMaxLon = minLon + lonDiv;
    for (let x = 0; x < DIV; x++) {
      if (lon >= nextMinLon && lon < nextMaxLon) { col = x; break; }
      if (x < DIV - 1) { nextMinLon = nextMaxLon; nextMaxLon = nextMinLon + lonDiv; }
    }

    out += GRID[row][col];
    maxLat = nextMaxLat;
    minLat = nextMinLat;
    minLon = nextMinLon;
    maxLon = nextMaxLon;
  }
  return formatDigipin(out);
}

/** Row/col of a DIGIPIN character in the labelling grid, or null. */
export function charToCell(ch) {
  for (let r = 0; r < DIV; r++) {
    for (let c = 0; c < DIV; c++) if (GRID[r][c] === ch) return { row: r, col: c };
  }
  return null;
}

export function validate(code) {
  const c = clean(code);
  if (c.length !== LEVELS) {
    return { valid: false, error: `A DIGIPIN has ${LEVELS} characters (got ${c.length})` };
  }
  for (let i = 0; i < c.length; i++) {
    if (!CHARS.has(c[i])) return { valid: false, error: `Invalid character '${c[i]}' at position ${i + 1}` };
  }
  return { valid: true };
}

/**
 * Bounding box of the cell identified by a (possibly partial) DIGIPIN prefix.
 * An empty prefix returns the whole coverage box.
 */
export function boundsOf(prefix) {
  const c = clean(prefix);
  if (c.length > LEVELS) throw new Error(`DIGIPIN prefix too long (${c.length})`);
  let { minLat, maxLat, minLon, maxLon } = BOUNDS;
  for (let i = 0; i < c.length; i++) {
    const cell = charToCell(c[i]);
    if (!cell) throw new Error(`Invalid character '${c[i]}' at position ${i + 1}`);
    const latDiv = (maxLat - minLat) / DIV;
    const lonDiv = (maxLon - minLon) / DIV;
    const lat1 = maxLat - latDiv * (cell.row + 1);
    const lon1 = minLon + lonDiv * cell.col;
    maxLat = lat1 + latDiv;
    minLat = lat1;
    maxLon = lon1 + lonDiv;
    minLon = lon1;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/** Decode a full DIGIPIN to the centre of its cell (+ the cell bounds). */
export function decode(code) {
  const v = validate(code);
  if (!v.valid) throw new Error(v.error);
  const b = boundsOf(code);
  return {
    lat: Number(((b.minLat + b.maxLat) / 2).toFixed(6)),
    lon: Number(((b.minLon + b.maxLon) / 2).toFixed(6)),
    bounds: b
  };
}

/** Child cell bounds for one of the 16 characters under `prefix`. */
export function childBounds(prefix, ch) {
  return boundsOf(clean(prefix) + ch);
}

/** Approximate edge length of a level-n cell in metres (at the equator-ish; lat scaled by cos). */
export function cellSizeMeters(level, atLat = 20) {
  const deg = (BOUNDS.maxLat - BOUNDS.minLat) / Math.pow(DIV, level);
  const mLat = deg * 111_320;
  const mLon = deg * 111_320 * Math.cos((atLat * Math.PI) / 180);
  return { degrees: deg, northSouth: mLat, eastWest: mLon };
}

/** "9.0°  ≈ 1,000 km" style label for a level. */
export function cellSizeLabel(level, atLat = 20) {
  const { degrees, northSouth } = cellSizeMeters(level, atLat);
  const dist = northSouth >= 1000 ? `${Math.round(northSouth / 1000).toLocaleString('en-IN')} km` : `${northSouth.toFixed(northSouth < 10 ? 1 : 0)} m`;
  const deg = degrees >= 0.01 ? degrees.toFixed(degrees >= 1 ? 2 : 3) : degrees.toExponential(1);
  return { degrees: `${deg}°`, distance: `≈ ${dist}` };
}

const DIGIPIN_RE = /^[FCJKLMPT2-9]{3}-?[FCJKLMPT2-9]{3}-?[FCJKLMPT2-9]{4}$/i;

/**
 * Classify free-text input from the search bar.
 * @returns {{type:'digipin',code:string}|{type:'pin',pin:string}|{type:'latlon',lat:number,lon:number}|{type:'place',query:string}|{type:'empty'}}
 */
export function parseInput(text) {
  const t = String(text ?? '').trim();
  if (!t) return { type: 'empty' };
  if (DIGIPIN_RE.test(t.replace(/\s+/g, ''))) {
    return { type: 'digipin', code: formatDigipin(t) };
  }
  const pin = t.replace(/\s+/g, '');
  if (/^[1-9]\d{5}$/.test(pin)) return { type: 'pin', pin };
  const ll = t.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*°?\s*[N,]?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*E?\s*\)?$/i);
  if (ll) {
    let a = parseFloat(ll[1]);
    let b = parseFloat(ll[2]);
    // India: lat < lon always; accept "lon, lat" if the user swapped them.
    if (a > 38.5 && b <= 38.5) [a, b] = [b, a];
    return { type: 'latlon', lat: a, lon: b };
  }
  return { type: 'place', query: t };
}
