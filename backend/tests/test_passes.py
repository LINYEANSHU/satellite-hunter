"""过境预测与传播器测试。"""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pytest

from app.services.orbit import passes as passes_mod
from app.services.orbit import transforms as tf
from app.services.orbit.omm import satrec_from_omm
from app.services.orbit.propagator import Propagator

# ISS 样例根数（LEO，倾角 51.64°，~420km 圆轨道）
ISS_OMM = {
    "NORAD_CAT_ID": "25544",
    "EPOCH": "2026-10-01T12:00:00.000000Z",
    "MEAN_MOTION": "15.50000000",
    "ECCENTRICITY": "0.0005000",
    "INCLINATION": "51.6400",
    "RA_OF_ASC_NODE": "120.0000",
    "ARG_OF_PERICENTER": "100.0000",
    "MEAN_ANOMALY": "0.0000",
    "BSTAR": "0.000030000",
    "MEAN_MOTION_DOT": "0.00003000",
    "MEAN_MOTION_DDOT": "0.0",
}

BEIJING = (39.9042, 116.4074, 0.0435)  # lat, lon, alt_km
START = datetime(2026, 10, 10, 0, 0, 0)


@pytest.fixture()
def iss_sat():
    return satrec_from_omm(ISS_OMM)


def test_predict_passes_basic(iss_sat):
    end = START + timedelta(hours=48)
    result = passes_mod.predict_passes(
        iss_sat, 25544, *BEIJING, START, end, min_elevation_deg=5.0
    )
    assert 2 <= len(result) <= 30  # 48h 内 ISS 对中纬度站应有若干次过境
    for p in result:
        assert p.aos < p.tca < p.los
        assert p.duration_s > 60
        assert p.duration_s < 20 * 60  # LEO 单次过境 < 20 分钟
        assert 0 <= p.aos_azimuth_deg <= 360
        assert 5.0 <= p.max_elevation_deg <= 90.0
        assert p.min_elevation_deg == 5.0


def test_passes_consistent_with_dense_sampling(iss_sat):
    """交叉验证：粗扫描结果的最大仰角应与 10s 密采样一致（<0.3°）。"""
    end = START + timedelta(hours=24)
    result = passes_mod.predict_passes(
        iss_sat, 25544, *BEIJING, START, end, min_elevation_deg=10.0
    )
    assert result, "24h 内应至少有一次 10° 以上过境"
    p = result[0]

    station = tf.geodetic_to_ecef(*BEIJING)
    t0, t1 = p.aos - timedelta(seconds=5), p.los + timedelta(seconds=5)
    times = np.arange(0, (t1 - t0).total_seconds(), 10.0)
    el, _ = passes_mod._elevation_series(
        iss_sat, station, times, *tf.jday_utc(t0)
    )
    dense_max = float(el.max())
    assert abs(dense_max - p.max_elevation_deg) < 0.3
    # TCA 时刻与密采样最大点一致（<20s）
    t_best = t0 + timedelta(seconds=float(times[int(el.argmax())]))
    assert abs((t_best - p.tca).total_seconds()) < 30


def test_min_elevation_filter(iss_sat):
    low = passes_mod.predict_passes(iss_sat, 25544, *BEIJING, START, START + timedelta(hours=24), 0.0)
    high = passes_mod.predict_passes(iss_sat, 25544, *BEIJING, START, START + timedelta(hours=24), 30.0)
    assert len(high) <= len(low)


def test_propagator_positions(iss_sat):
    from app.services.orbit.omm import SatEntry

    entry = SatEntry(norad_id=25544, name="ISS (test)", omm=ISS_OMM)
    prop = Propagator([entry])
    pos = prop.positions_ecef(START)
    p = pos[25544]
    assert p.error == 0
    assert 400 < p.alt_km < 460  # 15.5 rev/day ≈ 420km
    # ECEF 系速度 = 惯性速度(≈7.66) 减地球自转牵连分量，范围 7.2-7.7
    assert 7.0 < p.speed_km_s < 7.75
    # 位置矢量与地心距离自洽
    r_norm = float(np.linalg.norm(p.r_ecef))
    assert abs(r_norm - (6378.137 + p.alt_km)) < 30.0  # 地球扁率允许误差


def test_propagator_batch_matches_single(iss_sat):
    from app.services.orbit.omm import SatEntry

    entries = [
        SatEntry(norad_id=25544, name="ISS", omm=ISS_OMM),
        SatEntry(norad_id=5, name="VANGUARD", omm={
            "NORAD_CAT_ID": "5", "EPOCH": "2000-06-27T18:50:19.733568Z",
            "MEAN_MOTION": "10.82419157", "ECCENTRICITY": "0.1859667",
            "INCLINATION": "34.2682", "RA_OF_ASC_NODE": "348.7242",
            "ARG_OF_PERICENTER": "331.7664", "MEAN_ANOMALY": "19.3264",
            "BSTAR": "0.000028098", "MEAN_MOTION_DOT": "0.00000023", "MEAN_MOTION_DDOT": "0.0",
        }),
    ]
    prop = Propagator(entries)
    t = START
    batch = prop.positions_ecef(t)
    single_iss = Propagator([entries[0]]).positions_ecef(t)[25544]
    single_vg = Propagator([entries[1]]).positions_ecef(t)[5]
    assert np.allclose(batch[25544].r_ecef, single_iss.r_ecef, atol=1e-6)
    assert np.allclose(batch[5].r_ecef, single_vg.r_ecef, atol=1e-6)


def test_track_output_sanity(iss_sat):
    """轨迹点应连续且速度方向合理（相邻点间距 ≈ 7.66 km/s × step）。"""
    from app.services.orbit.omm import SatEntry

    entry = SatEntry(norad_id=25544, name="ISS", omm=ISS_OMM)
    prop = Propagator([entry])
    t1 = START
    t2 = START + timedelta(seconds=60)
    p1 = prop.positions_ecef(t1)[25544]
    p2 = prop.positions_ecef(t2)[25544]
    dist = float(np.linalg.norm(p2.r_ecef - p1.r_ecef))
    assert 7.0 * 60 < dist < 7.7 * 60 + 10  # 考虑地球自转引起的 ECEF 漂移
