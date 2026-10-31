// Map of ZET/HŽ stops and Bajs bike stations. Station data is static, built by tools/build_data.py.

const ZAGREB_CENTER = [45.8131, 15.9772];
const NEARBY_BAJS = 3;
const NEARBY_STOPS = 4;
const NEAR_METERS = 250;
const MID_METERS = 500;

// Station colours are --tram, --bus, --train and --bajs in style.css, so they follow light/dark mode.
const ME_COLOR = '#f76707';
const KIND_LABEL = { tram: 'Tram stop', bus: 'Bus stop', train: 'Train station', bajs: 'Bajs station' };

// What each zoom shows. Zoomed out, a stop's platforms share one marker and only the
// busiest bus stops appear; from ZOOM_ALL_STOPS every platform has its own marker.
const ZOOM_ALL_STOPS = 16;
const ZOOM_BUSY_BUSES = 14;
const ZOOM_TRAMS = 12;
const BUSY_BUS_SHARE = 0.1; // the busiest tenth of bus stops, by departures
const SAME_STOP_METERS = 400; // platforms with one name closer than this are one stop
const MARKER_SIZES = [[16, 15], [14, 12], [0, 7]]; // [from zoom, px]
const MIN_ICON_SIZE = 12; // smaller markers are plain shapes

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OFM_ATTRIBUTION = `<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ${OSM_ATTRIBUTION}`;
const BASEMAPS = {
  clean: { label: 'Clean', style: 'https://tiles.openfreemap.org/styles/liberty' },
  light: { label: 'Light', style: 'https://tiles.openfreemap.org/styles/positron' },
  detailed: { label: 'Detailed', tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
};
const DARK_BASEMAP = { style: 'https://tiles.openfreemap.org/styles/dark', paint: darkPaint };
// Shop/restaurant icons, one-way arrows and road shields clutter the map at city zoom.
const CLUTTER_LAYERS = /^(poi_|road_one_way_arrow|highway-shield|road_shield)/;

// OpenFreeMap's Dark is nearly black; these lift it to a dim slate where streets, parks
// and water stay readable. Keyed by layer id; see darkPaint() for the grouped ones.
const DARK_PAINT = {
  background: { 'background-color': '#24282e' },
  water: { 'fill-color': '#1b2f42' },
  waterway: { 'line-color': '#1b2f42' },
  water_name: { 'text-color': '#7fa3c7', 'text-halo-color': '#1b2f42' },
  landuse_residential: { 'fill-color': '#292e35' },
  landcover_wood: { 'fill-color': '#25332b' },
  landuse_park: { 'fill-color': '#25332b' },
  building: { 'fill-color': '#30363e', 'fill-outline-color': '#3a414a' },
  road_area_pier: { 'fill-color': '#24282e' },
  road_pier: { 'line-color': '#24282e' },
  'aeroway-area': { 'fill-color': '#2c3138' },
  'aeroway-runway': { 'line-color': '#3f4650' },
  'aeroway-taxiway': { 'line-color': '#3b424b' },
  highway_path: { 'line-color': '#3b424b' },
  highway_minor: { 'line-color': '#40474f' },
  highway_major_casing: { 'line-color': '#4a525c' },
  highway_major_inner: { 'line-color': '#515a64' },
  highway_major_subtle: { 'line-color': '#464e58' },
  highway_motorway_casing: { 'line-color': '#58616c' },
  highway_motorway_inner: { 'line-color': '#5f6974' },
  highway_motorway_subtle: { 'line-color': '#464e58' },
  highway_name_other: { 'text-color': '#aab2bb', 'text-halo-color': '#24282e' },
  highway_name_motorway: { 'text-color': '#b8c0c8' },
  railway: { 'line-color': '#4f5761' },
  railway_dashline: { 'line-color': '#24282e' },
  place: { 'text-color': '#c9d0d7', 'text-halo-color': 'rgba(24, 27, 31, 0.8)' },
  boundary: { 'line-color': '#59616b' },
};

function darkPaint(id) {
  if (id.startsWith('railway')) return DARK_PAINT[id.endsWith('dashline') ? 'railway_dashline' : 'railway'];
  if (id.startsWith('place_')) return DARK_PAINT.place;
  if (id.startsWith('boundary_')) return DARK_PAINT.boundary;
  return DARK_PAINT[id];
}

// Icons inside the station markers: 24×24 strokes, like the button icons below.
const MARKER_ICONS = {
  tram: new Path2D('M8 7h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM6 12.5h12M9 7l3-3.5L15 7M9 18l-2 3M15 18l2 3'),
  bus: new Path2D('M7 4h10a2 2 0 0 1 2 2v11H5V6a2 2 0 0 1 2-2zM5 11h14M8 17v2.5M16 17v2.5M8.5 14h.01M15.5 14h.01'),
  train: new Path2D('M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 10h14M9 17l-2.5 4M15 17l2.5 4M9 13.5h.01M15 13.5h.01'),
  bajs: new Path2D('M2 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M15 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 17.5 9.5 10h6.5M5.5 17.5h7l3.5-7.5 2.5 7.5M12.5 17.5 9.5 10M16 10l-1-3.5h-2M9.5 10V8M8 8h3'),
};

const ICONS = {
  layers: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 2 8.5 12 14l10-5.5z"/><path d="m2 13.5 10 5.5 10-5.5"/></svg>',
  locate: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
};

let stops = [];
let bajsStations = [];
let places = []; // stops + Bajs stations, indexed by place.id for the clickable lists
const palette = {}; // {kind: {fill, ink}} from the CSS colours of the current mode

// Filled in init(); hidden layers are remembered between visits.
const layers = { bus: L.layerGroup(), tram: L.layerGroup(), train: L.layerGroup(), bajs: L.layerGroup() };
const hiddenLayers = new Set(readSetting('hiddenLayers', []));

const map = L.map('map', { zoomControl: false, maxZoom: 19 }).setView(ZAGREB_CENTER, 14);
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('Data: ZET, HŽPP, Bajs | Routes: <a href="https://transitous.org/sources/">Transitous</a> | <a href="https://github.com/zkristo/bajsikl">bajsikl</a>');

// All stations share one canvas: stacked canvases would swallow each other's taps.
// A larger tolerance makes the small markers easier to tap on a phone.
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
  readPalette();
  for (const place of places) place.marker.redraw();
  document.dispatchEvent(new Event('themechange'));
  const themeButton = document.querySelector('.theme-btn');
  themeButton.title = dark ? 'Light mode' : 'Dark mode';
  themeButton.setAttribute('aria-label', themeButton.title);
  for (const button of document.querySelectorAll('[data-basemap]')) {
    button.setAttribute('aria-pressed', String(!dark && button.dataset.basemap === basemapChoice));
  }
}

async function createBasemap({ style, tiles, paint }) {
  if (tiles) return L.tileLayer(tiles, { maxZoom: 19, attribution: OSM_ATTRIBUTION });
  const response = await fetch(style);
  if (!response.ok) throw new Error(`Map style: HTTP ${response.status}`);
  const json = await response.json();
  json.layers = json.layers.filter((layer) => !CLUTTER_LAYERS.test(layer.id));
  if (paint) {
    for (const layer of json.layers) Object.assign((layer.paint ??= {}), paint(layer.id));
  }
  return L.maplibreGL({ style: json, attributionControl: { customAttribution: OFM_ATTRIBUTION } });
}

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  for (const kind of ['tram', 'bus', 'train', 'bajs', 'walk', 'alt']) {
    palette[kind] = { fill: css.getPropertyValue(`--${kind}`).trim(), ink: css.getPropertyValue(`--${kind}-ink`).trim() };
  }
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
      keepDrawingOrder();
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
  groupPlatforms();
  markBusyBusStops();

  for (const place of places) {
    place.marker = new StationMarker(place.latlng, { renderer: stationsRenderer, kind: place.kind })
      .bindPopup(() => (place.kind === 'bajs' ? bajsPopup(place) : stopPopup(place)));
  }
  updateStationMarkers();
  map.on('zoomend', updateStationMarkers);
  for (const kind of ['bus', 'tram', 'train', 'bajs']) {
    if (!hiddenLayers.has(kind)) layers[kind].addTo(map);
  }
  keepDrawingOrder();
}

// GTFS has one stop per platform. Platforms with the same name and kind close together
// are one stop: zoomed out, its first platform (the lead) stands for all of them.
function groupPlatforms() {
  const leads = new Map();
  for (const stop of stops) {
    const key = `${stop.kind}|${stop.name}`;
    const lead = leads.get(key);
    if (lead && lead.latlng.distanceTo(stop.latlng) < SAME_STOP_METERS) {
      stop.lead = lead;
      lead.platforms.push(stop);
    } else {
      stop.lead = stop;
      stop.platforms = [stop];
      leads.set(key, stop);
    }
  }
}

function markBusyBusStops() {
  const busLeads = stops.filter((stop) => stop.kind === 'bus' && stop.lead === stop);
  for (const lead of busLeads) lead.totalDepartures = lead.platforms.reduce((sum, p) => sum + (p.departures || 0), 0);
  busLeads.sort((a, b) => b.totalDepartures - a.totalDepartures);
  busLeads.slice(0, Math.ceil(busLeads.length * BUSY_BUS_SHARE)).forEach((lead) => { lead.busy = true; });
}

function shownAt(place, zoom) {
  if (place.kind === 'bajs' || place.kind === 'train' || zoom >= ZOOM_ALL_STOPS) return true;
  if (place.lead !== place) return false;
  return place.kind === 'tram' ? zoom >= ZOOM_TRAMS : zoom >= ZOOM_BUSY_BUSES && place.busy;
}

let shownTier = '';

function updateStationMarkers() {
  const zoom = map.getZoom();
  const size = MARKER_SIZES.find(([fromZoom]) => zoom >= fromZoom)[1];
  const tier = [size, zoom >= ZOOM_ALL_STOPS, zoom >= ZOOM_BUSY_BUSES, zoom >= ZOOM_TRAMS].join();
  if (tier === shownTier) return;
  shownTier = tier;
  for (const place of places) {
    const group = layers[place.kind];
    const shown = shownAt(place, zoom);
    if (shown && !group.hasLayer(place.marker)) group.addLayer(place.marker);
    else if (!shown && group.hasLayer(place.marker)) group.removeLayer(place.marker);
    place.marker.setRadius(size / 2);
  }
  keepDrawingOrder();
}

// Markers drawn later cover earlier ones: buses at the bottom, Bajs stations on top.
function keepDrawingOrder() {
  for (const kind of ['tram', 'train', 'bajs']) layers[kind].eachLayer((marker) => marker.bringToFront());
}

// A station marker on the shared canvas: a rounded square for trams, buses and trains
// and a circle for Bajs, with the vehicle's icon once it is big enough to read.
const StationMarker = L.CircleMarker.extend({
  _updatePath() {
    const renderer = this._renderer;
    if (!renderer._drawing || this._empty()) return;
    const ctx = renderer._ctx;
    const { x, y } = this._point;
    const r = this._radius;
    const { kind } = this.options;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette[kind].fill;
    ctx.beginPath();
    if (kind === 'bajs') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (ctx.roundRect) ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.55);
    else ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
    if (r * 2 >= MIN_ICON_SIZE) {
      const scale = (r * (kind === 'bajs' ? 1.35 : 1.45)) / 24;
      ctx.translate(x - 12 * scale, y - 12 * scale);
      ctx.scale(scale, scale);
      ctx.strokeStyle = palette[kind].ink;
      ctx.lineWidth = Math.max(2.2, 1.2 / scale); // at least 1.2 px on screen in small markers
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(MARKER_ICONS[kind]);
    }
    ctx.restore();
  },
});

// Popups ---------------------------------------------------------------------

// Zoomed out, a stop's marker stands for all its platforms, so its popup lists them all.
function stopPopup(stop) {
  const platforms = map.getZoom() < ZOOM_ALL_STOPS && stop.platforms ? stop.platforms : [stop];
  return `<div class="popup">
    <h3>${esc(stop.name)}</h3>
    <div class="sub">${KIND_LABEL[stop.kind]}</div>
    ${directionList(stop.kind, platforms)}
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
      <span><span class="dot kind-${place.kind}"></span>${esc(place.name)}${shortLines(place)}</span>
      <span class="dist ${distanceClass(meters)}">${formatDistance(meters)}</span>
    </button></li>`);
  return `<ul>${items.join('')}</ul>`;
}

// Where departures from these platforms go, each destination with the lines that go there.
function directionList(kind, platforms) {
  const tram = new Set(platforms.flatMap((p) => p.tram));
  const bus = new Set(platforms.flatMap((p) => p.bus));
  const destinations = new Map();
  for (const { to, lines } of platforms.flatMap((p) => p.directions || [])) {
    destinations.set(to, new Set([...(destinations.get(to) || []), ...lines]));
  }
  if (kind === 'train') {
    return destinations.size ? `<div class="towards">Trains to ${esc([...destinations.keys()].join(', '))}</div>` : '';
  }
  if (!destinations.size) return `${lineBadges([...tram], [...bus])}<div class="muted">Trips end here</div>`;
  const rows = [...destinations].map(([to, lines]) => {
    const sorted = [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return `
    <li><span class="to">→ ${esc(to)}</span>
      <span>${lineBadges(sorted.filter((line) => tram.has(line)), sorted.filter((line) => !tram.has(line)))}</span></li>`;
  });
  return `<ul class="directions">${rows.join('')}</ul>`;
}

function lineBadges(tram, bus) {
  return [...tram.map((line) => badge(line, 'tram')), ...bus.map((line) => badge(line, 'bus'))].join('');
}

function badge(text, kind) {
  return `<span class="badge kind-${kind}">${esc(text)}</span>`;
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
  return `<span class="dot kind-${kind}"></span>${label}`;
}

// Tapping a place in a popup list jumps to that place and opens its popup.
map.on('popupopen', (e) => {
  for (const button of e.popup.getElement().querySelectorAll('[data-place]')) {
    button.addEventListener('click', () => showPlace(places[button.dataset.place]));
  }
});

function showPlace(place) {
  map.setView(place.latlng, Math.max(map.getZoom(), ZOOM_ALL_STOPS));
  const content = place.kind === 'bajs' ? bajsPopup(place) : stopPopup(place);
  L.popup().setLatLng(place.latlng).setContent(content).openOn(map);
}

// My location ----------------------------------------------------------------

let myMarker = null;
let myAccuracy = null;

map.on('locationfound', (e) => {
  if (!myMarker) {
    myAccuracy = L.circle(e.latlng, { pane: 'me', interactive: false, radius: e.accuracy, weight: 1, color: ME_COLOR, fillOpacity: 0.08 }).addTo(map);
    myMarker = L.circleMarker(e.latlng, { pane: 'me', interactive: false, radius: 8, color: '#fff', weight: 3, fillColor: ME_COLOR, fillOpacity: 1 }).addTo(map);
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
