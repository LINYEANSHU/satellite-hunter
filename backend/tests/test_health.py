"""Phase 0 基础测试：健康检查与能力探测。"""
from __future__ import annotations


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "time_utc" in data
    assert "python" in data


def test_capabilities(client):
    r = client.get("/api/system/capabilities")
    assert r.status_code == 200
    data = r.json()
    assert "satdump" in data
    assert "disk" in data
    assert data["orbit"]["cache_ttl_hours"] > 0
    assert isinstance(data["satdump"], dict)
    assert "installed" in data["satdump"]


def test_openapi_available(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    paths = r.json()["paths"]
    assert "/api/health" in paths
    assert "/api/system/capabilities" in paths


def test_recordings_empty(client):
    # 需要 save_id 参数；不存在的存档应返回空列表而非 500
    r = client.get("/api/recordings", params={"save_id": "nonexistent"})
    assert r.status_code == 200
    assert r.json() == []
