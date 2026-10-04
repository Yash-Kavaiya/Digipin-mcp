import * as THREE from 'three';
import { GlobeView } from './views/globe.js';
import { IndiaView } from './views/india.js';
import { LayersView } from './views/layers.js';
import { GRID, boundsOf, clean, decode, encode, formatDigipin, parseInput, validate, validateCoordinates } from './digipin.js';
import { pinInfo, pinToLocation, resolvePinForPoint, reverseGeocode, searchPlaces } from './api.js';
import { CITIES, LANDMARKS } from './cities.js';
import { renderCrumbs, renderFunnelBar, renderError, renderHistory, renderMatches, renderResult } from './ui.js';

// Collect runtime problems so they are easy to inspect (window.__errors) when debugging.
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));
const origError = console.error;
console.error = (...args) => { window.__errors.push(args.map(String).join(' ')); origError.apply(console, args); };

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const els = {
  canvas: $('#stage'),
  loader: $('#loader'),
  form: $('#search-form'),
  q: $('#q'),
  detect: $('#detect'),
  chips: $('#chips'),
  matches: $('#matches'),
  result: $('#result'),
  history: $('#history'),
  historyList: $('#history-list'),
  hud: $('#hud'),
  hudLL: $('#hud-ll'),
  hudDP: $('#hud-dp'),
  hudState: $('#hud-state'),
  crumbs: $('#crumbs'),
  legendGrid: $('#legend-grid'),
  toast: $('#toast'),
  help: $('#help'),
  panel: $('#panel')
};

const app = {
  views: {},
  current: null,
  indiaMode: 'map', // 'map' | 'funnel' (the 10-level zoom funnel is part of the India 3D tab)
  sel: null,
  matches: [],
  reqId: 0,
  abort: null
};
window.__atlas = app; // handy for debugging / tests

// ---------------------------------------------------------------- helpers
function toast(msg, error = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', error);
  els.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.remove('show'), 3600);
}

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------- selection
function renderCard() {
  els.result.innerHTML = app.sel ? renderResult(app.sel) : els.result.innerHTML;
}

function showError(title, message) {
  els.result.innerHTML = renderError(title, message);
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('digipin-atlas-history') || '[]'); } catch { return []; }
}
function saveHistory(sel) {
  const list = loadHistory().filter((h) => h.digipin !== sel.digipin);
  list.unshift({ digipin: sel.digipin, pin: sel.pin || '', label: sel.place?.name || '' });
  try { localStorage.setItem('digipin-atlas-history', JSON.stringify(list.slice(0, 8))); } catch { /* storage may be blocked */ }
  renderHistoryList();
}
function renderHistoryList() {
  const list = loadHistory();
  els.history.hidden = !list.length;
  els.historyList.innerHTML = renderHistory(list);
}

function highlightLegend(ch) {
  els.legendGrid.querySelectorAll('span').forEach((s) => s.classList.toggle('on', s.textContent === ch));
}

function pushViews(sel) {
  for (const v of Object.values(app.views)) v.setSelection(sel);
  if (app.current === app.views.layers) updateIndiaBar();
}

function setHash(sel) {
  if (!sel) return;
  const hash = `#d=${sel.digipin}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

/**
 * Central entry point: every way of choosing a place ends up here.
 * DIGIPIN is computed instantly; PIN code + address are enriched asynchronously.
 */
async function selectPoint(lat, lon, opts = {}) {
  const v = validateCoordinates(lat, lon);
  if (!v.valid) {
    showError('Outside DIGIPIN coverage', `${v.error}. DIGIPIN covers India and its surrounding seas only.`);
    toast('That point is outside DIGIPIN coverage', true);
    return;
  }
  app.abort?.abort();
  app.abort = new AbortController();
  const { signal } = app.abort;
  const id = ++app.reqId;

  const place = opts.place || null;
  const sel = {
    lat,
    lon,
    digipin: opts.digipin ? formatDigipin(opts.digipin) : encode(lat, lon),
    source: opts.source || 'search',
    place,
    pin: opts.pin || null,
    pinMethod: opts.pinMethod || (opts.pin ? 'OpenStreetMap postcode' : null),
    pinApprox: false,
    pinStatus: opts.pin ? 'done' : 'loading',
    offices: opts.offices || [],
    state: opts.state || place?.state || '',
    district: opts.district || place?.district || '',
    addressLoading: !place
  };
  app.sel = sel;
  setHash(sel);
  highlightLegend(sel.digipin[0]);
  renderCard();
  pushViews(sel);
  document.querySelectorAll('.match').forEach((b, i) => b.classList.toggle('active', app.matches[i] && app.matches[i].lat === lat && app.matches[i].lon === lon));

  try {
    // debounce rapid map clicks so we stay polite to the free geocoders
    if (sel.source === 'globe' || sel.source === 'india') {
      await sleep(380);
      if (id !== app.reqId) return;
    }

    if (!sel.place) {
      const rev = await reverseGeocode(lat, lon, signal);
      if (id !== app.reqId) return;
      sel.place = rev;
      sel.state = sel.state || rev?.state || '';
      sel.district = sel.district || rev?.district || '';
      if (!sel.pin && rev?.pin) {
        sel.pin = rev.pin;
        sel.pinMethod = 'OpenStreetMap postcode';
        sel.pinStatus = 'done';
      }
    }
    sel.addressLoading = false;
    renderCard();
    app.views.layers?.setPlace(sel);

    if (!sel.pin) {
      const r = await resolvePinForPoint(lat, lon, signal);
      if (id !== app.reqId) return;
      sel.place = sel.place || r.place;
      sel.pin = r.pin;
      sel.pinMethod = r.method;
      sel.pinApprox = r.approx;
      sel.hubKm = r.hubKm;
      sel.state = sel.state || r.place?.state || r.hub?.state || '';
      sel.pinStatus = 'done';
      renderCard();
    }

    if (sel.pin && !sel.pinApprox && !sel.offices.length) {
      const info = await pinInfo(sel.pin, signal);
      if (id !== app.reqId) return;
      if (info) {
        sel.offices = info.offices;
        sel.state = info.state || sel.state;
        sel.district = info.district || sel.district;
        // the directory confirms the PIN, upgrade the badge text if the OSM postcode matched
      }
    }
    sel.pinStatus = 'done';
    sel.addressLoading = false;
    renderCard();
    app.views.layers?.setPlace(sel);
    saveHistory(sel);
  } catch (e) {
    if (e.name === 'AbortError') return;
    sel.pinStatus = 'done';
    sel.addressLoading = false;
    renderCard();
  }
}

async function selectDigipin(code, source = 'digipin') {
  const v = validate(code);
  if (!v.valid) {
    showError('Invalid DIGIPIN', v.error);
    return;
  }
  const d = decode(code);
  await selectPoint(d.lat, d.lon, { source, digipin: code });
}

async function selectPin(pin, source = 'pin') {
  app.abort?.abort();
  app.abort = new AbortController();
  const { signal } = app.abort;
  const id = ++app.reqId;
  els.result.innerHTML = `<div class="card"><div class="big pin"><div class="lbl"><span>PIN code ${pin}</span></div><div class="val"><span class="skeleton"></span></div><div class="sub">Searching the India Post directory…</div></div></div>`;
  try {
    const [info, loc] = await Promise.all([pinInfo(pin, signal), pinToLocation(pin, signal)]);
    if (id !== app.reqId) return;
    if (!info && !loc) {
      showError('PIN code not found', `${pin} was not found in the India Post directory or on the map. Check the digits and try again.`);
      return;
    }
    if (!loc) {
      showError('Could not place this PIN on the map', `${pin} exists (${info.offices[0].district}, ${info.state}) but no coordinates were found. Try searching "${info.offices[0].name}, ${info.district}".`);
      return;
    }
    await selectPoint(loc.lat, loc.lon, {
      source,
      place: { ...loc, display: loc.display },
      pin,
      pinMethod: `India Post directory · map point from ${loc.method}`,
      offices: info?.offices || [],
      state: info?.state || loc.state,
      district: info?.district || loc.district
    });
  } catch (e) {
    if (e.name !== 'AbortError') showError('Lookup failed', 'The PIN lookup service could not be reached. Check your connection and try again.');
  }
}

async function selectPlace(query) {
  app.abort?.abort();
  app.abort = new AbortController();
  const id = ++app.reqId;
  els.result.innerHTML = `<div class="card"><div class="big"><div class="lbl"><span>Searching</span></div><div class="val" style="font-size:18px">${query.replace(/[<>&]/g, '')}</div><div class="sub"><span class="skeleton" style="height:12px;width:60%"></span></div></div></div>`;
  try {
    const places = await searchPlaces(query, app.abort.signal);
    if (id !== app.reqId) return;
    app.matches = places;
    els.matches.hidden = !places.length;
    els.matches.innerHTML = renderMatches(places, 0);
    if (!places.length) {
      // Offline-friendly fallback: match built-in cities by name
      const q = query.toLowerCase();
      const city = CITIES.find((c) => c.name.toLowerCase().includes(q));
      if (city) {
        await selectPoint(city.lat, city.lon, { source: 'city', pin: city.pin, pinMethod: `Built-in hub: ${city.name}`, state: city.state });
        return;
      }
      showError('No place found', `Nothing in India matched “${query}”. Try a locality + city, e.g. “Koramangala Bengaluru”, or paste a PIN / DIGIPIN.`);
      return;
    }
    const first = places[0];
    await selectPoint(first.lat, first.lon, { source: 'search', place: first, pin: first.pin });
  } catch (e) {
    if (e.name !== 'AbortError') showError('Search failed', 'Could not reach the place-search service.');
  }
}

async function handleInput(text) {
  const p = parseInput(text);
  els.matches.hidden = true;
  switch (p.type) {
    case 'empty': return;
    case 'digipin': return selectDigipin(p.code);
    case 'pin': return selectPin(p.pin);
    case 'latlon': return selectPoint(p.lat, p.lon, { source: 'latlon' });
    default: return selectPlace(p.query);
  }
}

// ---------------------------------------------------------------- views
/** The zoom funnel lives inside "India 3D": mode 'map' shows the map, 'funnel' the 10 stacked levels. */
function updateIndiaBar() {
  if (app.indiaMode === 'funnel') els.crumbs.innerHTML = renderFunnelBar(app.sel ? app.sel.digipin : '');
  else els.crumbs.innerHTML = renderCrumbs(app.views.india.focusPrefix, app.views.india.maxFocus);
}

function setView(tab, mode = 'map') {
  const name = tab === 'india' && mode === 'funnel' ? 'layers' : tab;
  const next = app.views[name];
  if (!next) return;
  if (next === app.current) return;
  els.canvas.classList.add('fade');
  setTimeout(() => {
    app.current?.setActive(false);
    app.current = next;
    next.setActive(true);
    resize();
    els.canvas.classList.remove('fade');
  }, 160);
  document.querySelectorAll('.tabs button').forEach((b) => {
    const on = b.dataset.view === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  els.crumbs.hidden = tab !== 'india';
  els.hud.hidden = name === 'layers';
  if (tab === 'india') {
    app.indiaMode = mode;
    updateIndiaBar();
  }
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  app.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  app.renderer?.setSize(w, h, false);
  // On desktop the left panel hides part of the canvas: shift the 3D scene centre into the free area.
  const shift = w > 860 ? (els.panel.offsetWidth + 28) / 2 : 0;
  // Portrait / narrow screens: zoom the camera out so the whole scene still fits.
  const free = w > 860 ? w - (els.panel.offsetWidth + 28) : w;
  const aspect = free / h;
  const zoom = aspect < 1.15 ? Math.max(0.45, aspect / 1.15) : 1;
  for (const v of Object.values(app.views)) {
    v.resize(w, h);
    v.camera.zoom = zoom;
    v.camera.updateProjectionMatrix();
    if (shift) v.camera.setViewOffset(w, h, -shift, 0, w, h);
    else v.camera.clearViewOffset();
  }
}

function onHover(hit) {
  if (!hit) {
    els.hudLL.textContent = els.hudDP.textContent = els.hudState.textContent = '—';
    return;
  }
  els.hud.hidden = false;
  els.hudLL.textContent = `${hit.lat.toFixed(4)}°, ${hit.lon.toFixed(4)}°`;
  let dp = '—';
  if (validateCoordinates(hit.lat, hit.lon).valid) {
    dp = hit.cellCode ? formatDigipin(hit.cellCode) + '…' : encode(hit.lat, hit.lon);
  }
  els.hudDP.textContent = dp;
  const state = hit.state !== undefined ? hit.state : app.views.india?.states[app.views.india.stateAt(hit.lat, hit.lon)]?.name;
  els.hudState.textContent = state || (validateCoordinates(hit.lat, hit.lon).valid ? 'Open water / outside India' : 'Outside DIGIPIN coverage');
  if (hit.cellCode) highlightLegend(hit.cellCode.slice(-1));
}

// ---------------------------------------------------------------- UI wiring
function buildStaticUI() {
  els.legendGrid.innerHTML = GRID.flat().map((c) => `<span>${c}</span>`).join('');
  const picks = [
    ...LANDMARKS.slice(0, 3).map((l) => ({ label: l.label, run: () => selectPoint(l.lat, l.lon, { source: 'city' }) })),
    ...['New Delhi', 'Mumbai', 'Bengaluru', 'Kolkata', 'Leh'].map((n) => {
      const c = CITIES.find((x) => x.name === n);
      return { label: n, run: () => selectPoint(c.lat, c.lon, { source: 'city', pin: c.pin, pinMethod: `Built-in hub: ${c.name}`, state: c.state }) };
    }),
    { label: 'PIN 560001', run: () => selectPin('560001') }
  ];
  els.chips.innerHTML = picks.map((p, i) => `<button class="chip" data-chip="${i}" type="button">${p.label}</button>`).join('');
  els.chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (b) picks[+b.dataset.chip].run();
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleInput(els.q.value);
  });
  els.q.addEventListener('input', () => {
    const p = parseInput(els.q.value);
    els.detect.innerHTML = {
      empty: 'Auto-detects what you type: place · PIN code · DIGIPIN · coordinates',
      digipin: 'Detected <b>DIGIPIN</b> — press Find to decode',
      pin: 'Detected <b>PIN code</b> — press Find to look up post offices',
      latlon: 'Detected <b>coordinates</b> — press Find to get DIGIPIN &amp; PIN',
      place: 'Searching <b>places</b> across India — press Find'
    }[p.type];
  });

  document.getElementById('btn-geo').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Geolocation is not supported by this browser', true);
    toast('Locating you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => selectPoint(pos.coords.latitude, pos.coords.longitude, { source: 'geolocation' }),
      (err) => toast(`Could not get your location (${err.message})`, true),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  els.matches.addEventListener('click', (e) => {
    const b = e.target.closest('[data-match]');
    if (!b) return;
    const p = app.matches[+b.dataset.match];
    selectPoint(p.lat, p.lon, { source: 'search', place: p, pin: p.pin });
  });

  els.result.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const ok = await copyText(copy.dataset.copy);
      const old = copy.textContent;
      copy.textContent = ok ? 'Copied ✓' : 'Copy failed';
      copy.classList.toggle('ok', ok);
      setTimeout(() => { copy.textContent = old; copy.classList.remove('ok'); }, 1400);
    }
    if (e.target.closest('[data-share]') && app.sel) {
      const url = `${location.origin}${location.pathname}#d=${app.sel.digipin}`;
      toast((await copyText(url)) ? 'Share link copied' : url);
    }
  });

  els.historyList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hist]');
    if (b) selectDigipin(b.dataset.hist, 'history');
  });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view, 'map')));
  els.crumbs.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { setView('india', m.dataset.mode); return; }
    const b = e.target.closest('[data-focus]');
    if (b) app.views.india.setFocus(b.dataset.focus);
  });
  document.getElementById('btn-help').addEventListener('click', () => els.help.showModal());

  // Disclaimer: always reachable, and shown once on the first visit.
  const disclaimer = document.getElementById('disclaimer');
  ['btn-disclaimer', 'btn-disclaimer-2'].forEach((id) => document.getElementById(id).addEventListener('click', () => disclaimer.showModal()));
  disclaimer.addEventListener('close', () => {
    try { localStorage.setItem('digipin-atlas-disclaimer', '1'); } catch { /* storage may be blocked */ }
  });
  let seen = false;
  try { seen = localStorage.getItem('digipin-atlas-disclaimer') === '1'; } catch { /* ignore */ }
  if (!seen) setTimeout(() => !disclaimer.open && disclaimer.showModal(), 900);
  document.getElementById('panel-toggle').addEventListener('click', () => els.panel.classList.toggle('collapsed'));

  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); els.q.focus(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '1') setView('globe');
    if (e.key === '2') setView('india');
    if (e.key === 'f' || e.key === 'F') setView('india', app.current === app.views.layers ? 'map' : 'funnel');
    if (e.key === 'Escape' && app.current === app.views.layers) { setView('india', 'map'); return; }
    if ((e.key === 'Escape' || e.key === 'Backspace') && app.current === app.views.india) {
      const p = app.views.india.focusPrefix;
      if (p) app.views.india.setFocus(p.slice(0, -1));
    }
  });
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', applyHash);
  renderHistoryList();
}

function applyHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const d = h.get('d');
  const pin = h.get('pin');
  const ll = h.get('ll');
  if (d && (!app.sel || clean(app.sel.digipin) !== clean(d))) selectDigipin(d, 'hash');
  else if (pin) selectPin(pin, 'pin');
  else if (ll) {
    const [lat, lon] = ll.split(',').map(Number);
    selectPoint(lat, lon, { source: 'latlon' });
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  buildStaticUI();
  let data;
  try {
    const [states, world] = await Promise.all([loadJSON('data/india-states.json'), loadJSON('data/world.json')]);
    data = { states, world };
  } catch (e) {
    els.loader.querySelector('p').textContent = `Could not load map data (${e.message}). Run the site via "npm run web".`;
    return;
  }

  try {
    app.renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    app.renderer.setClearColor(0x000000, 0);
    app.views.globe = new GlobeView(els.canvas, data);
    app.views.india = new IndiaView(els.canvas, data);
    app.views.layers = new LayersView(els.canvas, data);
  } catch (e) {
    console.error(e);
    els.loader.classList.add('done');
    toast('3D graphics (WebGL) are unavailable here — lookups still work.', true);
    applyHash();
    return;
  }

  app.views.globe.onPick = (lat, lon) => selectPoint(lat, lon, { source: 'globe' });
  app.views.india.onPick = (lat, lon) => selectPoint(lat, lon, { source: 'india' });
  app.views.globe.onHover = onHover;
  app.views.india.onHover = onHover;
  app.views.india.onFocus = (prefix) => {
    if (app.indiaMode === 'map') els.crumbs.innerHTML = renderCrumbs(prefix, app.views.india.maxFocus);
  };

  app.current = app.views.globe;
  app.current.setActive(true);
  app.views.india.setActive(false);
  app.views.layers.setActive(false);
  resize();

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const v = app.current;
    v.update(dt);
    app.renderer.render(v.scene, v.camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => els.loader.classList.add('done'), 350);

  applyHash();
}

boot();
