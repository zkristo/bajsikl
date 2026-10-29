// Route planning with Transitous (https://transitous.org): walk + Bajs + ZET/HŽ.
// Loaded after app.js and uses its map, COLORS and helpers (esc, formatDistance).

const TRANSITOUS = 'https://api.transitous.org';
const BAJS_PROVIDER = 'hr-bajs';
const MAX_DIRECT_SECONDS = 3600; // the 30 min default hides most "Bajs all the way" trips

const LEG_COLORS = { walk: '#868e96', bajs: COLORS.bajs, tram: COLORS.tram, bus: COLORS.bus, train: COLORS.train };
const LEG_ICONS = { walk: '🚶', bajs: '🚲', tram: '🚋', bus: '🚌', train: '🚆' };
const LEG_LABELS = { tram: 'Tram', bus: 'Bus', train: 'Train' };
const PLACE_TYPES = { STOP: 'Stop', ADDRESS: 'Address', PLACE: 'Place' };

const timeFormat = new Intl.DateTimeFormat('hr-HR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zagreb' });

const state = { from: null, to: null }; // from = null means "my location"
let origin = null; // resolved start point of the current route
let itineraries = [];
let selected = 0;
let planCounter = 0;
let suggestCounter = 0;
let suggestions = [];
let suggestField = null;

// The route is drawn above the stations but lets taps through to them.
map.createPane('route').style.zIndex = 415;
map.getPane('route').style.pointerEvents = 'none';
const routeLayer = L.layerGroup().addTo(map);

// From/To box ----------------------------------------------------------------

const RouteBox = L.Control.extend({
  onAdd() {
    const box = L.DomUtil.create('div', 'route-box');
    box.innerHTML = `
      <label class="route-field"><span>From</span><input id="route-from" type="text" placeholder="My location" autocomplete="off" enterkeyhint="search"></label>
      <label class="route-field"><span>To</span><input id="route-to" type="text" placeholder="Where to?" autocomplete="off" enterkeyhint="search"></label>
      <button type="button" class="swap" title="Swap start and destination">⇅</button>
      <ul class="suggestions" hidden></ul>`;
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  },
});
new RouteBox({ position: 'topleft' }).addTo(map);

const inputs = { from: document.getElementById('route-from'), to: document.getElementById('route-to') };
const suggestionList = document.querySelector('.route-box .suggestions');
const sheet = document.getElementById('sheet');

for (const [field, input] of Object.entries(inputs)) {
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    if (!input.value.trim()) {
      state[field] = null;
      hideSuggestions();
      if (field === 'to') clearRoute();
      else if (state.to) planRoute();
      return;
    }
    timer = setTimeout(() => suggest(field, input.value), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && suggestField === field && suggestions.length) chooseSuggestion(0);
  });
  input.addEventListener('blur', hideSuggestions);
}

// Keep the input focused while tapping a suggestion, otherwise blur hides the list first.
suggestionList.addEventListener('pointerdown', (e) => e.preventDefault());
suggestionList.addEventListener('click', (e) => {
  const button = e.target.closest('[data-suggestion]');
  if (button) chooseSuggestion(Number(button.dataset.suggestion));
});

document.querySelector('.route-box .swap').addEventListener('click', swapEndpoints);

async function suggest(field, text) {
  const id = ++suggestCounter;
  if (text.trim().length < 2) return hideSuggestions();
  const center = map.getCenter();
  const params = new URLSearchParams({
    text,
    place: `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`,
    placeBias: 5,
    numResults: 8,
  });
  try {
    const results = await fetchJson(`${TRANSITOUS}/api/v1/geocode?${params}`);
    if (id !== suggestCounter) return;
    showSuggestions(field, results);
  } catch {
    // Suggestions are best effort; the user can keep typing.
  }
}

function showSuggestions(field, results) {
  const seen = new Set();
  suggestions = results.filter((r) => {
    const key = `${r.type}|${r.name}|${areaName(r)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  suggestField = field;
  suggestionList.innerHTML = suggestions.length
    ? suggestions.map((r, i) => `
        <li><button type="button" data-suggestion="${i}">
          <b>${esc(r.name)}</b> <small>${[PLACE_TYPES[r.type], areaName(r)].filter(Boolean).map(esc).join(' · ')}</small>
        </button></li>`).join('')
    : '<li class="muted">No matches</li>';
  suggestionList.hidden = false;
}

function hideSuggestions() {
  suggestCounter++;
  suggestions = [];
  suggestField = null;
  suggestionList.hidden = true;
}

function chooseSuggestion(index) {
  const field = suggestField;
  const r = suggestions[index];
  hideSuggestions();
  inputs[field].blur();
  setEndpoint(field, { name: r.name, lat: r.lat, lon: r.lon });
}

function areaName(result) {
  return result.areas?.find((a) => a.default)?.name || '';
}

function setEndpoint(field, place) {
  state[field] = place;
  inputs[field].value = place.name;
  if (state.to) planRoute();
}

async function swapEndpoints() {
  if (!state.to) return;
  let from = state.from;
  if (!from) {
    try {
      from = await currentPosition();
    } catch (err) {
      return showSheet(`<p>${esc(err.message)}</p>`);
    }
  }
  [state.from, state.to] = [state.to, from];
  inputs.from.value = state.from.name;
  inputs.to.value = state.to.name;
  planRoute();
}

// "Route from here / Route here" buttons, used in station popups and on long-press.

function routeActions(name, latlng) {
  const data = `data-name="${esc(name)}" data-lat="${latlng.lat}" data-lon="${latlng.lng}"`;
  return `<div class="route-actions">
    <button type="button" data-route="from" ${data}>Route from here</button>
    <button type="button" data-route="to" ${data}>Route here</button>
  </div>`;
}

map.on('popupopen', (e) => {
  for (const button of e.popup.getElement().querySelectorAll('[data-route]')) {
    button.addEventListener('click', () => {
      const { route, name, lat, lon } = button.dataset;
      map.closePopup();
      setEndpoint(route, { name, lat: Number(lat), lon: Number(lon) });
    });
  }
});

map.on('contextmenu', (e) => {
  L.popup()
    .setLatLng(e.latlng)
    .setContent(`<div class="popup"><h3>Point on map</h3>${routeActions('Point on map', e.latlng)}</div>`)
    .openOn(map);
});

// Planning -------------------------------------------------------------------

async function planRoute() {
  const id = ++planCounter;
  itineraries = [];
  selected = 0;
  routeLayer.clearLayers();
  fadeStations(false);
  showSheet('<p class="muted">Finding routes…</p>');
  try {
    const from = state.from || await currentPosition();
    if (id !== planCounter) return;
    origin = from;
    const params = new URLSearchParams({
      fromPlace: `${from.lat},${from.lon}`,
      toPlace: `${state.to.lat},${state.to.lon}`,
      preTransitModes: 'WALK,RENTAL',
      postTransitModes: 'WALK,RENTAL',
      directModes: 'WALK,RENTAL',
      preTransitRentalProviders: BAJS_PROVIDER,
      postTransitRentalProviders: BAJS_PROVIDER,
      directRentalProviders: BAJS_PROVIDER,
      maxDirectTime: MAX_DIRECT_SECONDS,
    });
    const data = await fetchJson(`${TRANSITOUS}/api/v6/plan?${params}`);
    if (id !== planCounter) return;
    itineraries = uniqueByArrival([...(data.direct || []), ...(data.itineraries || [])]);
    if (!itineraries.length) {
      return showSheet('<p>No routes found. If the start or destination is off the street network (e.g. in a lake), pick a point on a street.</p>');
    }
    selectItinerary(0);
  } catch (err) {
    if (id === planCounter) showSheet(`<p>${esc(err.message)}</p>`);
  }
}

// Transitous may return the same direct trip twice; sort the rest by arrival time.
function uniqueByArrival(list) {
  const seen = new Set();
  return list
    .filter((it) => {
      const key = it.legs.map((leg) => `${leg.mode}:${leg.routeShortName || ''}:${leg.startTime}`).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.endTime) - new Date(b.endTime));
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    const failed = () => reject(new Error('Could not get your location. Type a start point in "From".'));
    if (!navigator.geolocation) return failed();
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      failed,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

function clearRoute() {
  planCounter++;
  itineraries = [];
  state.to = null;
  inputs.to.value = '';
  routeLayer.clearLayers();
  fadeStations(false);
  sheet.hidden = true;
}

// Results sheet --------------------------------------------------------------

function showSheet(body) {
  sheet.innerHTML = `
    <div class="sheet-head">
      <b>To ${esc(state.to?.name || '')}</b>
      <button type="button" class="sheet-close" aria-label="Close route">×</button>
    </div>
    ${body}`;
  sheet.hidden = false;
}

sheet.addEventListener('click', (e) => {
  if (e.target.closest('.sheet-close')) return clearRoute();
  const option = e.target.closest('[data-option]');
  if (option) selectItinerary(Number(option.dataset.option));
});

// Leaflet's bottom controls (locate, zoom) move up above the sheet.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--sheet-height', `${sheet.hidden ? 0 : sheet.offsetHeight}px`);
}).observe(sheet);

function selectItinerary(index) {
  selected = index;
  showSheet(`<ol class="options">${itineraries.map(optionHtml).join('')}</ol>`);
  sheet.querySelector('.option.selected')?.scrollIntoView({ block: 'nearest' });
  drawItinerary(itineraries[index]);
}

function optionHtml(it, index) {
  const isSelected = index === selected;
  const chips = it.legs
    .filter((leg) => legKind(leg) !== 'walk' || leg.duration >= 180 || it.legs.length === 1)
    .map(legChip)
    .join('');
  return `<li>
    <button type="button" class="option${isSelected ? ' selected' : ''}" data-option="${index}">
      <span class="option-times">${formatTime(it.startTime)} – ${formatTime(it.endTime)}</span>
      <span class="option-duration">${formatDuration(it.duration)}</span>
      <span class="option-legs">${chips}</span>
    </button>
    ${isSelected ? stepsHtml(it) : ''}
  </li>`;
}

function legChip(leg) {
  const kind = legKind(leg);
  const label = kind === 'walk' || kind === 'bajs' ? formatDuration(leg.duration) : leg.routeShortName || LEG_LABELS[kind];
  return `<span class="leg leg-${kind}" style="--leg-color:${LEG_COLORS[kind]}">${LEG_ICONS[kind]} ${esc(label)}</span>`;
}

function stepsHtml(it) {
  const rows = it.legs
    .filter((leg) => legKind(leg) !== 'walk' || leg.duration >= 60)
    .map((leg) => {
      const kind = legKind(leg);
      return `<li>
        <span class="step-time">${formatTime(leg.startTime)}</span>
        <span class="step-icon" style="background:${LEG_COLORS[kind]}">${LEG_ICONS[kind]}</span>
        <span>${stepText(leg, kind)}</span>
      </li>`;
    });
  rows.push(`<li>
    <span class="step-time">${formatTime(it.endTime)}</span>
    <span class="step-icon step-end">⚑</span>
    <span>Arrive at ${esc(state.to.name)}</span>
  </li>`);
  return `<ol class="steps">${rows.join('')}</ol>`;
}

function stepText(leg, kind) {
  const duration = formatDuration(leg.duration);
  if (kind === 'walk') {
    const distance = leg.distance ? ` <small>(${formatDistance(leg.distance)})</small>` : '';
    return `Walk ${duration} to ${esc(placeName(leg.to))}${distance}`;
  }
  if (kind === 'bajs') {
    const rental = leg.rental || {};
    const link = /^https:\/\//.test(rental.rentalUriWeb || '')
      ? `<br><a href="${esc(rental.rentalUriWeb)}" target="_blank" rel="noopener">Open station in nextbike app →</a>`
      : '';
    return `Ride a Bajs bike ${duration}<br><small>${esc(rental.fromStationName || leg.from.name)} → ${esc(rental.toStationName || leg.to.name)}</small>${link}`;
  }
  return `${LEG_LABELS[kind]} <b>${esc(leg.routeShortName || '')}</b> → ${esc(leg.headsign || leg.to.name)}${delayHtml(leg)}
    <br><small>${esc(leg.from.name)} → ${esc(leg.to.name)} · ${duration}</small>`;
}

function delayHtml(leg) {
  if (!leg.realTime) return '';
  const minutes = Math.round((new Date(leg.startTime) - new Date(leg.scheduledStartTime)) / 60000);
  if (minutes > 0) return ` <span class="late">+${minutes} min</span>`;
  if (minutes < 0) return ` <span class="early">${minutes} min</span>`;
  return ' <span class="on-time">on time</span>';
}

// Transitous names coordinate endpoints START and END.
function placeName(place) {
  if (place.name === 'START') return origin?.name || 'start';
  if (place.name === 'END') return state.to?.name || 'destination';
  return place.name;
}

function legKind(leg) {
  if (leg.mode === 'WALK') return 'walk';
  if (leg.mode === 'RENTAL') return 'bajs';
  if (leg.mode === 'TRAM') return 'tram';
  if (leg.mode === 'BUS' || leg.mode === 'COACH') return 'bus';
  return 'train';
}

// Map drawing ----------------------------------------------------------------

function drawItinerary(it) {
  routeLayer.clearLayers();
  fadeStations(true);
  const bounds = L.latLngBounds([]);
  for (const leg of it.legs) {
    const points = decodePolyline(leg.legGeometry.points, leg.legGeometry.precision);
    if (!points.length) continue;
    const kind = legKind(leg);
    const walk = kind === 'walk';
    L.polyline(points, { pane: 'route', interactive: false, color: '#fff', weight: walk ? 7 : 10, opacity: 0.9 }).addTo(routeLayer);
    L.polyline(points, {
      pane: 'route',
      interactive: false,
      color: LEG_COLORS[kind],
      weight: walk ? 4 : 6,
      dashArray: walk ? '1 8' : null,
    }).addTo(routeLayer);
    bounds.extend(points);
  }
  const first = it.legs[0].from;
  const last = it.legs[it.legs.length - 1].to;
  L.circleMarker([first.lat, first.lon], { pane: 'route', interactive: false, radius: 7, color: '#212529', weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(routeLayer);
  L.circleMarker([last.lat, last.lon], { pane: 'route', interactive: false, radius: 7, color: '#fff', weight: 3, fillColor: '#212529', fillOpacity: 1 }).addTo(routeLayer);

  const top = map.getContainer().querySelector('.leaflet-top.leaflet-left').offsetHeight;
  map.fitBounds(bounds, { paddingTopLeft: [20, top + 10], paddingBottomRight: [20, sheet.offsetHeight + 20] });
}

// Station dots stay tappable but fade so the route stands out.
function fadeStations(fade) {
  map.getPane('stations').classList.toggle('faded', fade);
}

// Google encoded polyline; Transitous v6 uses precision 6.
function decodePolyline(encoded, precision) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lon']) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lon += delta;
    }
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

// Helpers --------------------------------------------------------------------

function formatTime(iso) {
  return timeFormat.format(new Date(iso));
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error('Could not reach the route planner. Check your connection.');
  }
  if (!response.ok) throw new Error(`Route planner error (HTTP ${response.status}).`);
  return response.json();
}
