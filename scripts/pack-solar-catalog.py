"""Pack verified JPL SBDB Query responses into the portable catalog."""
import argparse
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ["spkid", "pdes", "full_name", "kind", "epoch", "q", "e", "i", "om", "w", "tp"]

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("asteroids", type=Path)
parser.add_argument("comets", type=Path)
parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "backend/app/data/solar_catalog.json.gz")
parser.add_argument("--retrieved-at", default=datetime.now(timezone.utc).date().isoformat())
args = parser.parse_args()
rows = []
counts = {}
for kind, path in (("asteroid", args.asteroids), ("comet", args.comets)):
    data = json.loads(path.read_text(encoding="utf8"))
    if data.get("fields") != FIELDS or not isinstance(data.get("data"), list):
        raise ValueError(f"Unrecognized SBDB Query response: {path}")
    counts[kind] = int(data["count"])
    rows.extend(data["data"])

catalog = {"fields": FIELDS, "data": rows, "query_counts": counts, "retrieved_at": args.retrieved_at}
out = json.dumps(catalog, separators=(",", ":"), ensure_ascii=False).encode("utf8")
args.out.write_bytes(gzip.compress(out, mtime=0))
print(f"Packed {len(rows)} source rows ({args.out.stat().st_size} bytes)")
