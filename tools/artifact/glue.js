// Glue for the claude.ai artifact build (tools/build_artifact.py), loaded before app.js.
// An artifact can't reach other servers, so the station data, map styles and map tiles
// ship with the page, and errors show on the page because the viewer hides alert().
(() => {
  const notice = document.getElementById('notice');
  let noticeTimer;
  window.alert = (message) => {
    notice.textContent = String(message);
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 8000);
  };
  window.addEventListener('error', (e) => window.alert(`Error: ${e.message}`));

  // Requests app.js makes that are answered from <script type="application/json"> blocks.
  const local = {
    'data/stops.json': 'data-stops',
    'data/bajs.json': 'data-bajs',
    'https://tiles.openfreemap.org/styles/liberty': 'style-liberty',
    'https://tiles.openfreemap.org/styles/positron': 'style-positron',
    'https://tiles.openfreemap.org/styles/dark': 'style-dark',
  };
  const realFetch = window.fetch.bind(window);
  let routeWarned = false;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (local[url]) {
      const text = document.getElementById(local[url]).textContent;
      return Promise.resolve(new Response(text, { headers: { 'content-type': 'application/json' } }));
    }
    if (url.startsWith('https://api.transitous.org/') && !routeWarned) {
      routeWarned = true;
      window.alert('Route planning needs the Transitous server, which this artifact can\'t reach. Use zkristo.github.io/bajsikl for routes.');
    }
    return realFetch(input, init);
  };

  // Map styles ask for zgt://t/z/x/y (tiles), zgt://g/font/range (label glyphs) and
  // zgt://s/ofm... (map icons). They come from packs in tiles/: "lo" holds the low zooms,
  // glyphs and icons; c<x>_<y> the tiles under one tile at packZoom.
  const { packs: packNames, packZoom } = JSON.parse(document.getElementById('tile-packs').textContent);
  const available = new Set(packNames);
  const packs = new Map();
  let tilesWarned = false;

  function packName(key) {
    const tile = /^t\/(\d+)\/(\d+)\/(\d+)$/.exec(key);
    if (!tile) return 'lo';
    const [z, x, y] = tile.slice(1).map(Number);
    if (z < packZoom) return 'lo';
    const shift = z - packZoom;
    return `c${x >> shift}_${y >> shift}`;
  }

  // A pack is base64 text of gzip(u32 header length, JSON {key: [offset, length]}, data).
  function loadPack(name) {
    if (!packs.has(name)) {
      packs.set(name, (async () => {
        const response = await realFetch(new URL(`tiles/${name}.txt`, document.baseURI));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const binary = atob((await response.text()).trim());
        const gzipped = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) gzipped[i] = binary.charCodeAt(i);
        const stream = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream('gzip'));
        const buffer = await new Response(stream).arrayBuffer();
        const headerLength = new DataView(buffer).getUint32(0, true);
        const index = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
        return { buffer, index, start: 4 + headerLength };
      })());
    }
    return packs.get(name);
  }

  maplibregl.addProtocol('zgt', async (params) => {
    const key = decodeURIComponent(params.url.slice('zgt://'.length));
    const name = packName(key);
    let data = new ArrayBuffer(0); // outside the bundled area: an empty tile
    if (available.has(name)) {
      try {
        const pack = await loadPack(name);
        const hit = pack.index[key];
        if (hit) data = pack.buffer.slice(pack.start + hit[0], pack.start + hit[0] + hit[1]);
      } catch (err) {
        if (!tilesWarned) window.alert(`Map tiles could not load (${err.message}).`);
        tilesWarned = true;
      }
    }
    if (params.type === 'json') return { data: JSON.parse(new TextDecoder().decode(data) || 'null') };
    return { data };
  });
})();
