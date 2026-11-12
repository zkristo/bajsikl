#!/usr/bin/env python3
"""Precompute the cycle-friendly ride between every pair of Bajs stations with BRouter.

MOTIS routes bikes along the quickest streets and ignores cycle tracks and signed cycle
routes. BRouter's "trekking" profile prefers them, so the app takes Bajs rides from the
table this script writes:

  OUT/index.json          station ids and the seconds / metres of every ride
  OUT/<from>/<to>.json    one ride: seconds, metres and its path (encoded polyline)

BRouter (jar, profiles and the segment file covering Zagreb) is expected in ~/brouter;
this script starts it on localhost for the run and stops it afterwards.

Usage: build_rides.py OUT [--sample N]
"""

import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

STATIONS_URL = "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hd/en/station_information.json"
BROUTER = Path.home() / "brouter"
PORT = 17777
THREADS = 4
MAX_BEELINE_METERS = 10_000  # longer rides are not planned as Bajs trips
POLYLINE_PRECISION = 5

# Bajs bikes are heavy and upright: about 13.5 km/h on the flat instead of trekking's 22.
PROFILE_CHANGES = {
    "assign totalMass  = 90 ": "assign totalMass  = 105 ",
    "assign S_C_x      = 0.225 ": "assign S_C_x      = 0.35 ",
    "assign bikerPower = 100 ": "assign bikerPower = 55 ",
}


def write_profile(profiles):
    text = (profiles / "trekking.brf").read_text()
    for old, new in PROFILE_CHANGES.items():
        if old not in text:
            sys.exit(f"trekking.brf has no line starting with {old!r}")
        text = text.replace(old, new)
    (profiles / "bajs.brf").write_text(text)


def start_brouter():
    release = sorted(BROUTER.glob("brouter-*/"))[-1]
    write_profile(release / "profiles2")
    jar = next(release.glob("brouter-*-all.jar"))
    custom = BROUTER / "custom"
    custom.mkdir(exist_ok=True)
    process = subprocess.Popen(
        ["java", "-Xmx1g", "-cp", str(jar), "btools.server.RouteServer", str(BROUTER / "segments4"),
         str(release / "profiles2"), str(custom), str(PORT), str(THREADS), "127.0.0.1"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(30):
        time.sleep(1)
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=2)
        except urllib.error.HTTPError:
            return process  # it answers, with an error for the empty request
        except OSError:
            continue
        return process
    process.kill()
    sys.exit("BRouter did not start")


def beeline(a, b):
    lat = math.radians((a["lat"] + b["lat"]) / 2)
    x = math.radians(b["lon"] - a["lon"]) * math.cos(lat)
    y = math.radians(b["lat"] - a["lat"])
    return 6371000 * math.hypot(x, y)


def encode_polyline(points):
    out = []
    last = [0, 0]
    for lon, lat in points:
        for i, value in enumerate((lat, lon)):
            scaled = round(value * 10 ** POLYLINE_PRECISION)
            delta = scaled - last[i]
            last[i] = scaled
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 0x20:
                out.append(chr((0x20 | (delta & 0x1F)) + 63))
                delta >>= 5
            out.append(chr(delta + 63))
    return "".join(out)


def ride(a, b):
    """Seconds, metres and path from station a to b, or None when BRouter finds no way."""
    url = (f"http://127.0.0.1:{PORT}/brouter?lonlats={a['lon']},{a['lat']}|{b['lon']},{b['lat']}"
           "&profile=bajs&alternativeidx=0&format=geojson")
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            feature = json.load(response)["features"][0]
    except (OSError, ValueError, KeyError, IndexError):
        return None
    properties = feature["properties"]
    return {
        "seconds": int(properties["total-time"]),
        "meters": int(properties["track-length"]),
        "precision": POLYLINE_PRECISION,
        "points": encode_polyline([p[:2] for p in feature["geometry"]["coordinates"]]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--sample", type=int, help="route only N random pairs and report the time")
    args = parser.parse_args()

    with urllib.request.urlopen(STATIONS_URL, timeout=60) as response:
        stations = sorted(
            ({"id": s["station_id"], "lat": s["lat"], "lon": s["lon"]} for s in json.load(response)["data"]["stations"]),
            key=lambda s: s["id"])
    pairs = [(a, b) for a in stations for b in stations
             if a is not b and beeline(a, b) <= MAX_BEELINE_METERS]
    print(f"{len(stations)} stations, {len(pairs)} rides of up to {MAX_BEELINE_METERS / 1000:.0f} km")
    if args.sample:
        pairs = random.sample(pairs, args.sample)

    tmp = args.out.with_name(args.out.name + ".new")
    shutil.rmtree(tmp, ignore_errors=True)
    for station in stations:
        (tmp / station["id"]).mkdir(parents=True)

    process = start_brouter()
    started = time.time()
    try:
        with ThreadPoolExecutor(THREADS) as pool:
            rides = list(pool.map(lambda pair: ride(*pair), pairs))
    finally:
        process.terminate()
    seconds = time.time() - started
    missing = sum(r is None for r in rides)
    print(f"{len(pairs)} rides in {seconds:.0f} s ({seconds / len(pairs) * 1000:.0f} ms each), {missing} without a route")
    if args.sample:
        shutil.rmtree(tmp)
        return
    if missing > len(pairs) / 20:
        shutil.rmtree(tmp)
        sys.exit("too many rides without a route; keeping the old table")

    index = {station["id"]: {} for station in stations}
    for (a, b), found in zip(pairs, rides):
        if found:
            index[a["id"]][b["id"]] = [found["seconds"], found["meters"]]
            (tmp / a["id"] / f"{b['id']}.json").write_text(json.dumps(found, separators=(",", ":")))
    (tmp / "index.json").write_text(json.dumps({
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rides": index,  # from station id -> to station id -> [seconds, metres]
    }, separators=(",", ":")))

    old = args.out.with_name(args.out.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if args.out.exists():
        os.rename(args.out, old)
    os.rename(tmp, args.out)
    shutil.rmtree(old, ignore_errors=True)


if __name__ == "__main__":
    main()
