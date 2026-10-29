"""Download ZET + HŽPP timetables and the Bajs station list, write small JSON files for the map.

Usage:  python3 tools/build_data.py            (writes into ./data)
"""

import csv
import io
import json
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ZET_GTFS = "https://www.zet.hr/gtfs-scheduled/latest"
HZPP_GTFS = "https://www.hzpp.hr/GTFS_files.zip"
BAJS_STATIONS = "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hd/en/station_information.json"

GTFS_TRAM, GTFS_RAIL, GTFS_BUS = "0", "2", "3"
OUT_DIR = Path(__file__).resolve().parent.parent / "data"


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "zagreb-bajs-map/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    print(f"  {url} -> {dest.stat().st_size / 1e6:.1f} MB")
    return dest


def read_csv(zf, name):
    with zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))


def routes_per_stop(zf, wanted_route_types):
    """Return {stop_id: {route_type: {route_short_name, ...}}} for stops that are actually served."""
    routes = {
        r["route_id"]: (r["route_type"], r["route_short_name"])
        for r in read_csv(zf, "routes.txt")
        if r["route_type"] in wanted_route_types
    }
    trip_route = {t["trip_id"]: t["route_id"] for t in read_csv(zf, "trips.txt") if t["route_id"] in routes}
    served = {}
    for st in read_csv(zf, "stop_times.txt"):
        route_id = trip_route.get(st["trip_id"])
        if route_id is None:
            continue
        route_type, name = routes[route_id]
        served.setdefault(st["stop_id"], {}).setdefault(route_type, set()).add(name)
    return served


def line_sort_key(name):
    return (0, int(name), "") if name.isdigit() else (1, 0, name)


def round_coord(value):
    return round(float(value), 6)


def zet_stops(path):
    with zipfile.ZipFile(path) as zf:
        served = routes_per_stop(zf, {GTFS_TRAM, GTFS_BUS})
        stops = []
        for s in read_csv(zf, "stops.txt"):
            lines = served.get(s["stop_id"])
            if not lines:  # parent stations and unused platforms
                continue
            if not float(s["stop_lat"] or 0) or not float(s["stop_lon"] or 0):
                print(f"  skipping ZET stop without coordinates: {s['stop_name']} ({s['stop_id']})")
                continue
            tram = sorted(lines.get(GTFS_TRAM, ()), key=line_sort_key)
            bus = sorted(lines.get(GTFS_BUS, ()), key=line_sort_key)
            stops.append({
                "name": s["stop_name"],
                "lat": round_coord(s["stop_lat"]),
                "lon": round_coord(s["stop_lon"]),
                "kind": "tram" if tram else "bus",
                "tram": tram,
                "bus": bus,
            })
    return stops


def train_stations(path, bbox):
    """Train stations inside the ZET service area (HŽPP covers all of Croatia)."""
    min_lat, min_lon, max_lat, max_lon = bbox
    with zipfile.ZipFile(path) as zf:
        served = routes_per_stop(zf, {GTFS_RAIL})
        stations = []
        for s in read_csv(zf, "stops.txt"):
            lat, lon = round_coord(s["stop_lat"]), round_coord(s["stop_lon"])
            if s["stop_id"] in served and min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                stations.append({"name": s["stop_name"], "lat": lat, "lon": lon, "kind": "train", "tram": [], "bus": []})
    return stations


def bajs_stations(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return [
        {
            "name": s["name"],
            "number": s.get("short_name", ""),
            "lat": round_coord(s["lat"]),
            "lon": round_coord(s["lon"]),
            "capacity": s.get("capacity"),
            "url": s.get("rental_uris", {}).get("web", ""),
        }
        for s in data["data"]["stations"]
    ]


def write_json(name, items, sources):
    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sources": sources, "items": items}
    path = OUT_DIR / name
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {path} ({len(items)} items, {path.stat().st_size / 1e3:.0f} kB)")


def main():
    OUT_DIR.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="zagreb-bajs-") as tmp:
        tmp = Path(tmp)
        print("Downloading…")
        zet_zip = download(ZET_GTFS, tmp / "zet.zip")
        hzpp_zip = download(HZPP_GTFS, tmp / "hzpp.zip")
        bajs_json = download(BAJS_STATIONS, tmp / "bajs.json")

        print("Processing (stop_times.txt is large, this takes a moment)…")
        stops = zet_stops(zet_zip)
        lats = [s["lat"] for s in stops]
        lons = [s["lon"] for s in stops]
        stops += train_stations(hzpp_zip, (min(lats), min(lons), max(lats), max(lons)))
        bajs = bajs_stations(bajs_json)

    write_json("stops.json", stops, [ZET_GTFS, HZPP_GTFS])
    write_json("bajs.json", bajs, [BAJS_STATIONS])


if __name__ == "__main__":
    sys.exit(main())
