"""Download ZET + HŽPP timetables and the Bajs station list, write small JSON files for the map.

Usage:  python3 tools/build_data.py            (writes into ./data)
"""

import csv
import io
import json
import math
import sys
import tempfile
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ZET_GTFS = "https://www.zet.hr/gtfs-scheduled/latest"
HZPP_GTFS = "https://www.hzpp.hr/GTFS_files.zip"
BAJS_STATIONS = "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hd/en/station_information.json"

GTFS_TRAM, GTFS_RAIL, GTFS_BUS = "0", "2", "3"
OUT_DIR = Path(__file__).resolve().parent.parent / "data"
# Departures towards next stops within this many degrees count as one direction, and a
# direction needs this share of a platform's departures to get an arrow on the map.
SAME_DIRECTION_DEGREES = 45
MIN_DIRECTION_SHARE = 0.15


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


def served_stops(zf, wanted_route_types):
    """Return {stop_id: details} for stops that are actually served, where details has
    "lines" ({route_type: {route_short_name, ...}}), "directions" ({headsign: {line, ...}},
    departures only) and "bearings" (degrees from north towards the next stops, busiest first)."""
    routes = {
        r["route_id"]: (r["route_type"], r["route_short_name"])
        for r in read_csv(zf, "routes.txt")
        if r["route_type"] in wanted_route_types
    }
    trips = {
        t["trip_id"]: (t["route_id"], t.get("trip_headsign", ""))
        for t in read_csv(zf, "trips.txt")
        if t["route_id"] in routes
    }
    stops_by_trip = {}
    for st in read_csv(zf, "stop_times.txt"):
        if st["trip_id"] in trips:
            stops_by_trip.setdefault(st["trip_id"], []).append((int(st["stop_sequence"]), st["stop_id"]))
    # Most trips repeat a few stop sequences; work per sequence, weighted by its number of trips.
    patterns = Counter()
    for trip_id, stop_list in stops_by_trip.items():
        patterns[(*trips[trip_id], tuple(stop_id for _, stop_id in sorted(stop_list)))] += 1
    del stops_by_trip

    coords, names = {}, {}
    for s in read_csv(zf, "stops.txt"):
        names[s["stop_id"]] = s["stop_name"]
        if float(s["stop_lat"] or 0) and float(s["stop_lon"] or 0):
            coords[s["stop_id"]] = (float(s["stop_lat"]), float(s["stop_lon"]))

    details = {}
    for (route_id, headsign, stop_ids), count in patterns.items():
        route_type, line = routes[route_id]
        headsign = headsign or names.get(stop_ids[-1], "")  # HŽPP trips have no headsign
        for here, after in zip(stop_ids, stop_ids[1:] + (None,)):
            d = details.setdefault(here, {"lines": {}, "directions": {}, "next": Counter()})
            d["lines"].setdefault(route_type, set()).add(line)
            if after is None or after == here:  # trips end here
                continue
            d["directions"].setdefault(headsign, set()).add(line)
            if here in coords and after in coords:
                d["next"][bearing(coords[here], coords[after])] += count
    for d in details.values():
        d["bearings"] = main_bearings(d.pop("next"))
    return details


def bearing(start, end):
    """Compass bearing in degrees from start to end, both (lat, lon); fine for short hops."""
    (lat1, lon1), (lat2, lon2) = start, end
    east = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    return round(math.degrees(math.atan2(east, lat2 - lat1))) % 360


def main_bearings(departures):
    """Group {bearing: departures} into directions; return the busy ones, busiest first."""
    groups = []  # [bearing of the busiest member, departures]
    for angle, count in departures.most_common():
        for group in groups:
            if abs((angle - group[0] + 180) % 360 - 180) <= SAME_DIRECTION_DEGREES:
                group[1] += count
                break
        else:
            groups.append([angle, count])
    total = sum(departures.values())
    return [angle for angle, count in sorted(groups, key=lambda g: -g[1]) if count >= MIN_DIRECTION_SHARE * total]


def directions_list(directions):
    """[{"to": headsign, "lines": [...]}, ...] ordered by their lowest line number."""
    items = [
        {"to": headsign, "lines": sorted((line for line in lines if line), key=line_sort_key)}
        for headsign, lines in directions.items()
        if headsign
    ]
    return sorted(items, key=lambda d: (line_sort_key(d["lines"][0]) if d["lines"] else (2, 0, ""), d["to"]))


def line_sort_key(name):
    return (0, int(name), "") if name.isdigit() else (1, 0, name)


def round_coord(value):
    return round(float(value), 6)


def zet_stops(path):
    with zipfile.ZipFile(path) as zf:
        served = served_stops(zf, {GTFS_TRAM, GTFS_BUS})
        stops = []
        for s in read_csv(zf, "stops.txt"):
            details = served.get(s["stop_id"])
            if not details:  # parent stations and unused platforms
                continue
            if not float(s["stop_lat"] or 0) or not float(s["stop_lon"] or 0):
                print(f"  skipping ZET stop without coordinates: {s['stop_name']} ({s['stop_id']})")
                continue
            tram = sorted(details["lines"].get(GTFS_TRAM, ()), key=line_sort_key)
            bus = sorted(details["lines"].get(GTFS_BUS, ()), key=line_sort_key)
            stops.append({
                "name": s["stop_name"],
                "lat": round_coord(s["stop_lat"]),
                "lon": round_coord(s["stop_lon"]),
                "kind": "tram" if tram else "bus",
                "tram": tram,
                "bus": bus,
                "directions": directions_list(details["directions"]),
                "bearings": details["bearings"],
            })
    return stops


def train_stations(path, bbox):
    """Train stations inside the ZET service area (HŽPP covers all of Croatia).
    One station serves both ways, so it gets destinations but no direction arrow."""
    min_lat, min_lon, max_lat, max_lon = bbox
    with zipfile.ZipFile(path) as zf:
        served = served_stops(zf, {GTFS_RAIL})
        stations = []
        for s in read_csv(zf, "stops.txt"):
            lat, lon = round_coord(s["stop_lat"]), round_coord(s["stop_lon"])
            if s["stop_id"] in served and min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                stations.append({
                    "name": s["stop_name"],
                    "lat": lat,
                    "lon": lon,
                    "kind": "train",
                    "tram": [],
                    "bus": [],
                    "directions": directions_list(served[s["stop_id"]]["directions"]),
                    "bearings": [],
                })
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
