// Map of ZET/HŽ stops and Bajs bike stations. Station data is static, built by tools/build_data.py.

const ZAGREB_CENTER = [45.8131, 15.9772];
const NEARBY_BAJS = 3;
const NEARBY_STOPS = 4;
const NEAR_METERS = 250;
const MID_METERS = 500;

// Bajs and ZET are shades of blue told apart by lightness (dark tram, mid Bajs, light bus); trains are red.
const COLORS = { tram: '#1c3d8c', bus: '#4dabf7', train: '#e03131', bajs: '#1971c2', me: '#f76707' };
const INK = { bus: '#0b2545' }; // text on a coloured badge; white unless listed
const KIND_LABEL = { tram: 'Tram stop', bus: 'Bus stop', train: 'Train station', bajs: 'Bajs station' };
const DOT_RADIUS = 6;

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OFM_ATTRIBUTION = `<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ${OSM_ATTRIBUTION}`;
const BASEMAPS = {
  clean: { label: 'Clean', style: 'https://tiles.openfreemap.org/styles/liberty' },
  light: { label: 'Light', style: 'https://tiles.openfreemap.org/styles/positron' },
  detailed: { label: 'Detailed', tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
};
const DARK_BASEMAP = { style: 'https://tiles.openfreemap.org/styles/dark' };
// Shop/restaurant icons, one-way arrows and road shields clutter the map at city zoom.
const CLUTTER_LAYERS = /^(poi_|road_one_way_arrow|highway-shield|road_shield)/;

const ICONS = {
  layers: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 2 8.5 12 14l10-5.5z"/><path d="m2 13.5 10 5.5 10-5.5"/></svg>',
  locate: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
};

let stops = [];
let bajsStations = [];
let places = []; // stops + Bajs stations, indexed by place.id for the clickable lists

// Filled in init(); hidden layers are remembered between visits.
const layers = { bus: L.layerGroup(), tram: L.layerGroup(), train: L.layerGroup(), bajs: L.layerGroup() };
const hiddenLayers = new Set(readSetting('hiddenLayers', []));

const map = L.map('map', { zoomControl: false, maxZoom: 19 }).setView(ZAGREB_CENTER, 14);
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('Data: ZET, HŽPP, Bajs | Routes: <a href="https://transitous.org/sources/">Transitous</a> | <a href="https://github.com/zkristo/bajsikl">bajsikl</a>');

// All stations share one canvas: stacked canvases would swallow each other's taps.
// A larger tolerance makes the small dots easier to tap on a phone.
map.createPane('stations').style.zIndex = 410;
const stationsRenderer = L.canvas({ pane: 'stations', tolerance: 8 });

// "My location" sits above the stations but lets taps through to them.
map.createPane('me').style.zIndex = 420;
map.getPane('me').style.pointerEvents = 'none';

// Base map -------------------------------------------------------------------

let basemap = null;
let basemapRequest = 0;
let basemapChoice = readSetting('basemap', 'clean');
let theme = readSetting('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
showBasemap();

// Dark mode has its own map style; the "Map style" chips pick the light-mode one.
async function showBasemap() {
  const id = ++basemapRequest;
  let source = theme === 'dark' ? DARK_BASEMAP : BASEMAPS[basemapChoice] || BASEMAPS.clean;
  if (source.style && !webglSupported()) source = BASEMAPS.detailed;
  let layer;
  try {
    layer = await createBasemap(source);
  } catch {
    layer = await createBasemap(BASEMAPS.detailed); // the vector style could not be downloaded
  }
  if (id !== basemapRequest) return;
  if (basemap) map.removeLayer(basemap);
  basemap = layer.addTo(map);
}

function chooseBasemap(key) {
  basemapChoice = key;
  saveSetting('basemap', key);
  if (theme === 'dark') setTheme('light');
  else showBasemap();
  updateMapButtons();
}

function setTheme(value) {
  theme = value;
  saveSetting('theme', value);
  showBasemap();
  updateMapButtons();
}

function updateMapButtons() {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  const themeButton = document.querySelector('.theme-btn');
  themeButton.title = dark ? 'Light mode' : 'Dark mode';
  themeButton.setAttribute('aria-label', themeButton.title);
  for (const button of document.querySelectorAll('[data-basemap]')) {
    button.setAttribute('aria-pressed', String(!dark && button.dataset.basemap === basemapChoice));
  }
}

async function createBasemap({ style, tiles }) {
  if (tiles) return L.tileLayer(tiles, { maxZoom: 19, attribution: OSM_ATTRIBUTION });
  const response = await fetch(style);
  if (!response.ok) throw new Error(`Map style: HTTP ${response.status}`);
  const json = await response.json();
  json.layers = json.layers.filter((layer) => !CLUTTER_LAYERS.test(layer.id));
  return L.maplibreGL({ style: json, attributionControl: { customAttribution: OFM_ATTRIBUTION } });
}

function webglSupported() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// Map buttons (bottom right) -------------------------------------------------

const LocateControl = L.Control.extend({
  onAdd() {
    const button = L.DomUtil.create('button', 'map-btn');
    button.type = 'button';
    button.title = 'Show my location';
    button.innerHTML = ICONS.locate;
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, 'click', () => map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true }));
    return button;
  },
});
new LocateControl({ position: 'bottomright' }).addTo(map);

// Layers button with a pop-up panel: which stations to show and the map style.
// (Leaflet's own layers control misfires on touch: the tap that expands it also
// clicks the first checkbox underneath.)
const LayersControl = L.Control.extend({
  onAdd() {
    const container = L.DomUtil.create('div', 'layers-control');
    const chips = [['bajs', 'Bajs'], ['tram', 'Tram'], ['bus', 'Bus'], ['train', 'Train']]
      .map(([kind, label]) => `<button type="button" class="chip" data-layer="${kind}" aria-pressed="${!hiddenLayers.has(kind)}">${legend(kind, label)}</button>`)
      .join('');
    const styles = Object.entries(BASEMAPS)
      .map(([key, { label }]) => `<button type="button" class="chip" data-basemap="${key}" aria-pressed="false">${label}</button>`)
      .join('');
    container.innerHTML = `
      <div class="layers-panel">
        <h4>Show on map</h4>
        <div class="chip-row">${chips}</div>
        <h4>Map style</h4>
        <div class="chip-row">${styles}</div>
      </div>
      <button type="button" class="map-btn" title="Map layers">${ICONS.layers}</button>`;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    container.querySelector('.map-btn').addEventListener('click', () => container.classList.toggle('open'));
    for (const chip of container.querySelectorAll('[data-layer]')) {
      chip.addEventListener('click', () => {
        const visible = toggleLayer(chip.dataset.layer);
        chip.setAttribute('aria-pressed', String(visible));
      });
    }
    for (const button of container.querySelectorAll('[data-basemap]')) {
      button.addEventListener('click', () => chooseBasemap(button.dataset.basemap));
    }
    // Any tap outside the panel closes it (map 'click' doesn't fire for taps on stations).
    document.addEventListener('pointerdown', (e) => {
      if (!container.contains(e.target)) container.classList.remove('open');
    });
    return container;
  },
});
new LayersControl({ position: 'bottomright' }).addTo(map);

// Light/dark mode; the icon shows the mode a tap switches to. Both icons stay in the
// button and CSS shows one: replacing them mid-tap would let the tap reach the map
// and close any open popup.
const ThemeControl = L.Control.extend({
  onAdd() {
    const button = L.DomUtil.create('button', 'map-btn theme-btn');
    button.type = 'button';
    button.innerHTML = `<span class="to-dark">${ICONS.moon}</span><span class="to-light">${ICONS.sun}</span>`;
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, 'click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));
    return button;
  },
});
new ThemeControl({ position: 'bottomright' }).addTo(map);
updateMapButtons();

function toggleLayer(kind) {
  const visible = hiddenLayers.has(kind);
  if (visible) {
    hiddenLayers.delete(kind);
    if (stops.length) {
      layers[kind].addTo(map);
      // A re-added layer is drawn last; keep Bajs stations on top.
      layers.bajs.eachLayer((marker) => marker.bringToFront());
    }
  } else {
    hiddenLayers.add(kind);
    map.removeLayer(layers[kind]);
  }
  saveSetting('hiddenLayers', [...hiddenLayers]);
  return visible;
}

// Stations -------------------------------------------------------------------

Promise.all([loadJson('data/stops.json'), loadJson('data/bajs.json')])
  .then(([stopsData, bajsData]) => init(stopsData.items, bajsData.items))
  .catch((err) => alert(`Could not load station data: ${err.message}`));

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function init(stopItems, bajsItems) {
  stops = stopItems;
  bajsStations = bajsItems.map((station) => ({ ...station, kind: 'bajs' }));
  places = [...stops, ...bajsStations];
  places.forEach((place, id) => {
    place.id = id;
    place.latlng = L.latLng(place.lat, place.lon);
  });

  for (const stop of stops) {
    stop.marker = new StopMarker(stop.latlng, {
      renderer: stationsRenderer,
      radius: DOT_RADIUS,
      color: '#fff',
      weight: 1.5,
      fillColor: COLORS[stop.kind],
      fillOpacity: 1,
      bearings: stop.bearings,
    }).bindPopup(() => stopPopup(stop)).addTo(layers[stop.kind]);
  }
  for (const station of bajsStations) {
    station.marker = L.circleMarker(station.latlng, {
      renderer: stationsRenderer,
      radius: DOT_RADIUS,
      color: '#fff',
      weight: 1.5,
      fillColor: COLORS.bajs,
      fillOpacity: 1,
    }).bindPopup(() => bajsPopup(station)).addTo(layers.bajs);
  }

  // Added in drawing order: buses at the bottom, Bajs stations on top.
  for (const kind of ['bus', 'tram', 'train', 'bajs']) {
    if (!hiddenLayers.has(kind)) layers[kind].addTo(map);
  }
}

// A stop's dot with a small pointer for each way vehicles leave it (bearings in degrees
// from north). Drawn on the shared canvas; taps still hit only the round dot.
const StopMarker = L.CircleMarker.extend({
  _updateBounds() {
    L.CircleMarker.prototype._updateBounds.call(this);
    if (!this.options.bearings.length) return;
    const pad = L.point(this._radius, this._radius);
    this._pxBounds = L.bounds(this._pxBounds.min.subtract(pad), this._pxBounds.max.add(pad));
  },

  _updatePath() {
    const renderer = this._renderer;
    renderer._updateCircle(this);
    if (!renderer._drawing || this._empty()) return;
    const ctx = renderer._ctx;
    const { x, y } = this._point;
    const r = this._radius;
    for (const bearing of this.options.bearings) {
      const angle = ((bearing - 90) * Math.PI) / 180; // canvas angles start east, turning clockwise
      const at = (out, side) => [
        x + out * Math.cos(angle) - side * Math.sin(angle),
        y + out * Math.sin(angle) + side * Math.cos(angle),
      ];
      ctx.beginPath();
      ctx.moveTo(...at(r * 2, 0));
      ctx.lineTo(...at(r + 1, r * 0.75));
      ctx.lineTo(...at(r + 1, -r * 0.75));
      ctx.closePath();
      renderer._fillStroke(ctx, this);
    }
  },
});

// Popups ---------------------------------------------------------------------

function stopPopup(stop) {
  return `<div class="popup">
    <h3>${esc(stop.name)}</h3>
    <div class="sub">${KIND_LABEL[stop.kind]}</div>
    ${directionList(stop)}
    <h4>Nearest Bajs stations</h4>
    ${placeList(nearest(stop.latlng, bajsStations, NEARBY_BAJS))}
    ${routeActions(stop.name, stop.latlng)}
  </div>`;
}

function bajsPopup(station) {
  const appLink = /^https:\/\//.test(station.url)
    ? `<a class="app-link" href="${esc(station.url)}" target="_blank" rel="noopener">Open in nextbike app →</a>`
    : '';
  return `<div class="popup">
    <h3>${esc(station.name)}</h3>
    <div class="sub">Bajs station ${esc(station.number)} · ${station.capacity ?? '?'} docks</div>
    <h4>Nearest stops</h4>
    ${placeList(nearestStops(station.latlng))}
    ${appLink}
    ${routeActions(station.name, station.latlng)}
  </div>`;
}

function myLocationPopup(latlng) {
  return `<div class="popup">
    <h3>You are here</h3>
    <h4>Nearest Bajs stations</h4>
    ${placeList(nearest(latlng, bajsStations, NEARBY_BAJS))}
    <h4>Nearest stops</h4>
    ${placeList(nearestStops(latlng))}
  </div>`;
}

function placeList(hits) {
  const items = hits.map(({ place, meters }) => `
    <li><button type="button" data-place="${place.id}">
      <span><span class="dot" style="background:${COLORS[place.kind]}"></span>${esc(place.name)}${shortLines(place)}</span>
      <span class="dist ${distanceClass(meters)}">${formatDistance(meters)}</span>
    </button></li>`);
  return `<ul>${items.join('')}</ul>`;
}

// Where departures from this platform go, each with the lines that go there.
function directionList(stop) {
  const directions = stop.directions || [];
  if (stop.kind === 'train') {
    return directions.length
      ? `<div class="towards">Trains to ${esc(directions.map((d) => d.to).join(', '))}</div>`
      : '';
  }
  if (!directions.length) return `${lineBadges(stop.tram, stop.bus)}<div class="muted">Trips end here</div>`;
  const rows = directions.map((d) => `
    <li><span class="to">→ ${esc(d.to)}</span>
      <span>${lineBadges(d.lines.filter((line) => stop.tram.includes(line)), d.lines.filter((line) => !stop.tram.includes(line)))}</span></li>`);
  return `<ul class="directions">${rows.join('')}</ul>`;
}

function lineBadges(tram, bus) {
  return [...tram.map((line) => badge(line, 'tram')), ...bus.map((line) => badge(line, 'bus'))].join('');
}

function badge(text, kind) {
  return `<span class="badge" style="background:${COLORS[kind]};color:${inkOn(kind)}">${esc(text)}</span>`;
}

function inkOn(kind) {
  return INK[kind] || '#fff';
}

function shortLines(place) {
  const lines = [...(place.tram || []), ...(place.bus || [])];
  const towards = place.kind === 'train' ? [] : (place.directions || []).map((d) => d.to);
  const parts = [
    lines.length ? `(${lines.join(', ')})` : '',
    towards.length ? `→ ${towards.slice(0, 2).join(', ')}${towards.length > 2 ? '…' : ''}` : '',
  ].filter(Boolean);
  return parts.length ? ` <small>${esc(parts.join(' '))}</small>` : '';
}

function legend(kind, label) {
  return `<span class="dot" style="background:${COLORS[kind]}"></span>${label}`;
}

// Tapping a place in a popup list jumps to that place and opens its popup.
map.on('popupopen', (e) => {
  for (const button of e.popup.getElement().querySelectorAll('[data-place]')) {
    button.addEventListener('click', () => showPlace(places[button.dataset.place]));
  }
});

function showPlace(place) {
  const content = place.kind === 'bajs' ? bajsPopup(place) : stopPopup(place);
  map.setView(place.latlng, Math.max(map.getZoom(), 16));
  L.popup().setLatLng(place.latlng).setContent(content).openOn(map);
}

// My location ----------------------------------------------------------------

let myMarker = null;
let myAccuracy = null;

map.on('locationfound', (e) => {
  if (!myMarker) {
    myAccuracy = L.circle(e.latlng, { pane: 'me', interactive: false, radius: e.accuracy, weight: 1, color: COLORS.me, fillOpacity: 0.08 }).addTo(map);
    myMarker = L.circleMarker(e.latlng, { pane: 'me', interactive: false, radius: 8, color: '#fff', weight: 3, fillColor: COLORS.me, fillOpacity: 1 }).addTo(map);
  }
  myAccuracy.setLatLng(e.latlng).setRadius(e.accuracy);
  myMarker.setLatLng(e.latlng).bindPopup(myLocationPopup(e.latlng)).openPopup();
});

map.on('locationerror', (e) => alert(`Location unavailable: ${e.message}`));

// Helpers --------------------------------------------------------------------

function nearest(latlng, candidates, count) {
  return candidates
    .map((place) => ({ place, meters: latlng.distanceTo(place.latlng) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count);
}

// GTFS has one stop per platform, so keep only the closest platform of each named stop
// and direction (the platforms across the street go the other way).
function nearestStops(latlng) {
  const seen = new Set();
  return nearest(latlng, stops, stops.length)
    .filter(({ place }) => {
      const key = `${place.kind}|${place.name}|${(place.directions || []).map((d) => d.to).join()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, NEARBY_STOPS);
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

function distanceClass(meters) {
  if (meters <= NEAR_METERS) return 'near';
  if (meters <= MID_METERS) return 'mid';
  return 'far';
}

function readSetting(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing can block storage; settings just won't be remembered.
  }
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
