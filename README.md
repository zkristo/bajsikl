# bajsikl

**Live:** https://zkristo.github.io/bajsikl/

Mobile web map of ZET tram/bus stops, HŽ train stations and Bajs bike stations in Zagreb.
Tap a stop to see the nearest Bajs stations (and the other way round).

Buttons (bottom right): 🔍 plan a route, layers (which stations to show + map style), and my location.

Map styles: **Clean** (default; OpenFreeMap "Liberty" without shop/POI icons, one-way arrows and
road shields), **Light** (OpenFreeMap "Positron") and **Detailed** (standard OpenStreetMap).
The choice and hidden station types are remembered on the device.

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
