# bajsikl

**Live:** https://zkristo.github.io/bajsikl/

Mobile web map of ZET tram/bus stops, HŽ train stations and Bajs bike stations in Zagreb.
Tap a stop to see where its trams, buses or trains go and the nearest Bajs stations (and the other
way round).

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

Tap 🔍 and type a destination in **To** (or tap *Route here* on a stop, a Bajs station, or after a
long-press on the map). **From** defaults to your location. You get walk + Bajs + tram/bus/train
options sorted by arrival time; tap one to see it on the map with step-by-step directions.
Swipe the results down to minimise them, up (or tap the header) to bring them back.

Routes come from the free [Transitous](https://transitous.org) API (non-commercial use only,
see its [usage policy](https://transitous.org/api/)). Only Bajs is allowed as a rental system.
Transitous uses live Bajs availability and ZET delays; the station layer on the map is static.

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
