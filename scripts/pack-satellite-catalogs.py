"""Build credited weather and amateur snapshots from public SatNOGS JSON files."""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.orbit.providers import SATNOGS, SATNOGS_SOURCE, satnogs_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("tles", type=Path)
parser.add_argument("transmitters", type=Path)
parser.add_argument("--out", type=Path, default=ROOT / "backend/app/data/orbit_seed")
args = parser.parse_args()
tles = json.loads(args.tles.read_text(encoding="utf8"))
transmitters = json.loads(args.transmitters.read_text(encoding="utf8"))
fetched_at = min(args.tles.stat().st_mtime, args.transmitters.stat().st_mtime)
gathered = datetime.fromtimestamp(fetched_at, tz=timezone.utc)
for group, label in (("weather", "气象卫星"), ("amateur", "业余无线电卫星")):
    entries = satnogs_group(tles, transmitters, group, at=gathered)
    if not entries:
        raise SystemExit(f"No valid {group} elements")
    payload = {
        "group": group, "label": label, "fetched_at": fetched_at, "source": SATNOGS_SOURCE,
        "source_urls": [f"{SATNOGS}/tle/", f"{SATNOGS}/transmitters/"],
        "data_license": "CC-BY-SA-4.0", "records": [entry.omm for entry in entries],
    }
    path = args.out / f"{group}.json"
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf8")
    temp.replace(path)
    print(f"{group}: {len(entries)} members, fetched {gathered.isoformat()}")
