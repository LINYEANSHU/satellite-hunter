"""Public TLE feeds used by the weather and amateur orbit catalogs."""
from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from sgp4.api import jday

from app.services.orbit.omm import SatEntry, parse_tle_text, satrec_from_omm

SATNOGS = "https://db.satnogs.org/api"
EUMETSAT = "https://service.eumetsat.int/tle/javascript"
SATNOGS_SOURCE = "SatNOGS DB (TLE)"
EUMETSAT_SOURCE = "EUMETSAT (operator TLE)"
HEADERS = {"User-Agent": "SatelliteHunter/0.1 (educational game)"}
TIMEOUT = httpx.Timeout(9.0, connect=4.0)
WEATHER_NAMES = re.compile(
    r"^(?:NOAA[- ](?:1[5-9]|2[01])\b|METOP[- ]|NPP$|SUOMI[- ]NPP\b|"
    r"GOES[- ]\d+\b|FENGYUN[- ]\d|METEOR[- ]M\b|METEOR[- ]M2|METEOSAT[- ]\d)", re.I
)
EUMETSAT_UNITS = (
    ("n20", "NOAA 20"), ("n21", "NOAA 21"), ("npp", "SUOMI NPP"),
    ("m01", "METOP-B"), ("m03", "METOP-C"), ("sga1", "METOP-SG A1"),
)
# AMSAT aliases also cover active amateur satellites whose transmitter service is unclassified.
AMATEUR_ALIASES = {"7530": "AO-7", "24278": "FO-29", "27607": "SO-50", "44909": "RS-44"}
_EUMETSAT_LINE = re.compile(r'=\s*"([12] [^"\r\n]+)"')


def _line_ok(line: str, number: str) -> bool:
    if len(line) != 69 or not line.startswith(number + " ") or line[68] not in "0123456789":
        return False
    checksum = sum(int(char) if char in "0123456789" else int(char == "-") for char in line[:68])
    return checksum % 10 == int(line[68])


def _parse_pair(name: str, line1: str, line2: str, group: str, origin: str, upstream: str) -> SatEntry | None:
    if not (_line_ok(line1, "1") and _line_ok(line2, "2") and line1[2:7] == line2[2:7]):
        return None
    records = parse_tle_text("\n".join((name, line1, line2)), group=group)
    if not records:
        return None
    entry = records[0]
    entry.origin = origin
    entry.omm.update(_SH_ORIGIN=origin, _SH_UPSTREAM=upstream)
    return entry


def satnogs_group(tles: list[dict], transmitters: list[dict], group: str, at: datetime | None = None) -> list[SatEntry]:
    service = {"weather": "meteorological", "amateur": "amateur"}[group]
    identities = {
        str(row.get("norad_cat_id"))
        for row in transmitters
        if isinstance(row, dict) and str(row.get("service", "")).casefold() == service and row.get("alive") is True
    }
    sample_time = at or datetime.now(timezone.utc)
    jd, fr = jday(sample_time.year, sample_time.month, sample_time.day, sample_time.hour,
                  sample_time.minute, sample_time.second + sample_time.microsecond / 1e6)
    result: dict[int, SatEntry] = {}
    for row in tles:
        if not isinstance(row, dict):
            continue
        norad = str(row.get("norad_cat_id"))
        name = str(row.get("tle0") or "").removeprefix("0 ").strip()
        alias = AMATEUR_ALIASES.get(norad) if group == "amateur" else None
        if norad not in identities and not alias and not (group == "weather" and WEATHER_NAMES.match(name)):
            continue
        if alias and alias not in name:
            name = f"{alias} ({name})" if name else alias
        if not (isinstance(row.get("tle1"), str) and isinstance(row.get("tle2"), str)):
            continue
        entry = _parse_pair(name, row["tle1"].rstrip(), row["tle2"].rstrip(), group,
                            "satnogs_tle", str(row.get("tle_source") or SATNOGS_SOURCE))
        if entry is None or str(entry.norad_id) != norad:
            continue
        if satrec_from_omm(entry.omm).sgp4(jd, fr)[0]:
            continue
        previous = result.get(entry.norad_id)
        if previous is None or entry.epoch > previous.epoch:
            result[entry.norad_id] = entry
    return sorted(result.values(), key=lambda entry: entry.norad_id)


def eumetsat_entries(text: str, name: str) -> list[SatEntry]:
    lines = _EUMETSAT_LINE.findall(text)
    out = []
    for line1, line2 in zip(lines[::2], lines[1::2]):
        entry = _parse_pair(name, line1, line2, "weather", "eumetsat_tle", "EUMETSAT")
        if entry:
            out.append(entry)
    return out


class _SatnogsFeeds:
    def __init__(self):
        self._lock = threading.Lock()
        self._data: dict[str, tuple[float, list[dict]]] = {}
        self._retry_after: dict[str, float] = {}

    def get(self, kind: str, lifetime: float) -> list[dict]:
        with self._lock:
            now = time.monotonic()
            cached = self._data.get(kind)
            if cached and now - cached[0] <= lifetime:
                return cached[1]
            if now < self._retry_after.get(kind, 0.0):
                raise RuntimeError(f"SatNOGS {kind} request temporarily deferred")
            try:
                response = httpx.get(f"{SATNOGS}/{kind}/", params={"format": "json"},
                                     headers=HEADERS, timeout=TIMEOUT)
                response.raise_for_status()
                data: Any = response.json()
                if not isinstance(data, list) or not data:
                    raise ValueError(f"SatNOGS {kind} response contains no records")
            except (httpx.HTTPError, ValueError):
                self._retry_after[kind] = time.monotonic() + 900
                raise
            self._data[kind] = (time.monotonic(), data)
            return data


_satnogs = _SatnogsFeeds()


def _fetch_eumetsat() -> list[SatEntry]:
    result = []
    for code, name in EUMETSAT_UNITS:
        try:
            response = httpx.get(f"{EUMETSAT}/data_content_{code}.js", headers=HEADERS, timeout=TIMEOUT)
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            if error.response.status_code in (403, 429) or error.response.status_code >= 500:
                break
            continue
        except httpx.RequestError:
            break
        candidates = eumetsat_entries(response.text, name)
        # These operator feeds include repeats and historical element sets.
        if candidates:
            result.append(max(candidates, key=lambda entry: entry.epoch or datetime.min))
    return result


def fetch_public_elements(group: str) -> tuple[list[SatEntry], str]:
    if group not in ("weather", "amateur"):
        raise ValueError(f"No alternate public provider for {group}")
    try:
        entries = satnogs_group(_satnogs.get("tle", 3600), _satnogs.get("transmitters", 86400), group)
        if entries:
            return entries, SATNOGS_SOURCE
    except (httpx.HTTPError, ValueError, RuntimeError) as error:
        if group == "amateur":
            raise RuntimeError(f"SatNOGS unavailable: {error}") from error
    if group == "weather":
        entries = _fetch_eumetsat()
        if entries:
            return entries, EUMETSAT_SOURCE
    raise ValueError(f"No usable alternate elements for {group}")
