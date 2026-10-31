// Route planning with Transitous (https://transitous.org): walk + Bajs + ZET/HŽ.
// Loaded after app.js and uses its map, palette and helpers (esc, formatDistance).

const TRANSITOUS = 'https://api.transitous.org';
const BAJS_PROVIDER = 'hr-bajs';
const MAX_DIRECT_SECONDS = 3600; // the 30 min default hides most "Bajs all the way" trips

const LEG_ICONS = { walk: '🚶', bajs: '🚲', tram: '🚋', bus: '🚌', train: '🚆' };
const LEG_LABELS = { tram: 'Tram', bus: 'Bus', train: 'Train' };
const PLACE_TYPES = { STOP: 'Stop', ADDRESS: 'Address', PLACE: 'Place' };
const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';

const timeFormat = new Intl.DateTimeFormat('hr-HR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zagreb' });

const state = { from: null, to: null }; // from = null means "my location"
let origin = null; // resolved start point of the current route
let itineraries = []; // one per distinct route, the soonest; these are drawn on the map
let allItineraries = []; // also later departures of the same routes
let selected = 0;
let planCounter = 0;
let suggestCounter = 0;
let suggestions = [];
let suggestField = null;
let routeBounds = null;
let sheetCollapsed = false;

// Routes are drawn above the stations. The chosen one lets taps through to them; the
// grey alternatives below it take taps on their lines (the pane itself lets taps through).
map.createPane('route').style.zIndex = 415;
map.getPane('route').style.pointerEvents = 'none';
map.createPane('routeAlt').style.zIndex = 414;
map.getPane('routeAlt').style.pointerEvents = 'none';
const routeLayer = L.layerGroup().addTo(map);

// From/To box ----------------------------------------------------------------

// Hidden until the search button (or "Route here" in a popup) opens it.
const RouteBox = L.Control.extend({
  onAdd() {
    const box = L.DomUtil.create('div', 'route-box');
    box.hidden = true;
    box.innerHTML = `
      <label class="route-field"><span>From</span><input id="route-from" type="text" placeholder="My location" autocomplete="off" enterkeyhint="search"></label>
      <button type="button" class="route-close" title="Close">×</button>
      <label class="route-field"><span>To</span><input id="route-to" type="text" placeholder="Where to?" autocomplete="off" enterkeyhint="search"></label>
      <button type="button" class="swap" title="Swap start and destination">⇅</button>
      <ul class="suggestions" hidden></ul>`;
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  },
});
const routeBox = new RouteBox({ position: 'topleft' }).addTo(map).getContainer();

const SearchControl = L.Control.extend({
  onAdd() {
    const button = L.DomUtil.create('button', 'map-btn search-btn');
    button.type = 'button';
    button.title = 'Plan a route';
    button.innerHTML = SEARCH_ICON;
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, 'click', () => openRouteBox({ focus: true }));
    return button;
  },
});
new SearchControl({ position: 'bottomright' }).addTo(map);

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

routeBox.querySelector('.swap').addEventListener('click', swapEndpoints);
routeBox.querySelector('.route-close').addEventListener('click', closeRouting);

function openRouteBox({ focus = false } = {}) {
  routeBox.hidden = false;
  map.getContainer().classList.add('routing');
  if (focus) {
    map.closePopup();
    inputs.to.focus();
  }
}

// Hide the box and the route; the next search starts from "my location" again.
function closeRouting() {
  clearRoute();
  state.from = null;
  inputs.from.value = '';
  hideSuggestions();
  routeBox.hidden = true;
  map.getContainer().classList.remove('routing');
}

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
  openRouteBox();
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

// "Route here" button in station popups.

function routeActions(name, latlng) {
  return `<div class="route-actions">
    <button type="button" data-route="to" data-name="${esc(name)}" data-lat="${latlng.lat}" data-lon="${latlng.lng}">Route here</button>
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

// A long press (right click on a computer) plans a route to that spot, or to the station
// whose marker is under the finger.
map.on('contextmenu', (e) => {
  map.closePopup();
  const place = places.find((p) => p.marker._map && map.latLngToContainerPoint(p.latlng).distanceTo(e.containerPoint) <= p.marker.getRadius() + 8);
  if (place) return setEndpoint('to', { name: place.name, lat: place.lat, lon: place.lon });
  setEndpoint('to', { name: 'Point on map', lat: e.latlng.lat, lon: e.latlng.lng });
  nameDroppedPoint(state.to);
});

// Swap "Point on map" for the nearest address or place, when Transitous knows one.
async function nameDroppedPoint(point) {
  try {
    const matches = await fetchJson(`${TRANSITOUS}/api/v1/reverse-geocode?place=${point.lat},${point.lon}`);
    const match = matches.find((m) => m.type === 'ADDRESS') || matches[0];
    if (!match?.name || state.to !== point) return;
    point.name = match.name;
    inputs.to.value = match.name;
    const title = sheet.querySelector('.sheet-title b');
    if (title) title.textContent = `To ${match.name}`;
  } catch {
    // Keep "Point on map".
  }
}

// Planning -------------------------------------------------------------------

async function planRoute() {
  const id = ++planCounter;
  itineraries = [];
  allItineraries = [];
  selected = 0;
  routeLayer.clearLayers();
  routeBounds = null;
  fadeStations(false);
  setSheetCollapsed(false);
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
    allItineraries = uniqueByArrival([...(data.direct || []), ...(data.itineraries || [])]);
    itineraries = allItineraries.filter((it, i) => allItineraries.findIndex((other) => routeKey(other) === routeKey(it)) === i);
    if (!itineraries.length) {
      return showSheet('<p>No routes found. If the start or destination is off the street network (e.g. in a lake), pick a point on a street.</p>');
    }
    setSheetCollapsed(true); // the routes are on the map; directions are a swipe up
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

// The same way there (modes, lines and stops), whatever the time.
function routeKey(it) {
  return it.legs.map((leg) => `${leg.mode}:${leg.routeShortName || ''}:${leg.from.name}>${leg.to.name}`).join('|');
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
  allItineraries = [];
  state.to = null;
  inputs.to.value = '';
  routeLayer.clearLayers();
  routeBounds = null;
  fadeStations(false);
  setSheetCollapsed(false);
  sheet.hidden = true;
}

// Results sheet --------------------------------------------------------------

// `summary` is the chosen route, always shown; the body (directions) hides when minimised.
function showSheet(body, summary = '') {
  sheet.innerHTML = `
    <div class="sheet-head">
      <div class="sheet-grip"></div>
      <div class="sheet-title">
        <b>To ${esc(state.to?.name || '')}</b>
        <button type="button" class="sheet-close" aria-label="Close route">×</button>
      </div>
      ${summary ? `<div class="sheet-summary">${summary}</div>` : ''}
    </div>
    <div class="sheet-body">${body}</div>`;
  sheet.hidden = false;
}

sheet.addEventListener('click', (e) => {
  if (e.target.closest('.sheet-close')) return closeRouting();
  if (e.target.closest('.sheet-head')) setSheetCollapsed(!sheetCollapsed);
});

function setSheetCollapsed(collapsed) {
  sheetCollapsed = collapsed;
  sheet.classList.toggle('collapsed', collapsed);
  if (collapsed) sheet.scrollTop = 0;
  fitRoute();
}

// Swipe the sheet down to minimise it (from its header, or anywhere once scrolled
// to the top) and up to bring it back.
let swipe = null;

sheet.addEventListener('touchstart', (e) => {
  swipe = {
    startY: e.touches[0].clientY,
    dy: 0,
    canPull: sheet.scrollTop <= 0 || Boolean(e.target.closest('.sheet-head')),
  };
  sheet.style.transition = 'none';
}, { passive: true });

sheet.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  swipe.dy = e.touches[0].clientY - swipe.startY;
  if (!sheetCollapsed && swipe.canPull && swipe.dy > 0) {
    e.preventDefault(); // pull the sheet instead of scrolling its content
    sheet.style.transform = `translateY(${swipe.dy}px)`;
  }
}, { passive: false });

sheet.addEventListener('touchend', () => {
  if (!swipe) return;
  sheet.style.transition = '';
  sheet.style.transform = '';
  if (!sheetCollapsed && swipe.canPull && swipe.dy > 60) setSheetCollapsed(true);
  else if (sheetCollapsed && swipe.dy < -30) setSheetCollapsed(false);
  swipe = null;
});

// Leaflet's bottom controls (locate, zoom) move up above the sheet.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--sheet-height', `${sheet.hidden ? 0 : sheet.offsetHeight}px`);
}).observe(sheet);

// The other options are on the map (drawRoutes); the sheet shows the chosen one.
function selectItinerary(index, { fit = true } = {}) {
  selected = index;
  const others = itineraries.length - 1;
  const hint = others
    ? `<span class="route-hint">${others === 1 ? '1 other route' : `${others} other routes`} in grey on the map: tap one to switch</span>`
    : '';
  showSheet(stepsHtml(itineraries[index]) + laterHtml(itineraries[index]), optionSummary(itineraries[index]) + hint);
  drawRoutes({ fit });
}

function laterHtml(it) {
  const later = allItineraries.filter((other) => other !== it && routeKey(other) === routeKey(it));
  return later.length
    ? `<p class="muted">Same route later: ${later.map((other) => `${formatTime(other.startTime)} → ${formatTime(other.endTime)}`).join(', ')}</p>`
    : '';
}

function optionSummary(it) {
  const chips = it.legs
    .filter((leg) => legKind(leg) !== 'walk' || leg.duration >= 180 || it.legs.length === 1)
    .map(legChip)
    .join('');
  return `<span class="option-times">${formatTime(it.startTime)} – ${formatTime(it.endTime)}</span>
    <span class="option-duration">${formatDuration(it.duration)}</span>
    <span class="option-legs">${chips}</span>`;
}

function legChip(leg) {
  const kind = legKind(leg);
  const label = kind === 'walk' || kind === 'bajs' ? formatDuration(leg.duration) : leg.routeShortName || LEG_LABELS[kind];
  return `<span class="leg kind-${kind}">${LEG_ICONS[kind]} ${esc(label)}</span>`;
}

function stepsHtml(it) {
  const rows = it.legs
    .filter((leg) => legKind(leg) !== 'walk' || leg.duration >= 60)
    .map((leg) => {
      const kind = legKind(leg);
      return `<li>
        <span class="step-time">${formatTime(leg.startTime)}</span>
        <span class="step-icon kind-${kind}">${LEG_ICONS[kind]}</span>
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

// Like Google Maps: the chosen route in its colours on top, the other options in grey
// underneath, each with a label (travel time); tapping a grey route or its label picks it.
function drawRoutes({ fit = true } = {}) {
  routeLayer.clearLayers();
  fadeStations(true);
  const bounds = L.latLngBounds([]);
  const paths = itineraries.map((it) => it.legs.map((leg) => ({
    kind: legKind(leg),
    points: decodePolyline(leg.legGeometry.points, leg.legGeometry.precision),
  })));

  paths.forEach((legs, index) => {
    if (index === selected) return;
    const pick = () => selectItinerary(index, { fit: false });
    for (const { points } of legs.filter((leg) => leg.points.length)) {
      L.polyline(points, { pane: 'routeAlt', interactive: false, color: '#fff', weight: 6, opacity: 0.8 }).addTo(routeLayer);
      L.polyline(points, { pane: 'routeAlt', interactive: false, color: palette.alt.fill, weight: 4 }).addTo(routeLayer);
      L.polyline(points, { pane: 'routeAlt', opacity: 0, weight: 20 }).on('click', pick).addTo(routeLayer); // easier to tap
      bounds.extend(points);
    }
  });

  for (const { kind, points } of paths[selected].filter((leg) => leg.points.length)) {
    const walk = kind === 'walk';
    L.polyline(points, { pane: 'route', interactive: false, color: '#fff', weight: walk ? 5 : 6, opacity: 0.9 }).addTo(routeLayer);
    L.polyline(points, {
      pane: 'route',
      interactive: false,
      color: palette[kind].fill,
      weight: walk ? 3 : 4,
      dashArray: walk ? '1 6' : null,
    }).addTo(routeLayer);
    bounds.extend(points);
  }
  const it = itineraries[selected];
  const first = it.legs[0].from;
  const last = it.legs[it.legs.length - 1].to;
  L.circleMarker([first.lat, first.lon], { pane: 'route', interactive: false, radius: 5, color: '#212529', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(routeLayer);
  L.circleMarker([last.lat, last.lon], { pane: 'route', interactive: false, radius: 5, color: '#fff', weight: 2, fillColor: '#212529', fillOpacity: 1 }).addTo(routeLayer);

  routeBounds = bounds;
  const { paddingTopLeft, paddingBottomRight } = fitPadding();
  const zoom = fit ? map.getBoundsZoom(bounds, false, paddingTopLeft.add(paddingBottomRight)) : map.getZoom();
  labelPoints(paths, zoom).forEach((point, index) => {
    // A zero-size icon: the label overflows it, centred by CSS, so no invisible box covers a neighbour.
    const icon = L.divIcon({ className: `route-label${index === selected ? ' selected' : ''}`, html: `<span>${routeLabel(itineraries[index])}</span>`, iconSize: [0, 0] });
    L.marker(point, { icon, title: `Route ${index + 1}`, zIndexOffset: index === selected ? 1000 : 0 })
      .on('click', () => selectItinerary(index, { fit: false }))
      .addTo(routeLayer);
  });
  if (fit) fitRoute();
}

function routeLabel(it) {
  const kinds = [...new Set(it.legs.map(legKind).filter((kind) => kind !== 'walk'))];
  return `${(kinds.length ? kinds : ['walk']).map((kind) => LEG_ICONS[kind]).join('')} ${formatDuration(it.duration)}`;
}

// Where each route's label goes. Best is a point of the route's middle part far from the
// other routes, where the routes split up; labels are placed chosen route first, each at its
// best point that keeps clear of the labels already placed (in pixels at `zoom`).
function labelPoints(paths, zoom) {
  const points = [];
  const placed = [];
  // How clear of the placed labels a point is: 1 and more means no overlap.
  const gap = (p) => Math.min(...placed.map((q) => Math.max(Math.abs(p.x - q.x) / 80, Math.abs(p.y - q.y) / 30)));
  for (const index of [selected, ...paths.keys()].filter((i, n, all) => all.indexOf(i) === n)) {
    const ranked = rankedLabelPoints(paths, index).map((latlng) => ({ latlng, px: map.project(latlng, zoom) }));
    // Routes along the same streets may leave no clear point: then the least crowded one.
    const best = ranked.find(({ px }) => gap(px) >= 1) || ranked.reduce((a, b) => (gap(b.px) > gap(a.px) ? b : a));
    points[index] = best.latlng;
    placed.push(best.px);
  }
  return points;
}

function rankedLabelPoints(paths, index) {
  const own = paths[index].flatMap((leg) => leg.points);
  const others = paths.flatMap((legs, i) => (i === index ? [] : legs.flatMap((leg) => leg.points)));
  const middle = own.slice(Math.floor(own.length * 0.05), Math.ceil(own.length * 0.95));
  const candidates = middle.length ? middle : own;
  const step = Math.max(1, Math.floor(candidates.length / 60));
  const scored = [];
  for (let i = 0; i < candidates.length; i += step) {
    const [lat, lon] = candidates[i];
    let nearest = Infinity;
    for (const [otherLat, otherLon] of others) {
      nearest = Math.min(nearest, (lat - otherLat) ** 2 + ((lon - otherLon) * 0.7) ** 2); // 0.7 ≈ cos(Zagreb's latitude)
    }
    // Among equally clear points, prefer the middle of the route.
    scored.push({ point: candidates[i], score: (others.length ? nearest : 0) - Math.abs(i / candidates.length - 0.5) * 1e-9 });
  }
  return scored.sort((a, b) => b.score - a.score).map(({ point }) => point);
}

// Route colours follow light/dark mode; repaint without moving the map.
document.addEventListener('themechange', () => {
  if (itineraries.length) drawRoutes({ fit: false });
});

// Fit the routes into the map area left visible by the From/To box and the sheet.
function fitRoute() {
  if (routeBounds) map.fitBounds(routeBounds, fitPadding());
}

function fitPadding() {
  const top = routeBox.hidden ? 0 : routeBox.offsetHeight + 10;
  return { paddingTopLeft: L.point(20, top + 20), paddingBottomRight: L.point(70, sheet.offsetHeight + 20) };
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
