/**
 * Network lookups for PIN codes and places.
 *
 *  - OpenStreetMap Nominatim  : place search + reverse geocoding (CORS enabled)
 *  - api.postalpincode.in     : India Post office directory (PIN <-> post offices)
 *
 * Every function degrades gracefully: callers get `null`/[] on failure and the UI
 * falls back to the built-in city hubs (cities.js).
 */
import { CITIES } from './cities.js';
import { nearest } from './geo.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const POSTAL = 'https://api.postalpincode.in';
const TIMEOUT_MS = 9000;

const cache = new Map();

async function getJSON(url, signal) {
  if (cache.has(url)) return cache.get(url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache.set(url, json);
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Extract the first valid 6-digit Indian PIN from a free-form postcode string. */
export function normalizePostcode(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(?<!\d)([1-9]\d{2})\s?(\d{3})(?!\d)/);
  return m ? m[1] + m[2] : null;
}

function addrParts(address = {}) {
  return {
    locality: address.neighbourhood || address.suburb || address.hamlet || address.village || address.city_district || '',
    city: address.city || address.town || address.municipality || address.county || '',
    district: address.state_district || address.county || '',
    state: address.state || ''
  };
}

function shapePlace(p) {
  const a = p.address || {};
  const parts = addrParts(a);
  return {
    lat: parseFloat(p.lat),
    lon: parseFloat(p.lon),
    name: p.name || parts.locality || parts.city || String(p.display_name || '').split(',')[0],
    display: p.display_name,
    pin: normalizePostcode(a.postcode),
    state: parts.state,
    district: parts.district,
    city: parts.city,
    locality: parts.locality
  };
}

/** Free-text place search (India only). */
export async function searchPlaces(query, signal) {
  const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(query)}`;
  try {
    const rows = await getJSON(url, signal);
    return rows.map(shapePlace).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return [];
  }
}

/** Reverse geocode a point. */
export async function reverseGeocode(lat, lon, signal) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
  try {
    const row = await getJSON(url, signal);
    if (!row || row.error) return null;
    return shapePlace(row);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return null;
  }
}

function shapeOffices(list = []) {
  return list.map((o) => ({
    name: o.Name,
    branchType: o.BranchType,
    delivery: o.DeliveryStatus,
    district: o.District,
    state: o.State,
    block: o.Block || o.Division,
    circle: o.Circle,
    pin: o.Pincode
  }));
}

/** India Post directory entry for a PIN. */
export async function pinInfo(pin, signal) {
  try {
    const data = await getJSON(`${POSTAL}/pincode/${pin}`, signal);
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || row.Status !== 'Success' || !row.PostOffice?.length) return null;
    const offices = shapeOffices(row.PostOffice);
    return { pin, offices, state: offices[0].state, district: offices[0].district };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return null;
  }
}

/** Post offices whose name matches `name` (used to recover a PIN from a locality name). */
export async function postOfficesByName(name, signal) {
  try {
    const data = await getJSON(`${POSTAL}/postoffice/${encodeURIComponent(name)}`, signal);
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || row.Status !== 'Success') return [];
    return shapeOffices(row.PostOffice);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return [];
  }
}

const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const sameArea = (a, b) => {
  const x = loose(a);
  const y = loose(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

/**
 * Work out the PIN for a coordinate.
 * Order: OSM postcode -> India Post office-name match -> nearest built-in hub (flagged approximate).
 * @returns {Promise<{pin:string|null, method:string, approx:boolean, place:object|null, hub?:object, hubKm?:number}>}
 */
export async function resolvePinForPoint(lat, lon, signal) {
  const place = await reverseGeocode(lat, lon, signal);
  if (place?.pin) return { pin: place.pin, method: 'OpenStreetMap postcode', approx: false, place };

  if (place) {
    const names = [place.locality, place.city, place.district].filter(Boolean);
    for (const n of [...new Set(names)].slice(0, 3)) {
      const offices = await postOfficesByName(n, signal);
      const match = offices.find((o) => sameArea(o.state, place.state) && (sameArea(o.district, place.district) || sameArea(o.district, place.city)))
        || offices.find((o) => sameArea(o.state, place.state));
      if (match?.pin) return { pin: match.pin, method: 'India Post office match', approx: false, place };
    }
  }

  const hub = nearest(CITIES, lat, lon);
  if (hub) {
    return { pin: hub.item.pin, method: `Nearest hub: ${hub.item.name}`, approx: true, place, hub: hub.item, hubKm: hub.km };
  }
  return { pin: null, method: 'unavailable', approx: true, place };
}

/** Coordinates for a PIN code (Nominatim postal-code search, then post-office name search). */
export async function pinToLocation(pin, signal) {
  try {
    const rows = await getJSON(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=in&postalcode=${pin}`, signal);
    if (rows?.length) return { ...shapePlace(rows[0]), pin, method: 'OpenStreetMap postal code' };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }
  const info = await pinInfo(pin, signal);
  if (info) {
    const o = info.offices[0];
    const q = `${o.name}, ${o.district}, ${o.state}, India`;
    const places = await searchPlaces(q, signal);
    if (places[0]) return { ...places[0], pin, method: `Post office: ${o.name}` };
    const dp = await searchPlaces(`${o.district}, ${o.state}`, signal);
    if (dp[0]) return { ...dp[0], pin, method: `District centre: ${o.district}` };
  }
  return null;
}
