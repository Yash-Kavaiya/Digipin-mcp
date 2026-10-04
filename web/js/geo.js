/** Pure geometry helpers shared by the 3D views (no THREE import so they are testable in Node). */

const DEG = Math.PI / 180;

/**
 * Lat/lon -> point on a sphere, using the same convention as THREE.SphereGeometry
 * so that an equirectangular texture lines up with the mesh.
 * @returns {[number, number, number]} [x, y, z]
 */
export function latLonToXYZ(lat, lon, r = 1) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

/** Inverse of latLonToXYZ (input need not be unit length). */
export function xyzToLatLon(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, y / r))) / DEG;
  let lon = Math.atan2(z, -x) / DEG - 180;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray-casting point-in-ring test; ring is [[lon,lat],...]. */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** polygon = [outerRing, ...holes] */
export function pointInPolygon(lon, lat, polygon) {
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) if (pointInRing(lon, lat, polygon[i])) return false;
  return true;
}

export function ringBBox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Nearest item in `items` (each with lat/lon) to a point. */
export function nearest(items, lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const it of items) {
    const d = haversineKm(lat, lon, it.lat, it.lon);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best ? { item: best, km: bestD } : null;
}

export function formatCoord(lat, lon, digits = 6) {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`;
}
