#!/bin/bash
# Download BRouter's current map data for Zagreb and rebuild the table of rides between
# Bajs stations. The old table stays in place if the download or the build fails.
set -euo pipefail
cd ~/brouter/segments4

curl -fsSL --retry 3 -o E15_N45.rd5.new https://brouter.de/brouter/segments4/E15_N45.rd5
[ "$(stat -c %s E15_N45.rd5.new)" -ge 50000000 ] || { echo "segment download too small" >&2; rm -f E15_N45.rd5.new; exit 1; }
mv E15_N45.rd5.new E15_N45.rd5

"$(dirname "$(readlink -f "$0")")/build_rides.py" /var/www/bajsikl/rides
