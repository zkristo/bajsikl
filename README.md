# bajsikl

**Live:** https://zkristo.github.io/bajsikl/

Mobile web map of ZET tram/bus stops, HŽ train stations and Bajs bike stations in Zagreb.
Tap a stop to see the nearest Bajs stations (and the other way round); ◎ shows what's near you.

Static data only for now: station locations and lines, no live bikes or vehicles.

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
