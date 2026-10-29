// Map of ZET/HŽ stops and Bajs bike stations. Static data only, built by tools/build_data.py.

const ZAGREB_CENTER = [45.8131, 15.9772];
const NEARBY_BAJS = 3;
const NEARBY_STOPS = 4;
const NEAR_METERS = 250;
const MID_METERS = 500;

const COLORS = { tram: '#1c62c4', bus: '#2f9e44', train: '#7048e8', bajs: '#f76707', me: '#e03131' };
const KIND_LABEL = { tram: 'Tram stop', bus: 'Bus stop', train: 'Train station', bajs: 'Bajs station' };

let stops = [];
let bajsStations = [];
let places = []; // stops + Bajs stations, indexed by place.id for the clickable lists

const map = L.map('map', { zoomControl: false }).setView(ZAGREB_CENTER, 14);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Data: ZET, HŽPP, Bajs | Routes: <a href="https://transitous.org/sources/">Transitous</a> | <a href="https://github.com/zkristo/bajsikl">bajsikl</a>',
}).addTo(map);

// All stations share one canvas: stacked canvases would swallow each other's taps.
// A larger tolerance makes the small dots easier to tap on a phone.
map.createPane('stations').style.zIndex = 410;
const stationsRenderer = L.canvas({ pane: 'stations', tolerance: 8 });

// "My location" sits above the stations but lets taps through to them.
map.createPane('me').style.zIndex = 420;
map.getPane('me').style.pointerEvents = 'none';

L.control.zoom({ position: 'bottomright' }).addTo(map);

const LocateControl = L.Control.extend({
  onAdd() {
    const button = L.DomUtil.create('button', 'locate-btn');
    button.type = 'button';
    button.title = 'Show my location';
    button.textContent = '◎';
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, 'click', () => map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true }));
    return button;
  },
});
new LocateControl({ position: 'bottomright' }).addTo(map);

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

  // Added in drawing order: buses at the bottom, Bajs stations on top.
  const layers = { bus: L.layerGroup(), tram: L.layerGroup(), train: L.layerGroup(), bajs: L.layerGroup() };
  for (const kind of ['bus', 'tram', 'train']) {
    for (const stop of stops.filter((s) => s.kind === kind)) {
      stop.marker = L.circleMarker(stop.latlng, {
        renderer: stationsRenderer,
        radius: kind === 'bus' ? 4 : 6,
        color: '#fff',
        weight: 1.5,
        fillColor: COLORS[kind],
        fillOpacity: 1,
      }).bindPopup(() => stopPopup(stop)).addTo(layers[kind]);
    }
  }
  for (const station of bajsStations) {
    station.marker = L.circleMarker(station.latlng, {
      renderer: stationsRenderer,
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: COLORS.bajs,
      fillOpacity: 1,
    }).bindPopup(() => bajsPopup(station)).addTo(layers.bajs);
  }

  Object.values(layers).forEach((layer) => layer.addTo(map));
  new LayerChips({ position: 'topleft', layers }).addTo(map);
}

// Legend chips that toggle each layer. (Leaflet's own layers control misfires on touch:
// the tap that expands it also clicks the first checkbox underneath.)
const LayerChips = L.Control.extend({
  onAdd() {
    const { layers } = this.options;
    const bar = L.DomUtil.create('div', 'layer-chips');
    L.DomEvent.disableClickPropagation(bar);
    for (const [kind, label] of [['bajs', 'Bajs'], ['tram', 'Tram'], ['bus', 'Bus'], ['train', 'Train']]) {
      const chip = L.DomUtil.create('button', 'chip', bar);
      chip.type = 'button';
      chip.innerHTML = legend(kind, label);
      chip.setAttribute('aria-pressed', 'true');
      L.DomEvent.on(chip, 'click', () => {
        const visible = map.hasLayer(layers[kind]);
        if (visible) {
          map.removeLayer(layers[kind]);
        } else {
          layers[kind].addTo(map);
          // A re-added layer is drawn last; keep Bajs stations on top.
          layers.bajs.eachLayer((marker) => marker.bringToFront());
        }
        chip.setAttribute('aria-pressed', String(!visible));
      });
    }
    return bar;
  },
});

// Popups ---------------------------------------------------------------------

function stopPopup(stop) {
  return `<div class="popup">
    <h3>${esc(stop.name)}</h3>
    <div class="sub">${KIND_LABEL[stop.kind]}</div>
    ${lineBadges(stop)}
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

function lineBadges(stop) {
  const badges = [
    ...stop.tram.map((line) => badge(line, COLORS.tram)),
    ...stop.bus.map((line) => badge(line, COLORS.bus)),
  ];
  return badges.length ? `<div>${badges.join('')}</div>` : '';
}

function badge(text, color) {
  return `<span class="badge" style="background:${color}">${esc(text)}</span>`;
}

function shortLines(place) {
  const lines = [...(place.tram || []), ...(place.bus || [])];
  return lines.length ? ` <small>(${esc(lines.join(', '))})</small>` : '';
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

// GTFS has one stop per platform, so keep only the closest platform of each named stop.
function nearestStops(latlng) {
  const seen = new Set();
  return nearest(latlng, stops, stops.length)
    .filter(({ place }) => {
      const key = `${place.kind}|${place.name}`;
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

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
