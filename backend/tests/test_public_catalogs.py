from __future__ import annotations

from datetime import datetime
import csv
import io
import math
import time

import httpx
import pytest

from app.core.config import settings
from app.core.errors import AppError
from app.services.orbit import catalog, solar


def test_provider_csv_and_recent_cache_prevent_duplicate_downloads(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    fields = catalog._bundled_group("stations").entries[0].omm
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(fields))
    writer.writeheader()
    writer.writerow(fields)
    calls = []

    def fetch(url, **args):
        calls.append(args["params"])
        return httpx.Response(200, text=out.getvalue(), request=httpx.Request("GET", url))

    monkeypatch.setattr(catalog.httpx, "get", fetch)
    live = catalog.CatalogService().get_group("stations")
    disk = catalog.CatalogService().get_group("stations", force=True)
    assert live.entries[0].norad_id == disk.entries[0].norad_id
    assert live.source.endswith("(OMM CSV)") and not disk.stale
    assert calls == [{"GROUP": "STATIONS", "FORMAT": "CSV"}]


def test_unavailable_provider_uses_bundled_cache_and_backs_off_across_restart(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    calls = []

    def fetch(url, **kwargs):
        calls.append(url)
        return httpx.Response(503, headers={"Retry-After": "3600"}, request=httpx.Request("GET", url))

    monkeypatch.setattr(catalog.httpx, "get", fetch)
    local = catalog.CatalogService().get_group("stations")
    assert local.bundled and local.stale and len(local.entries) == 20
    service = catalog.CatalogService()
    assert service.get_group("stations", force=True).bundled
    assert service.find(25544) is not None
    with pytest.raises(AppError, match="没有本地快照"):
        service.get_group("science", force=True)
    assert len(calls) == 1
    assert not (settings.orbit_cache_dir / "stations.json").exists()
    assert service._provider_pause() - time.time() >= 3500


def test_offline_mode_never_requests_an_upstream_catalog(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "orbit_offline", True)
    monkeypatch.setattr(catalog.httpx, "get", lambda *args, **kwargs: pytest.fail("unexpected online attempt"))
    assert catalog.CatalogService().get_group("stations", force=True).bundled


def test_id_only_source_data_never_replaces_the_offline_seed(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    (settings.orbit_cache_dir / "stations.json").write_text('{"records":[],"fetched_at":9999999999}')
    monkeypatch.setattr(catalog.httpx, "get", lambda url, **kwargs:
                        httpx.Response(200, text="NORAD_CAT_ID\n25544\n", request=httpx.Request("GET", url)))
    actual = catalog.CatalogService().get_group("stations")
    assert actual.bundled and actual.stale and len(actual.entries) == 20


def test_catalog_status_and_ungrouped_lookup_use_actual_data_age(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    service = catalog.CatalogService()
    orbital = dict(catalog._bundled_group("stations").index()[25544].omm)
    orbital["EPOCH"] = "2026-11-25T12:00:00.000000"
    user = catalog.parse_celestrak_json([orbital], group="user_imported")[0]
    service._groups["stations"] = catalog._bundled_group("stations")
    service.add_user_entries([user])
    service._groups["active"] = catalog.GroupData("active", [user], time.time() - 10000, False)
    assert next(group for group in service.status() if group["group"] == "active")["stale"]
    assert service.find(25544).epoch == user.epoch


def test_public_solar_catalog_and_orbit_api(client):
    catalog_result = client.get("/api/solar/catalog")
    assert catalog_result.status_code == 200
    assert catalog_result.json()["counts"] == {"planet": 8, "asteroid": 16000, "comet": 3918}
    distant = client.get("/api/solar/catalog", params={"kind": "asteroid", "offset": 15990}).json()
    assert len(distant["items"]) == 10 and distant["total"] == 16000
    ceres = client.get("/api/solar/catalog", params={"q": "Ceres", "kind": "asteroid"}).json()["items"][0]
    path = client.get(f"/api/solar/trajectory/{ceres['id']}", params={"at": "2026-11-25T00:00:00Z", "points": 120}).json()
    assert 2.5 < path["distance_au"] < 3.0
    assert len(path["path_au"]) == 120
    assert path["method"] == "osculating-two-body"
    earth = client.get("/api/solar/trajectory/planet-earth", params={"at": "2000-01-01T12:00:00Z"}).json()
    assert earth["distance_au"] == pytest.approx(0.9833, abs=0.0005)
    assert earth["object"]["name"].startswith("Earth–Moon")
    assert client.get("/api/solar/trajectory/planet-earth", params={"at": "2100-01-01"}).status_code == 422


@pytest.mark.parametrize("eccentricity", [0.4, 0.999999, 1, 1.000001, 2.4])
def test_all_conics_pass_perihelion_and_are_finite(eccentricity):
    body = solar.SmallBody("test", "x", "x", "comet", solar.J2000, 0.8, eccentricity, 18, 67, 40, solar.J2000)
    assert math.hypot(*body.position(solar.J2000)) == pytest.approx(0.8, rel=1e-8)
    future = body.position(solar.julian_day(datetime(2030, 1, 1)))
    assert all(map(math.isfinite, future))


def test_a_jpl_lookup_can_be_reopened_without_the_network(client, monkeypatch):
    monkeypatch.setattr(solar, "_last_lookup", 0)
    calls = []

    def fetch(url, **args):
        calls.append(args["params"]["sstr"])
        raw = {"object": {"spkid": "30000000", "des": "2026 TEST", "fullname": "Sample designation", "kind": "au"},
               "orbit": {"epoch": "2461100", "elements": [
                   {"name": field, "value": val}
                   for field, val in zip(solar.SMALL_FIELDS[5:], ["1.5", "0.25", "0", "0", "0", "2461100"])
               ]}}
        return httpx.Response(200, json=raw, request=httpx.Request("GET", url))

    monkeypatch.setattr(solar.httpx, "get", fetch)
    reply = client.post("/api/solar/lookup", json={"designation": "2026 TEST"})
    assert reply.status_code == 200
    assert reply.json()["id"] == "sb-30000000"
    assert client.post("/api/solar/lookup", json={"designation": "2026 TEST"}).json() == reply.json()
    assert client.get("/api/solar/catalog", params={"q": "2026 TEST"}).json()["total"] == 1
    assert client.get("/api/solar/trajectory/sb-30000000").status_code == 200
    assert calls == ["2026 TEST"]
