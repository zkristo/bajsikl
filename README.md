# bajsikl

**Live:** https://zkristo.github.io/bajsikl/

Mobile web map of ZET tram/bus stops, HŽ train stations and Bajs bike stations in Zagreb.
Tap a stop to see where its trams, buses or trains go and the nearest Bajs stations (and the other
way round). A Bajs station shows how many bikes it has right now (live from the Bajs feed).

Markers: grey rounded squares with a tram or bus icon, red for trains, blue circles with a bicycle
for Bajs. Zoomed out, each stop has one marker for all its platforms (its popup lists every
direction) and only the busiest tenth of bus stops is shown; from zoom 16 every platform has its own
marker.

Buttons (bottom right): 🔍 plan a route, light/dark mode (moon/sun), layers (which stations to show +
map style), and my location.

Map styles: **Clean** (default; OpenFreeMap "Liberty" without shop/POI icons, one-way arrows and
road shields), **Light** (OpenFreeMap "Positron") and **Detailed** (standard OpenStreetMap).
Dark mode uses OpenFreeMap "Dark"; picking a map style switches back to light mode.
Light/dark mode starts from the device setting. Your choices and hidden station types are remembered on the device.

## Route planning

Tap 🔍 and type a destination in **To**, tap *Route here* on a stop or Bajs station, or long-press
the map: that plans a route to the spot (or to the station under your finger) straight away.
**From** defaults to your location. Walk + Bajs + tram/bus/train options are drawn on the map like
on Google Maps: the chosen one in colour, the others in grey, each with its travel time; tap a grey
route or its label to switch. The panel at the bottom shows the chosen route; swipe it up (or tap it)
for step-by-step directions and later departures of the same route, down to minimise it again.

Routes come from our own [MOTIS](https://github.com/motis-project/motis) server at
`bajsikl.duckdns.org` (set up in [`server/`](server/)), the same software Transitous runs. Only Bajs
is allowed as a rental system.
MOTIS uses live ZET delays and Bajs availability, but its Bajs routing often skips the
nearest stations (it has sent people 7 minutes past two full ones) and rides along the quickest
streets, ignoring cycle tracks and signed cycle routes. So the app also plans the Bajs option
itself. Live counts from the
[Bajs GBFS feed](https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hd/en/station_status.json) say
which stations near the start have a bike and which near the destination take one back. A table of
cycle-friendly rides between all stations (made with [BRouter](https://brouter.de), which prefers
cycle tracks, at about 13.5 km/h on the flat) says which pair gets there first and gives the ride's
path. MOTIS routes the walks. MOTIS's own Bajs-only options are left out, and so is the Bajs option
when walking is as quick. Options that combine Bajs with public transport still come from MOTIS,
with its street-biased rides.

## Run

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. It must be served over HTTP(S), not opened as a file,
and "my location" only works on `localhost` or an HTTPS site.

## Refresh data

```sh
python3 tools/build_data.py
```

Rewrites `data/stops.json` and `data/bajs.json` from:

- ZET GTFS: https://www.zet.hr/gtfs-scheduled/latest
- HŽPP GTFS: https://www.hzpp.hr/GTFS_files.zip (only stations inside the ZET service area)
- Bajs GBFS: https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hd/en/station_information.json

The HŽPP timetable changes every December; rerun the script after that.

## claude.ai artifact version

```sh
python3 tools/build_artifact.py
```

Writes a version of the map that runs as a claude.ai artifact into `build/artifact/` (not committed):
`index.html` plus `tiles/*.txt`. Artifact pages can't load anything from other servers, so the page
carries the libraries pinned in `index.html`, `style.css`, `app.js`, `route.js` and the station data,
and the tiles folder holds OpenFreeMap's vector tiles, fonts and icons for the ZET service area
(zoom 9–14, about 30 MB; only the parts in view load). `tools/artifact/` has the artifact-only glue.
Downloads are cached in `build/cache/`; delete it to fetch fresh map data.

Publish `index.html` as the page with every `tiles/<name>.txt` beside it at the same path. In the
artifact, route planning, live bike counts and "my location" don't work (no outside servers, no
location access), and the "Detailed" map style stays blank.

## Route server

`server/` holds the setup of the MOTIS server on an Ubuntu VM (arm64, MOTIS v2.11.4 from its
releases page unpacked into `~/motis`):

- `config.yml`: Croatia street map (Geofabrik), ZET and HŽPP timetables, live ZET delays and the
  Bajs feed (named `hr-bajs`, as on Transitous). MOTIS listens on `127.0.0.1:8080` only.
- `Caddyfile`: HTTPS for `bajsikl.duckdns.org` in front of MOTIS (`/etc/caddy/Caddyfile`).
- `update.sh`: downloads fresh timetables (the street map on the 1st of the month or with `--osm`),
  imports into a new data folder and switches over only if the import and a test request succeed.
- `motis.service`, `motis-update.{service,timer}` (nightly at 03:30), `duckdns.{service,timer}`
  (keeps the name pointed at the VM; token in `~/.config/duckdns/token`): copy to
  `/etc/systemd/system/` and enable. Copy `config.yml` and `update.sh` to `~/motis`.

- `build_rides.py`: the table of rides between Bajs stations. It runs BRouter (unpacked into
  `~/brouter`, with the `E15_N45.rd5` segment file in `~/brouter/segments4`) over every pair of
  stations up to 10 km apart and writes `/var/www/bajsikl/rides`, which Caddy serves under
  `/rides/`. `update_rides.sh` (copy both to `~/motis`) refreshes BRouter's map data first;
  `bajs-rides.{service,timer}` run it weekly. BRouter only runs during the build.

Ports 80 and 443 must be open both in the Oracle security list and in the VM's `iptables`.
