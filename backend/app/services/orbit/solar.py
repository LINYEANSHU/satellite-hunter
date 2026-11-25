"""Educational heliocentric ephemerides in the mean J2000 ecliptic."""
from __future__ import annotations

import gzip
import json
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import httpx

from app.core.config import settings
from app.core.errors import AppError

J2000 = 2451545.0
GAUSSIAN_K = 0.01720209895  # rad/day for an orbit of semimajor axis 1 au
PLANET_SOURCE = "https://ssd.jpl.nasa.gov/planets/approx_pos.html"
SMALL_BODY_SOURCE = "https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html"
SEED = Path(__file__).resolve().parents[2] / "data" / "solar_catalog.json.gz"
SMALL_FIELDS = ("spkid", "pdes", "full_name", "kind", "epoch", "q", "e", "i", "om", "w", "tp")

# JPL table 1. Each row is a, e, i, L, longitude of perihelion, longitude
# of ascending node, followed by their Julian-century rates.
PLANETS = {
    "mercury": ("Mercury", "水星", (0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593),
                (0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081)),
    "venus": ("Venus", "金星", (0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255),
              (0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418)),
    "earth": ("Earth–Moon barycenter", "地月质心", (1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0),
              (0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0)),
    "mars": ("Mars", "火星", (1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891),
             (0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343)),
    "jupiter": ("Jupiter", "木星", (5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909),
                (-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106)),
    "saturn": ("Saturn", "土星", (9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448),
               (-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794)),
    "uranus": ("Uranus", "天王星", (19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503),
               (-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589)),
    "neptune": ("Neptune", "海王星", (30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574),
                (0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664)),
}


def julian_day(moment: datetime) -> float:
    return moment.replace(tzinfo=timezone.utc).timestamp() / 86400 + 2440587.5


START = julian_day(datetime(1800, 1, 1))
END = julian_day(datetime(2051, 1, 1))


def _plane_to_ecliptic(x: float, y: float, inc: float, node: float, arg: float) -> tuple[float, float, float]:
    inc, node, arg = map(math.radians, (inc, node, arg))
    u = math.cos(arg) * x - math.sin(arg) * y
    v = math.sin(arg) * x + math.cos(arg) * y
    return (math.cos(node) * u - math.sin(node) * math.cos(inc) * v,
            math.sin(node) * u + math.cos(node) * math.cos(inc) * v,
            math.sin(inc) * v)


def _eccentric_anomaly(mean: float, eccentricity: float) -> float:
    mean = math.remainder(mean, math.tau)
    lo, hi = -math.pi, math.pi
    for _ in range(46):
        middle = (lo + hi) / 2
        if middle - eccentricity * math.sin(middle) < mean:
            lo = middle
        else:
            hi = middle
    return (lo + hi) / 2


def planet_position(body: str, jd: float) -> tuple[float, float, float]:
    _, _, elements, rates = PLANETS[body]
    centuries = (jd - J2000) / 36525
    a, e, inc, longitude, peri, node = [value + centuries * rate for value, rate in zip(elements, rates)]
    anomaly = _eccentric_anomaly(math.radians(longitude - peri), e)
    x = a * (math.cos(anomaly) - e)
    y = a * math.sqrt(1 - e * e) * math.sin(anomaly)
    return _plane_to_ecliptic(x, y, inc, node, peri - node)


@dataclass(frozen=True)
class SmallBody:
    id: str
    designation: str
    name: str
    kind: str
    epoch: float
    q: float
    e: float
    inc: float
    node: float
    arg: float
    perihelion: float

    def summary(self) -> dict:
        return {"id": self.id, "name": self.name, "kind": self.kind, "designation": self.designation,
                "epoch_jd_tdb": self.epoch, "perihelion_au": self.q, "eccentricity": self.e}

    def period(self) -> float | None:
        if self.e >= 1:
            return None
        return math.tau * (self.q / (1 - self.e)) ** 1.5 / GAUSSIAN_K

    def position(self, jd: float) -> tuple[float, float, float]:
        elapsed = jd - self.perihelion
        if self.e < 1:
            a = self.q / (1 - self.e)
            anomaly = _eccentric_anomaly(GAUSSIAN_K * elapsed / a ** 1.5, self.e)
            x = a * (math.cos(anomaly) - self.e)
            y = a * math.sqrt(1 - self.e * self.e) * math.sin(anomaly)
        elif self.e > 1:
            a = self.q / (self.e - 1)
            mean = GAUSSIAN_K * elapsed / a ** 1.5
            lo, hi = 0.0, math.asinh(abs(mean) / self.e) + 2.0
            while self.e * math.sinh(hi) - hi < abs(mean):
                hi += 2.0
            for _ in range(55):
                middle = (lo + hi) / 2
                if self.e * math.sinh(middle) - middle < abs(mean):
                    lo = middle
                else:
                    hi = middle
            anomaly = math.copysign((lo + hi) / 2, mean)
            x = a * (self.e - math.cosh(anomaly))
            y = a * math.sqrt(self.e * self.e - 1) * math.sinh(anomaly)
        else:
            barker = GAUSSIAN_K * elapsed / math.sqrt(2 * self.q ** 3)
            term = 2 * math.sinh(math.asinh(1.5 * barker) / 3)
            x, y = self.q * (1 - term * term), 2 * self.q * term
        return _plane_to_ecliptic(x, y, self.inc, self.node, self.arg)


def read_body(row: list) -> SmallBody:
    ident, designation, name, group, *raw = row
    numbers = [float(value) for value in raw]
    epoch, q, eccentricity, inc, node, arg, perihelion = numbers
    if not (str(ident).isdigit() and designation and str(group).startswith(("a", "c")) and all(map(math.isfinite, numbers))
            and 1e-6 <= q <= 1e7 and 0 <= eccentricity <= 100 and 0 <= inc <= 180):
        raise ValueError("invalid JPL element record")
    return SmallBody("sb-" + str(ident), str(designation), str(name or designation).strip(),
                     "comet" if group.startswith("c") else "asteroid", epoch, q, eccentricity, inc, node, arg, perihelion)


@lru_cache(maxsize=1)
def bundled() -> tuple[dict[str, SmallBody], dict]:
    with gzip.open(SEED, "rt", encoding="utf8") as handle:
        data = json.load(handle)
    if tuple(data["fields"]) != SMALL_FIELDS:
        raise ValueError("unexpected orbital dataset columns")
    rows = {}
    for record in data["data"]:
        try:
            body = read_body(record)
        except (ValueError, TypeError):
            continue
        rows[body.id] = body
    info = {"retrieved_at": data["retrieved_at"], "query_counts": data["query_counts"]}
    return rows, info


_lookup_lock = threading.Lock()
_last_lookup = 0.0


def _imports_path() -> Path:
    return settings.data_dir / "solar_imports.json"


@lru_cache(maxsize=4)
def _imported(path: Path, mtime: int) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _load_imports() -> dict:
    path = _imports_path()
    try:
        return _imported(path, path.stat().st_mtime_ns)
    except OSError:
        return {}


def _all_bodies() -> dict[str, SmallBody]:
    seeds, _ = bundled()
    result = dict(seeds)
    for record in _load_imports().values():
        try:
            body = read_body(record)
        except (ValueError, TypeError):
            continue
        result[body.id] = body
    return result


def list_bodies(kind: str, search: str, offset: int, limit: int) -> dict:
    planets = [{"id": "planet-" + key, "name": value[0], "name_zh": value[1], "kind": "planet",
                "designation": key, "epoch_jd_tdb": J2000}
               for key, value in PLANETS.items()]
    bodies = _all_bodies()
    _, source = bundled()
    counts = {"planet": len(planets), "asteroid": sum(body.kind == "asteroid" for body in bodies.values()),
              "comet": sum(body.kind == "comet" for body in bodies.values())}
    needle = search.strip().casefold()
    selected = [planet for planet in planets if (not kind or kind == "planet")
                and needle in (planet["name"] + " " + planet["name_zh"]).casefold()]
    matches = [body for body in bodies.values() if (not kind or kind == body.kind)
               and (needle in body.name.casefold() or needle in body.designation.casefold())]
    total = len(selected) + len(matches)
    remaining = max(0, limit - max(0, len(selected) - offset))
    start = max(0, offset - len(selected))
    items = selected[offset:offset + limit] + [body.summary() for body in matches[start:start + remaining]]
    return {"items": items, "total": total, "counts": counts, **source}


def trajectory(body_id: str, at: datetime, days: float | None, points: int) -> dict:
    jd = julian_day(at)
    if not START <= jd < END:
        raise AppError(422, "SOLAR_RANGE", "太阳系图支持 1800–2050 年。")
    key = body_id.removeprefix("planet-")
    if body_id.startswith("planet-") and key in PLANETS:
        name, name_zh, elements, _ = PLANETS[key]
        def position(value):
            return planet_position(key, value)
        period = math.tau * elements[0] ** 1.5 / GAUSSIAN_K
        source, method, epoch = PLANET_SOURCE, "planetary-fit", J2000
        summary = {"id": body_id, "name": name, "name_zh": name_zh, "kind": "planet"}
    else:
        records, _ = bundled()
        raw = _load_imports().get(body_id)
        try:
            body = read_body(raw) if raw else records.get(body_id)
        except (TypeError, ValueError):
            body = records.get(body_id)
        if body is None:
            raise AppError(404, "SOLAR_NOT_FOUND", "离线目录没有该天体。")
        position = body.position
        period = body.period()
        summary = body.summary()
        source, method, epoch = SMALL_BODY_SOURCE, "osculating-two-body", body.epoch
    span = days if days is not None else min(period or 240.0, 36525.0)
    low, high = max(START, jd - span / 2), min(END - 1e-8, jd + span / 2)
    path = [position(low + (high - low) * index / (points - 1)) for index in range(points)]
    xyz = position(jd)
    return {"object": summary, "at": at.isoformat() + "Z", "frame": "J2000 mean ecliptic", "center": "Sun",
            "position_au": xyz, "distance_au": math.hypot(*xyz), "path_au": path, "epoch_jd_tdb": epoch,
            "method": method, "source_url": source, "period_days": period, "span_days": high - low}


def import_body(designation: str) -> dict:
    """Look up a user-selected designation once, then persist its elements locally."""
    global _last_lookup
    name = designation.strip()
    if not name or len(name) > 80 or "*" in name:
        raise AppError(400, "BAD_SOLAR_NAME", "请输入长度合适的天体名称或编号。")
    with _lookup_lock:
        records = _load_imports()
        for row in records.values():
            try:
                body = read_body(row)
            except (TypeError, ValueError):
                continue
            if name.casefold() in (body.designation.casefold(), body.name.casefold()):
                return body.summary()
        now = time.monotonic()
        if now - _last_lookup < 3:
            raise AppError(429, "SOLAR_RATE", "请稍后再查询另一个天体。")
        _last_lookup = now
        try:
            response = httpx.get("https://ssd-api.jpl.nasa.gov/sbdb.api", params={"sstr": name, "full-prec": "true"},
                                 headers={"User-Agent": "SatelliteHunter/0.1 (educational game)"}, timeout=12)
            if response.status_code in (300, 404):
                raise AppError(404, "SOLAR_NOT_FOUND", "JPL 未找到唯一匹配，请输入精确编号。")
            response.raise_for_status()
            data = response.json()
            obj, orbit = data["object"], data["orbit"]
            elements = {entry["name"]: entry["value"] for entry in orbit["elements"]}
            row = [obj["spkid"], obj["des"], obj["fullname"], obj["kind"], orbit["epoch"],
                   *(elements[field] for field in SMALL_FIELDS[5:])]
            body = read_body(row)
        except (httpx.HTTPError, TypeError, ValueError, KeyError) as error:
            raise AppError(503, "SOLAR_LOOKUP_FAILED", "JPL 暂时无法返回这个天体的完整轨道要素。") from error
        records = {**records, body.id: row}
        path = _imports_path()
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(records, ensure_ascii=False), encoding="utf8")
        tmp.replace(path)
        return body.summary()
