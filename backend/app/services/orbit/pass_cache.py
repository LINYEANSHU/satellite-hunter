"""过境预测结果缓存。

predict_passes 是后端最重的 CPU 路径之一（单星 48h 粗扫 ≈ 5760 点 SGP4 +
二分细化；批量接口最多 500 颗）。同一测站/卫星/窗口的预测会在短时间内被
反复请求（详情面板刷新、过境提醒轮询、任务规划），结果只随
（星历版本, 站坐标, 预测窗口, 参数）变化，适合短 TTL 缓存。

正确性设计：
- 缓存键由调用方组装，必须包含数据版本（单星用 entry.epoch，批量用
  fetched_at）、站坐标与全部影响结果的参数；
- 预测窗口起点对齐（floor_to，默认 600s）：调用方常用 utcnow()/仿真当前
  时间作起点，毫秒级不同会导致永远 miss；对齐后同窗口可命中；
- 对齐使窗口起点早于请求起点最多 600s，调用方应按需过滤已完全结束
  （los <= 请求起点）的过境，保证响应语义为「请求起点起仍可见的过境」；
- 命中返回列表浅拷贝：调用方可能对返回列表排序/截断，不得污染缓存；
  Pass 对象本身视为只读（现有调用方均不修改字段）。
"""
from __future__ import annotations

import calendar
import math
import threading
import time
from datetime import datetime, timezone

from app.services.orbit.passes import Pass


def floor_to(dt: datetime, align_s: float) -> datetime:
    """把 naive UTC 时刻向下对齐到 align_s 边界（显式按 UTC 计算，不用 .timestamp()）。"""
    ts = calendar.timegm(dt.timetuple()) + dt.microsecond / 1e6
    floored = math.floor(ts / align_s) * align_s
    return datetime.fromtimestamp(floored, tz=timezone.utc).replace(tzinfo=None)


class PassForecastCache:
    def __init__(self, max_entries: int = 128, ttl_s: float = 900.0) -> None:
        self._cache: dict[tuple, tuple[float, list[Pass]]] = {}
        self._lock = threading.Lock()
        self._max = max_entries
        self._ttl = ttl_s

    def get_or_compute(self, key: tuple, compute) -> list[Pass]:
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None and (now - hit[0]) < self._ttl:
                return list(hit[1])
        passes = compute()
        with self._lock:
            if len(self._cache) >= self._max:
                self._cache.clear()
            self._cache[key] = (now, list(passes))
        return list(passes)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


pass_forecast_cache = PassForecastCache()
