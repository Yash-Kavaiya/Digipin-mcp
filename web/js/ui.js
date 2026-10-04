import { cellSizeLabel, clean, formatDigipin } from './digipin.js';
import { formatCoord } from './geo.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SOURCE_LABEL = {
  globe: 'Picked on globe',
  india: 'Picked on India map',
  search: 'Place search',
  digipin: 'Decoded DIGIPIN',
  pin: 'PIN code lookup',
  latlon: 'Coordinates',
  geolocation: 'Your location',
  city: 'Quick pick',
  hash: 'Shared link',
  history: 'Recent'
};

/** Render the main result card. `sel` is the selection model built in main.js. */
export function renderResult(sel) {
  const code = formatDigipin(sel.digipin);
  const size = cellSizeLabel(10, sel.lat);
  const place = sel.place;

  let pinBlock;
  if (sel.pinStatus === 'loading') {
    pinBlock = `<div class="big pin"><div class="lbl"><span>PIN code</span></div><div class="val"><span class="skeleton"></span></div><div class="sub">Looking up India Post data…</div></div>`;
  } else if (sel.pin) {
    const badge = sel.pinApprox
      ? `<span class="badge warn" title="Live lookup was unavailable or had no postcode here">approximate</span>`
      : `<span class="badge ok">verified</span>`;
    pinBlock = `<div class="big pin">
      <div class="lbl"><span>PIN code ${badge}</span><button class="copy" data-copy="${esc(sel.pin)}">Copy</button></div>
      <div class="val">${esc(sel.pin)}</div>
      <div class="sub">${esc(sel.pinMethod || '')}${sel.pinApprox && sel.hubKm != null ? ` · ${Math.round(sel.hubKm)} km away — check the post office list` : ''}</div>
    </div>`;
  } else {
    pinBlock = `<div class="big pin"><div class="lbl"><span>PIN code</span></div><div class="val">—</div><div class="sub">No PIN code found for this exact spot.</div></div>`;
  }

  const area = [place?.locality, place?.city, sel.district || place?.district, sel.state || place?.state].filter(Boolean);
  const uniqueArea = area.filter((v, i) => area.indexOf(v) === i).join(', ');
  const offices = sel.offices || [];

  const officesHtml = offices.length
    ? `<details class="offices"><summary>${offices.length} post office${offices.length > 1 ? 's' : ''} share PIN ${esc(sel.pin)}</summary>
        <ul>${offices.slice(0, 40).map((o) => `<li><div>${esc(o.name)}</div><span>${esc(o.branchType || '')}${o.delivery ? ` · ${esc(o.delivery)}` : ''}</span></li>`).join('')}</ul></details>`
    : '';

  return `<div class="card">
    <div class="source"><span>Result</span><span class="tag">${esc(SOURCE_LABEL[sel.source] || sel.source)}</span></div>
    <div class="big">
      <div class="lbl"><span>DIGIPIN</span><button class="copy" data-copy="${esc(code)}">Copy</button></div>
      <div class="val">${esc(code)}</div>
      <div class="sub">Cell ≈ ${esc(size.distance.replace('≈ ', ''))} × ${esc(size.distance.replace('≈ ', ''))} · 10 levels deep</div>
    </div>
    ${pinBlock}
    <div class="facts">
      <div class="fact wide"><span class="k">Address</span><span class="v">${sel.addressLoading ? '<span class="skeleton" style="height:14px;width:80%"></span>' : esc(place?.display || uniqueArea || 'Address not available — coordinates only')}</span></div>
      <div class="fact"><span class="k">Latitude</span><span class="v mono">${sel.lat.toFixed(6)}° N</span></div>
      <div class="fact"><span class="k">Longitude</span><span class="v mono">${sel.lon.toFixed(6)}° E</span></div>
      ${sel.state || place?.state ? `<div class="fact"><span class="k">State / UT</span><span class="v">${esc(sel.state || place?.state)}</span></div>` : ''}
      ${sel.district || place?.district ? `<div class="fact"><span class="k">District</span><span class="v">${esc(sel.district || place?.district)}</span></div>` : ''}
    </div>
    ${officesHtml}
    <div class="links">
      <button data-copy="${esc(`${sel.lat.toFixed(6)}, ${sel.lon.toFixed(6)}`)}">Copy lat, lng</button>
      <button data-share>Copy share link</button>
      <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${sel.lat}&mlon=${sel.lon}#map=17/${sel.lat}/${sel.lon}">OpenStreetMap ↗</a>
      <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${sel.lat},${sel.lon}">Google Maps ↗</a>
    </div>
  </div>`;
}

export function renderError(title, message) {
  return `<div class="err"><b>${esc(title)}</b><br>${esc(message)}</div>`;
}

export function renderMatches(places, activeIndex) {
  if (!places.length) return '';
  return `<h3>${places.length} match${places.length > 1 ? 'es' : ''}</h3>` + places.map((p, i) => `
    <button class="match ${i === activeIndex ? 'active' : ''}" data-match="${i}">
      <b>${esc(p.name)} ${p.pin ? `<em>${esc(p.pin)}</em>` : ''}</b>
      <span>${esc(p.display)}</span>
    </button>`).join('');
}

export function renderHistory(items) {
  return `<div class="hist">${items.map((h) => `<button data-hist="${esc(h.digipin)}" title="${esc(h.label || '')}">${esc(h.digipin)}${h.pin ? `<small>${esc(h.pin)}</small>` : ''}</button>`).join('')}</div>`;
}

export function renderCrumbs(prefix, maxFocus) {
  const c = clean(prefix);
  let html = `<button data-focus="" class="${c ? '' : 'now'}">India</button>`;
  for (let i = 1; i <= c.length; i++) {
    html += `<span class="sep">›</span><button data-focus="${c.slice(0, i)}" class="${i === c.length ? 'now' : ''}">${c.slice(0, i)}</button>`;
  }
  const hint = c.length >= maxFocus ? 'Deepest map level — open all 10 levels →' : 'Click a cell to zoom in one level';
  return html + `<span class="hint">${hint}</span><button class="funnel-btn" data-mode="funnel" type="button" title="Show all 10 DIGIPIN levels (F)">🧊 All 10 levels</button>`;
}

/** Bar shown under the India 3D view while the 10-level "zoom funnel" is displayed. */
export function renderFunnelBar(code) {
  const shown = code ? formatDigipin(code) : 'sample code';
  return `<button class="funnel-btn" data-mode="map" type="button" title="Back to the map (Esc)">← Back to map</button>
    <span class="hint">All 10 levels of <b>${shown}</b> · drag to rotate, scroll to zoom</span>`;
}

export { formatCoord };
