"""Build the claude.ai artifact version of the map: one self-contained page plus map-tile packs.

Usage:  python3 tools/build_artifact.py            (writes into ./build/artifact)

An artifact page may load nothing from other servers, so everything ships with it: the libraries
(the exact files index.html pins, checked against its integrity hashes), style.css, app.js,
route.js, the station data, and OpenFreeMap's map styles, fonts, icons and vector tiles for the
ZET service area. Downloads are cached in ./build/cache; delete it to fetch fresh map data.

Publish build/artifact/index.html as the page and every build/artifact/tiles/*.txt beside it
at the same path (tiles/<name>.txt).
"""

import base64
import gzip
import hashlib
import json
import math
import re
import struct
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "build" / "cache"
OUT = ROOT / "build" / "artifact"
GLUE = Path(__file__).resolve().parent / "artifact"

OFM = "https://tiles.openfreemap.org"
STYLES = ["liberty", "positron", "dark"]  # Clean, Light and dark mode in app.js
FONTS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"]
GLYPH_RANGES = ["0-255", "256-511", "8192-8447"]  # Latin, Croatian letters, punctuation
SPRITES = ["ofm.json", "ofm.png", "ofm@2x.json", "ofm@2x.png"]

MIN_ZOOM = 9  # lower zooms show half of Europe and would add megabytes for nothing
MAX_ZOOM = 14  # OpenFreeMap's most detailed tiles; MapLibre enlarges them beyond
PACK_ZOOM = 11  # tiles from this zoom up are packed by their ancestor at this zoom
MARGIN = (0.02, 0.03)  # degrees of lat/lon added around the outermost stations


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "zagreb-bajs-map/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
        return gzip.decompress(data) if resp.headers.get("Content-Encoding") == "gzip" else data


def cached(name, url):
    """Bytes of url, downloaded once into the cache under name."""
    path = CACHE / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(fetch(url))
    return path.read_bytes()


def pinned_files():
    """{url: integrity} for the unpkg scripts and stylesheets index.html loads."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return dict(re.findall(r'(?:src|href)="(https://unpkg\.com/[^"]+)"\s+integrity="([^"]+)"', html))


def library(url, integrity):
    data = cached("lib/" + url.removeprefix("https://unpkg.com/"), url)
    algorithm, expected = integrity.split("-", 1)
    actual = base64.b64encode(hashlib.new(algorithm, data).digest()).decode()
    if actual != expected:
        sys.exit(f"{url} does not match its integrity hash in index.html")
    return data.decode("utf-8")


# Map tiles ---------------------------------------------------------------------


def tile_xy(lat, lon, z):
    n = 2**z
    lat_rad = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(lat_rad)) / math.pi) / 2 * n)


def tile_lon(x, z):
    return x / 2**z * 360 - 180


def tile_lat(y, z):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2**z))))


def service_area():
    """(min_lat, min_lon, max_lat, max_lon) around every stop and Bajs station."""
    places = [p for name in ("stops.json", "bajs.json") for p in json.loads((ROOT / "data" / name).read_text("utf-8"))["items"]]
    lats = [p["lat"] for p in places]
    lons = [p["lon"] for p in places]
    return min(lats) - MARGIN[0], min(lons) - MARGIN[1], max(lats) + MARGIN[0], max(lons) + MARGIN[1]


def tiles_in(area):
    min_lat, min_lon, max_lat, max_lon = area
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        x0, y0 = tile_xy(max_lat, min_lon, z)
        x1, y1 = tile_xy(min_lat, max_lon, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield z, x, y


def download_tiles(tiles):
    """{(z, x, y): bytes} of OpenFreeMap's current planet tiles."""
    template = json.loads(fetch(f"{OFM}/planet"))["tiles"][0]  # names the tileset's date
    version = template.split("/")[-4]

    def one(tile):
        z, x, y = tile
        url = template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
        return tile, cached(f"tiles/{version}/{z}/{x}/{y}.pbf", url)

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(one, tiles))


def write_pack(name, entries):
    """Artifacts serve no generic binary type, so a pack is base64 text of
    gzip(u32 header length, JSON {key: [offset, length]}, the entries' bytes)."""
    index, blobs, offset = {}, [], 0
    for key, data in sorted(entries.items()):
        index[key] = [offset, len(data)]
        blobs.append(data)
        offset += len(data)
    header = json.dumps(index, separators=(",", ":")).encode()
    raw = struct.pack("<I", len(header)) + header + b"".join(blobs)
    (OUT / "tiles" / f"{name}.txt").write_bytes(base64.b64encode(gzip.compress(raw, 9)))


def build_packs(tiles):
    packs = {"lo": {}}
    for (z, x, y), data in tiles.items():
        name = "lo" if z < PACK_ZOOM else f"c{x >> (z - PACK_ZOOM)}_{y >> (z - PACK_ZOOM)}"
        packs.setdefault(name, {})[f"t/{z}/{x}/{y}"] = data
    for font in FONTS:
        for glyphs in GLYPH_RANGES:
            packs["lo"][f"g/{font}/{glyphs}"] = cached(f"fonts/{font}/{glyphs}.pbf", f"{OFM}/fonts/{quote(font)}/{glyphs}.pbf")
    for name in SPRITES:
        packs["lo"][f"s/{name}"] = cached(f"sprites/{name}", f"{OFM}/sprites/ofm_f384/{name}")

    (OUT / "tiles").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "tiles").glob("*.txt"):
        old.unlink()
    for name, entries in packs.items():
        write_pack(name, entries)
    return sorted(packs)


def local_style(name, tiles):
    """OpenFreeMap's style, reading the bundled tiles, fonts and icons instead."""
    style = json.loads(cached(f"styles/{name}.json", f"{OFM}/styles/{name}"))
    xs = [x for z, x, y in tiles if z == MAX_ZOOM]
    ys = [y for z, x, y in tiles if z == MAX_ZOOM]
    bounds = [tile_lon(min(xs), MAX_ZOOM), tile_lat(max(ys) + 1, MAX_ZOOM), tile_lon(max(xs) + 1, MAX_ZOOM), tile_lat(min(ys), MAX_ZOOM)]
    style["sources"] = {
        "openmaptiles": {
            "type": "vector",
            "tiles": ["zgt://t/{z}/{x}/{y}"],
            "minzoom": MIN_ZOOM,
            "maxzoom": MAX_ZOOM,
            "bounds": [round(v, 5) for v in bounds],  # MapLibre asks for nothing outside
        },
    }
    # The shaded-relief raster only shows below MIN_ZOOM.
    style["layers"] = [layer for layer in style["layers"] if layer.get("source") in (None, "openmaptiles")]
    style["glyphs"] = "zgt://g/{fontstack}/{range}"
    style["sprite"] = "zgt://s/ofm"
    return json.dumps(style, separators=(",", ":"))


# Page ----------------------------------------------------------------------------


def json_block(element_id, text):
    escaped = text.replace("</", "<\\/")  # "</script>" inside would end the block
    return f'<script type="application/json" id="{element_id}">{escaped}</script>'


def script(text):
    assert "</script" not in text.lower()
    return f"<script>\n{text}\n</script>"


def style_block(text):
    assert "</style" not in text.lower()
    return f"<style>\n{text}\n</style>"


def main():
    print("Downloading (cached in build/cache)…")
    libraries = {url: library(url, integrity) for url, integrity in pinned_files().items()}
    css = [text for url, text in libraries.items() if url.endswith(".css")]
    js = [text for url, text in libraries.items() if url.endswith(".js")]  # in index.html's order
    tiles = download_tiles(list(tiles_in(service_area())))

    print(f"Packing {len(tiles)} map tiles…")
    pack_names = build_packs(tiles)
    read = lambda path: path.read_text(encoding="utf-8")
    page = "\n".join([
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>bajsikl</title>",
        *map(style_block, css),
        style_block(read(ROOT / "style.css")),
        style_block(read(GLUE / "artifact.css")),
        "</head>",
        "<body>",
        '<div id="map"></div>',
        '<div id="sheet" hidden></div>',
        '<div id="notice" role="status" hidden></div>',
        json_block("data-stops", read(ROOT / "data" / "stops.json")),
        json_block("data-bajs", read(ROOT / "data" / "bajs.json")),
        *(json_block(f"style-{name}", local_style(name, tiles)) for name in STYLES),
        json_block("tile-packs", json.dumps({"packs": pack_names, "packZoom": PACK_ZOOM})),
        *map(script, js),
        script(read(GLUE / "glue.js")),
        script(read(ROOT / "app.js")),
        script(read(ROOT / "route.js")),
        "</body>",
        "</html>",
        "",
    ])
    (OUT / "index.html").write_text(page, encoding="utf-8")

    sizes = [p.stat().st_size for p in (OUT / "tiles").glob("*.txt")]
    print(f"  wrote {OUT / 'index.html'} ({len(page.encode()) / 1e6:.1f} MB)")
    print(f"  wrote {len(sizes)} tile packs to {OUT / 'tiles'} ({sum(sizes) / 1e6:.1f} MB, largest {max(sizes) / 1e6:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
