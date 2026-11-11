#!/bin/bash
# Download fresh timetables (and, on the 1st of the month or with --osm, the street
# map), import them into a new data folder and switch the server over to it.
# The old data stays in use if a download or the import fails.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

fetch() { # url file min_bytes
  curl -fsSL --retry 3 -o "$2.new" "$1"
  [ "$(stat -c %s "$2.new")" -ge "$3" ] || { echo "$2: download too small" >&2; rm -f "$2.new"; return 1; }
}

fetch https://www.zet.hr/gtfs-scheduled/latest zet.zip 1000000
fetch https://www.hzpp.hr/GTFS_files.zip hzpp.zip 500000
python3 -c 'import sys, zipfile; [zipfile.ZipFile(f).testzip() for f in sys.argv[1:]]' zet.zip.new hzpp.zip.new
if [ "${1:-}" = --osm ] || [ "$(date +%d)" = 01 ] || [ ! -f croatia.osm.pbf ]; then
  fetch https://download.geofabrik.de/europe/croatia-latest.osm.pbf croatia.osm.pbf 100000000
fi
for f in zet.zip hzpp.zip croatia.osm.pbf; do
  [ -f "$f.new" ] && mv "$f.new" "$f"
done

rm -rf data.new
./motis import -c config.yml -d data.new > import.log 2>&1 || { echo "import failed, see import.log" >&2; exit 1; }

rm -rf data.old
[ -d data ] && mv data data.old
mv data.new data
sudo systemctl restart motis
sleep 15
if curl -fsS -o /dev/null 'http://127.0.0.1:8080/api/v1/geocode?text=Jarun'; then
  rm -rf data.old
else
  echo "server did not come up on the new data, going back to the old" >&2
  rm -rf data.bad && mv data data.bad
  [ -d data.old ] && mv data.old data
  sudo systemctl restart motis
  exit 1
fi
