import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../web/js/digipin.js';
import * as ref from '../dist/digipin.js';
import { latLonToXYZ, xyzToLatLon, haversineKm, pointInPolygon } from '../web/js/geo.js';
import { normalizePostcode } from '../web/js/api.js';
import { CITIES } from '../web/js/cities.js';

test('spec example: Dak Bhawan, New Delhi', () => {
  assert.equal(web.encode(28.622788, 77.213033), '39J-49L-L8T4');
  const d = web.decode('39J-49L-L8T4');
  assert.ok(Math.abs(d.lat - 28.622788) < 5e-5);
  assert.ok(Math.abs(d.lon - 77.213033) < 5e-5);
});

test('web encoder matches the MCP server implementation on 30k random points', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 30000; i++) {
    const lat = 2.5 + rnd() * 36;
    const lon = 63.5 + rnd() * 36;
    assert.equal(web.encode(lat, lon), ref.encodeDIGIPIN(lat, lon), `mismatch at ${lat},${lon}`);
  }
});

test('web decoder matches the MCP server implementation', () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 3000; i++) {
    const code = web.encode(2.5 + rnd() * 36, 63.5 + rnd() * 36);
    const a = web.decode(code);
    const b = ref.decodeDIGIPIN(code);
    assert.equal(a.lat, b.lat);
    assert.equal(a.lon, b.lon);
  }
});

test('encode(decode(x)) round-trips and cell is ~4 m', () => {
  for (const [lat, lon] of [[28.6139, 77.209], [8.0883, 77.5385], [34.1526, 77.5771], [11.6234, 92.7265], [23.0225, 72.5714]]) {
    const code = web.encode(lat, lon);
    const d = web.decode(code);
    assert.equal(web.encode(d.lat, d.lon), code);
    assert.ok(haversineKm(lat, lon, d.lat, d.lon) * 1000 < 4, 'centre within one cell');
    const b = d.bounds;
    assert.ok(lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon);
    assert.ok((b.maxLat - b.minLat) * 111320 < 4.1);
  }
});

test('coverage edges are valid and out-of-range throws', () => {
  assert.doesNotThrow(() => web.encode(2.5, 63.5));
  assert.doesNotThrow(() => web.encode(38.5, 99.5));
  assert.doesNotThrow(() => web.encode(2.5, 99.5));
  assert.throws(() => web.encode(2.4, 77));
  assert.throws(() => web.encode(20, 100));
  assert.throws(() => web.encode(NaN, 77));
});

test('prefix bounds nest and shrink by 4x per level', () => {
  const code = web.encode(19.076, 72.8777);
  let prev = web.boundsOf('');
  for (let i = 1; i <= 10; i++) {
    const b = web.boundsOf(code.replace(/-/g, '').slice(0, i));
    assert.ok(b.minLat >= prev.minLat - 1e-12 && b.maxLat <= prev.maxLat + 1e-12);
    assert.ok(b.minLon >= prev.minLon - 1e-12 && b.maxLon <= prev.maxLon + 1e-12);
    assert.ok(Math.abs((b.maxLat - b.minLat) - 36 / 4 ** i) < 1e-9);
    prev = b;
  }
});

test('validation', () => {
  assert.equal(web.validate('39J-49L-L8T4').valid, true);
  assert.equal(web.validate('39J49LL8T4').valid, true);
  assert.equal(web.validate('39J-49L-L8T').valid, false);
  assert.equal(web.validate('39J-49L-L8TZ').valid, false);
  assert.equal(web.validate('39J-49L-L8T0').valid, false);
});

test('parseInput classifies search text', () => {
  assert.deepEqual(web.parseInput('39j-49l-l8t4'), { type: 'digipin', code: '39J-49L-L8T4' });
  assert.deepEqual(web.parseInput('39J49LL8T4'), { type: 'digipin', code: '39J-49L-L8T4' });
  assert.deepEqual(web.parseInput('110001'), { type: 'pin', pin: '110001' });
  assert.deepEqual(web.parseInput('110 001'), { type: 'pin', pin: '110001' });
  assert.deepEqual(web.parseInput('28.6139, 77.2090'), { type: 'latlon', lat: 28.6139, lon: 77.209 });
  assert.deepEqual(web.parseInput('77.209, 28.6139'), { type: 'latlon', lat: 28.6139, lon: 77.209 });
  assert.equal(web.parseInput('Connaught Place Delhi').type, 'place');
  assert.equal(web.parseInput('Chandigarh').type, 'place');
  assert.equal(web.parseInput('012345').type, 'place'); // PINs never start with 0
  assert.equal(web.parseInput('  ').type, 'empty');
});

test('sphere mapping round-trips', () => {
  for (const [lat, lon] of [[0, 0], [28.6, 77.2], [-33.9, 151.2], [60, -120], [8, 77.5]]) {
    const [x, y, z] = latLonToXYZ(lat, lon, 1.7);
    const back = xyzToLatLon(x, y, z);
    assert.ok(Math.abs(back.lat - lat) < 1e-9 && Math.abs(back.lon - lon) < 1e-9, `${lat},${lon} -> ${back.lat},${back.lon}`);
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1.7) < 1e-9);
  }
});

test('point in polygon with hole', () => {
  const poly = [[[0, 0], [10, 0], [10, 10], [0, 10]], [[4, 4], [6, 4], [6, 6], [4, 6]]];
  assert.equal(pointInPolygon(2, 2, poly), true);
  assert.equal(pointInPolygon(5, 5, poly), false);
  assert.equal(pointInPolygon(11, 5, poly), false);
});

test('postcode normalisation', () => {
  assert.equal(normalizePostcode('110001'), '110001');
  assert.equal(normalizePostcode('110 001'), '110001');
  assert.equal(normalizePostcode('110001;110002'), '110001');
  assert.equal(normalizePostcode('SW1A 1AA'), null);
  assert.equal(normalizePostcode('012345'), null);
  assert.equal(normalizePostcode(undefined), null);
});

test('built-in city hubs are inside DIGIPIN coverage with valid PINs', () => {
  for (const c of CITIES) {
    assert.match(c.pin, /^[1-9]\d{5}$/, c.name);
    assert.equal(web.validateCoordinates(c.lat, c.lon).valid, true, c.name);
  }
});

test('geodata files are present and well-formed', async () => {
  const { readFile } = await import('node:fs/promises');
  const states = JSON.parse(await readFile(new URL('../web/data/india-states.json', import.meta.url), 'utf8'));
  const world = JSON.parse(await readFile(new URL('../web/data/world.json', import.meta.url), 'utf8'));
  assert.ok(states.length >= 30);
  for (const s of states) {
    assert.ok(s.name && s.polygons.length, s.name);
    for (const poly of s.polygons) assert.ok(poly[0].length >= 4, s.name);
  }
  assert.ok(world.land.length > 50 && world.borders.length > 50);
});

// ---------------------------------------------------------------- funnel inside India 3D
import { readFileSync } from 'node:fs';
import { wantsTiles } from '../web/js/views/platemap.js';
import { renderCrumbs, renderFunnelBar } from '../web/js/ui.js';

test('street tiles are only requested for zoomed-in funnel plates', () => {
  const spans = [36, 9, 2.25, 0.5625].map((s) => ({ minLon: 70, maxLon: 70 + s }));
  assert.deepEqual(spans.map(wantsTiles), [false, false, true, true]);
});

test('India 3D crumbs offer the funnel; the funnel bar offers the way back', () => {
  assert.match(renderCrumbs('39J', 4), /data-mode="funnel"/);
  assert.match(renderCrumbs('39J', 4), /data-focus="39J"/);
  const bar = renderFunnelBar('39J49LL8T4');
  assert.match(bar, /data-mode="map"/);
  assert.match(bar, /39J-49L-L8T4/);
});

test('page has exactly two view tabs (funnel is part of India 3D) and a disclaimer', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const tabs = [...html.matchAll(/role="tab" data-view="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['globe', 'india']);
  assert.match(html, /id="disclaimer"/);
  assert.match(html, /disclaimer-note/);
});
