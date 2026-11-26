from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
import threading
import time

import httpx
import pytest

from app.core.config import settings
from app.services.orbit import catalog, providers
from app.services.orbit.omm import satrec_from_omm, satrec_from_tle


@pytest.mark.parametrize("group,norad_id", [("weather", 43013), ("amateur", 27607)])
def test_bundled_sources_compute_positions_and_passes_with_no_network(group, norad_id, client, monkeypatch):
    monkeypatch.setattr(settings, "orbit_offline", True)
    monkeypatch.setattr(catalog, "catalog_service", catalog.CatalogService())
    from app.api.routes import satellites
    monkeypatch.setattr(satellites, "catalog_service", catalog.catalog_service)

    def forbidden(*args, **kwargs):
        pytest.fail("offline orbit computation requested an upstream connection")

    monkeypatch.setattr(catalog, "fetch_public_elements", forbidden)
    monkeypatch.setattr(catalog.httpx, "get", forbidden)
    data = client.get("/api/satellites", params={"group": group}).json()
    assert data["total"] > 0 and data["bundled"] and data["stale"] and data["source"]
    assert data["newest_epoch"].endswith("Z")
    entries = catalog.catalog_service.get_group(group).entries
    entry = next(item for item in entries if item.norad_id == norad_id)
    time_at_epoch = entry.epoch.isoformat() + "Z"
    direct = satrec_from_tle(entry.omm["_TLE_LINE1"], entry.omm["_TLE_LINE2"])
    cached = satrec_from_omm(entry.omm)
    assert direct.jdsatepoch == cached.jdsatepoch
    assert direct.jdsatepochF == cached.jdsatepochF
    response = client.get("/api/satellites/positions", params={"group": group, "at": time_at_epoch, "ids": entry.norad_id})
    assert response.status_code == 200 and len(response.json()["items"]) == 1
    forecast = client.get(f"/api/satellites/{entry.norad_id}/passes",
                          params={"lat": 44.65, "lon": -63.57, "at": time_at_epoch, "hours": 48})
    assert forecast.status_code == 200
    assert forecast.json()["passes"]


def test_packaged_groups_can_all_propagate_at_the_snapshot_time():
    from datetime import datetime, timezone
    from app.services.orbit.propagator import Propagator

    for group in ("weather", "amateur"):
        snapshot = catalog._bundled_group(group)
        moment = datetime.fromtimestamp(snapshot.fetched_at, timezone.utc).replace(tzinfo=None)
        values = Propagator(snapshot.entries).positions_ecef(moment)
        assert len(values) == len(snapshot.entries)
        assert all(not result.error and result.r_ecef is not None for result in values.values())


def test_alternate_provider_updates_during_celestrak_backoff_and_preserves_better_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    service = catalog.CatalogService()
    bundled = catalog._bundled_group("weather")
    first = bundled.entries[0]
    other = bundled.entries[1]
    new_epoch = first.epoch + timedelta(hours=1)
    newer = replace(first, epoch=new_epoch, origin="alternative_fixture",
                    omm={**first.omm, "EPOCH": new_epoch.isoformat() + "Z"})
    stale_epoch = other.epoch - timedelta(days=1)
    older = replace(other, epoch=stale_epoch,
                    omm={**other.omm, "EPOCH": stale_epoch.isoformat() + "Z"})

    def no_celestrak(*args, **kwargs):
        pytest.fail("an alternate source update must respect the persistent CelesTrak pause")

    calls = []
    monkeypatch.setattr(catalog.httpx, "get", no_celestrak)
    monkeypatch.setattr(catalog, "fetch_public_elements", lambda group: (calls.append(group) or [newer, older], "Public fixture"))
    service._pause_provider(time.time() + 7200)
    assert service.get_group("weather").bundled
    data = service.get_group("weather", force=True)
    assert calls == ["weather"]
    assert not data.bundled and data.source.startswith("Public fixture")
    assert len(data.entries) == len(bundled.entries)
    disk = catalog.CatalogService().get_group("weather")
    assert disk.index()[first.norad_id].epoch == new_epoch
    assert disk.index()[first.norad_id].origin == "alternative_fixture"
    assert disk.index()[other.norad_id].epoch == other.epoch


def test_bundled_catalog_reads_do_not_wait_for_an_online_refresh(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    service = catalog.CatalogService()
    acquired = threading.Event()
    release = threading.Event()
    result = []

    def hold_refresh():
        with service._group_lock("amateur"):
            acquired.set()
            release.wait(timeout=3)

    def read_catalog():
        result.append(service.get_group("amateur"))

    writer = threading.Thread(target=hold_refresh)
    writer.start()
    assert acquired.wait(1)
    reader = threading.Thread(target=read_catalog)
    try:
        reader.start()
        reader.join(timeout=1)
        assert not reader.is_alive()
        assert result[0].bundled
    finally:
        release.set()
        writer.join()
        reader.join()


def test_background_refresh_checks_allowed_groups_then_waits(monkeypatch):
    service = catalog.CatalogService()
    requests = []

    class Timer:
        waits = []

        def wait(self, delay):
            self.waits.append(delay)
            return len(self.waits) == 2

        def is_set(self):
            return False

    def refresh(group, force=False):
        requests.append((group, force))

    monkeypatch.setattr(service, "get_group", refresh)
    timer = Timer()
    service.run_auto_refresh(timer, 21600)
    assert timer.waits == [1, 21600]
    assert requests == [("weather", True), ("amateur", True)]


def test_both_failed_sources_return_the_original_snapshots(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    service = catalog.CatalogService()

    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("Offline")

    monkeypatch.setattr(catalog, "fetch_public_elements", unavailable)
    monkeypatch.setattr(catalog.httpx, "get", unavailable)
    loaded = service.get_group("amateur", force=True)
    assert loaded.bundled and loaded.stale and len(loaded.entries) > 1
    assert not (settings.orbit_cache_dir / "amateur.json").exists()


def test_eumetsat_fallback_validates_original_tle_without_running_source_script(monkeypatch):
    sample = catalog._bundled_group("weather").index()[43013]
    line1, line2 = sample.omm["_TLE_LINE1"], sample.omm["_TLE_LINE2"]
    numeric = "0" if line2[-1] != "0" else "1"
    wrong_checksum = line2[:-1] + numeric
    source = f'values[i++] = "{line1}";\nvalues[i++] = "{wrong_checksum}";\n'
    source += f'values[i++] = "{line1}";\nvalues[i++] = "{line2}";\n'
    calls = []

    def fetch(url, **kwargs):
        calls.append(url)
        request = httpx.Request("GET", url)
        if url.startswith(providers.SATNOGS):
            return httpx.Response(503, request=request)
        if url.endswith("data_content_n20.js"):
            return httpx.Response(200, text=source, request=request)
        return httpx.Response(404, request=request)

    assert len(providers.eumetsat_entries(source, "NOAA 20")) == 1
    monkeypatch.setattr(providers, "_satnogs", providers._SatnogsFeeds())
    monkeypatch.setattr(providers.httpx, "get", fetch)
    entries, label = providers.fetch_public_elements("weather")
    assert label == providers.EUMETSAT_SOURCE
    assert [entry.norad_id for entry in entries] == [43013]
    assert entries[0].omm["_TLE_LINE2"] == line2
    with pytest.raises(RuntimeError, match="SatNOGS"):
        providers.fetch_public_elements("amateur")
    assert sum(url.startswith(providers.SATNOGS) for url in calls) == 1
