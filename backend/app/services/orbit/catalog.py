"""卫星目录服务：CelesTrak GP 获取 + 磁盘缓存 + 限速 + 离线回退。

规则（需求 10.1）：
- 同一分组最新数据至少间隔 cache_ttl（默认 2 小时）才重新请求
- 获取失败时使用最后一次成功缓存并标记 stale
- 缓存文件内含 fetched_at（数据历元信息），前端据此显示数据年龄
"""
from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import datetime
from email.utils import parsedate_to_datetime
from functools import lru_cache
from pathlib import Path

import httpx

from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.services.orbit.omm import SatEntry, parse_celestrak_csv, parse_celestrak_json

log = get_logger(__name__)
_BUNDLED_DIR = Path(__file__).resolve().parents[2] / "data" / "orbit_seed"


def _cache_ttl() -> float:
    return max(2.0, settings.orbit_cache_ttl_hours) * 3600.0


def _usable_entries(entries: list[SatEntry]) -> list[SatEntry]:
    valid = []
    angles = ("RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY")
    for entry in entries:
        if entry.norad_id <= 0 or not entry.epoch:
            continue
        try:
            motion = float(entry.omm["MEAN_MOTION"])
            eccentricity = float(entry.omm["ECCENTRICITY"])
            inclination = float(entry.omm["INCLINATION"])
            if (math.isfinite(motion) and motion > 0 and 0 <= eccentricity < 1 and 0 <= inclination <= 180
                    and all(math.isfinite(float(entry.omm[key])) for key in angles)):
                valid.append(entry)
        except (TypeError, KeyError, ValueError):
            continue
    return valid


def _retry_after(header: str, now: float) -> float:
    try:
        return now + int(header.strip())
    except ValueError:
        try:
            return parsedate_to_datetime(header).timestamp()
        except (ValueError, TypeError, OverflowError):
            return now

# 分组中文名（前端展示用）
GROUP_LABELS = {
    "stations": "空间站",
    "weather": "气象卫星",
    "amateur": "业余无线电卫星",
    "science": "科学实验卫星",
    "visual": "肉眼可见目标",
    "geo": "地球静止轨道",
    "active": "全部在轨（活跃）",
    "user_imported": "用户导入",
}


@dataclass
class GroupData:
    group: str
    entries: list[SatEntry]
    fetched_at: float  # unix ts
    stale: bool
    error: str = ""
    label: str = ""
    source: str = "CelesTrak GP"
    bundled: bool = False
    _index: dict[int, SatEntry] | None = field(default=None, repr=False, compare=False)

    def index(self) -> dict[int, SatEntry]:
        """norad_id → entry 索引（惰性构建）。

        find() 是遥测轮询等高频路径，线性扫描大分组（active 约 2 万条）
        每次代价可观；条目集合随 GroupData 对象整体替换（刷新时新建对象），
        因此索引与对象生命周期一致，无需额外失效逻辑。
        """
        idx = self._index
        if idx is None:
            idx = {e.norad_id: e for e in self.entries}
            self._index = idx
        return idx

    def as_status(self) -> dict:
        epochs = [e.epoch for e in self.entries if e.epoch]
        age = time.time() - self.fetched_at
        return {
            "group": self.group,
            "label": self.label or GROUP_LABELS.get(self.group, self.group),
            "count": len(self.entries),
            "fetched_at": self.fetched_at,
            "age_hours": round(age / 3600.0, 2),
            "stale": self.stale or (self.group != "user_imported" and age >= _cache_ttl()),
            "source": self.source,
            "bundled": self.bundled,
            "error": self.error,
            "newest_epoch": max(epochs).isoformat() if epochs else None,
        }


class CatalogService:
    def __init__(self) -> None:
        self._groups: dict[str, GroupData] = {}
        self._last_attempt: dict[str, float] = {}
        # 分组锁合并同组请求；在线锁使所有分组共享来源退避。
        # 本地状态查询和缓存索引无需等待在线请求。
        self._lock = threading.Lock()
        self._online_lock = threading.Lock()
        self._group_locks: dict[str, threading.Lock] = {}
        # 磁盘缓存解析记忆化：mtime 未变时直接复用解析结果（find/status 高频调用）
        self._disk_memo: dict[str, tuple[float, GroupData]] = {}
        # 失败后的最短重试间隔，避免对上游形成压力
        self._min_retry_s = 900.0
        self._backoff_until = 0.0

    def _group_lock(self, group: str) -> threading.Lock:
        with self._lock:
            lk = self._group_locks.get(group)
            if lk is None:
                lk = threading.Lock()
                self._group_locks[group] = lk
            return lk

    # ---------------------------------------------------------------- 缓存 IO
    def _cache_path(self, group: str):
        return settings.orbit_cache_dir / f"{group}.json"

    def _provider_pause(self) -> float:
        try:
            deadline = float((settings.orbit_cache_dir / "celestrak-retry-after").read_text(encoding="ascii"))
            return max(self._backoff_until, deadline)
        except (OSError, ValueError):
            return self._backoff_until

    def _pause_provider(self, until: float) -> None:
        with self._lock:
            self._backoff_until = max(self._provider_pause(), until)
            path = settings.orbit_cache_dir / "celestrak-retry-after"
            tmp = path.with_suffix(".tmp")
            try:
                tmp.write_text(str(self._backoff_until), encoding="ascii")
                tmp.replace(path)
            except OSError:
                log.warning("无法写入轨道来源退避标记")

    def _load_cache(self, group: str) -> GroupData | None:
        path = self._cache_path(group)
        if not path.exists():
            return None
        try:
            blob = json.loads(path.read_text(encoding="utf-8"))
            entries = _usable_entries(parse_celestrak_json(blob["records"], group=group))
            if not entries:
                return None
            return GroupData(
                group=group,
                entries=entries,
                fetched_at=blob["fetched_at"],
                stale=False,
                label=blob.get("label", ""),
                source=blob.get("source", "CelesTrak GP"),
            )
        except Exception as ex:
            log.warning("读取轨道缓存失败 group=%s: %s", group, ex)
            return None

    def _save_cache(self, data: GroupData) -> None:
        path = self._cache_path(data.group)
        blob = {
            "group": data.group,
            "label": data.label,
            "fetched_at": data.fetched_at,
            "source": data.source,
            "records": [e.omm for e in data.entries],
        }
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(blob, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # ---------------------------------------------------------------- 对外接口
    def get_group(self, group: str, force: bool = False) -> GroupData:
        """获取分组数据。手动刷新同样遵循数据源的更新间隔。"""
        if group not in settings.orbit_groups and group != "user_imported":
            raise AppError(400, "BAD_GROUP", f"未知分组: {group}")

        with self._group_lock(group):
            return self._get_group_locked(group)

    def _get_group_locked(self, group: str) -> GroupData:
        now = time.time()
        mem = self._groups.get(group)
        ttl = _cache_ttl()

        if mem is not None and not mem.bundled and now - mem.fetched_at < ttl:
            return mem

        disk = self._load_cache(group)
        if group == "user_imported":
            return disk or GroupData(group, [], now, False, label=GROUP_LABELS[group], source="User import")
        # The provider updates GP data every two hours, including manual refresh.
        if disk is not None and now - disk.fetched_at < ttl:
            self._groups[group] = disk
            return disk

        local = disk or mem or _bundled_group(group)
        if settings.orbit_offline:
            return self._local_fallback(group, local, "离线模式，使用本地轨道数据")
        last_try = self._last_attempt.get(group, 0.0)
        if now - last_try < self._min_retry_s or now < self._provider_pause():
            return self._local_fallback(group, local, "在线更新暂缓，使用本地轨道数据")

        with self._online_lock:
            now = time.time()
            if now < self._provider_pause():
                return self._local_fallback(group, local, "在线更新暂缓，使用本地轨道数据")
            return self._refresh_online(group, local, now)

    def _refresh_online(self, group: str, local: GroupData | None, now: float) -> GroupData:
        self._last_attempt[group] = now
        try:
            resp = httpx.get(
                settings.celestrak_base,
                params={"GROUP": group.upper(), "FORMAT": "CSV"},
                timeout=httpx.Timeout(12.0, connect=5.0),
                headers={"User-Agent": "SatelliteHunter/0.1 (educational game)"},
            )
            resp.raise_for_status()
            entries = _usable_entries(parse_celestrak_csv(resp.text, group=group))
            if not entries:
                raise ValueError("CelesTrak 返回空数据")
            data = GroupData(
                group=group,
                entries=entries,
                fetched_at=now,
                stale=False,
                label=GROUP_LABELS.get(group, group),
                source="CelesTrak GP (OMM CSV)",
            )
            try:
                self._save_cache(data)
            except OSError as ex:
                log.warning("无法写入轨道缓存 group=%s: %s", group, ex)
            self._groups[group] = data
            log.info("CelesTrak 分组更新 group=%s count=%d", group, len(entries))
            return data
        except (httpx.HTTPError, ValueError) as ex:
            log.warning("CelesTrak 获取失败 group=%s: %s", group, ex)
            if isinstance(ex, httpx.HTTPStatusError):
                code = ex.response.status_code
                if code in (403, 429) or code >= 500:
                    failed_at = time.time()
                    deadline = _retry_after(ex.response.headers.get("Retry-After", ""), failed_at)
                    self._pause_provider(max(failed_at + self._min_retry_s, deadline))
                reason = f"在线服务返回 HTTP {code}，使用本地轨道数据"
            else:
                reason = "在线轨道数据暂不可用，使用本地快照"
            return self._local_fallback(group, local, reason)

    def _local_fallback(self, group: str, local: GroupData | None, reason: str) -> GroupData:
        if local is None:
            raise AppError(503, "ORBIT_DATA_UNAVAILABLE", f"在线轨道目录暂不可用，分组 {group} 没有本地快照。")
        data = replace(local, stale=True, error=reason)
        self._groups[group] = data
        return data

    def entries(self, group: str) -> list[SatEntry]:
        return self.get_group(group).entries

    def find(self, norad_id: int, group: str | None = None) -> SatEntry | None:
        """按目录号查找（高频路径：遥测轮询/详情/任务创建）。"""
        if group:
            return self.get_group(group).index().get(norad_id)
        latest, latest_key = None, None
        for g in (*settings.orbit_groups, "user_imported"):
            data = self._get_group_if_cached(g)
            hit = data.index().get(norad_id) if data else None
            if hit is not None:
                key = (hit.epoch_dt or datetime.min, g == "user_imported", not data.bundled, data.fetched_at)
                if latest_key is None or key > latest_key:
                    latest, latest_key = hit, key
        return latest

    def _get_group_if_cached(self, group: str) -> GroupData | None:
        if group in self._groups:
            return self._groups[group]
        # 记忆化：磁盘文件未变化时复用上次解析结果（避免 find/status 每次重解析大 JSON）
        path = self._cache_path(group)
        try:
            mtime = path.stat().st_mtime
        except OSError:
            self._disk_memo.pop(group, None)
            return _bundled_group(group)
        hit = self._disk_memo.get(group)
        if hit is not None and hit[0] == mtime:
            return hit[1]
        data = self._load_cache(group)
        if data is not None:
            self._disk_memo[group] = (mtime, data)
        return data or _bundled_group(group)

    def status(self) -> list[dict]:
        out = []
        for g in list(settings.orbit_groups) + ["user_imported"]:
            data = self._get_group_if_cached(g)
            if data is not None:
                out.append(data.as_status())
            else:
                out.append(
                    {
                        "group": g,
                        "label": GROUP_LABELS.get(g, g),
                        "count": 0,
                        "fetched_at": None,
                        "age_hours": None,
                        "stale": False,
                        "error": None,
                        "newest_epoch": None,
                    }
                )
        return out

    def add_user_entries(self, entries: list[SatEntry]) -> int:
        """合并用户导入的卫星（持久化到 user_imported 缓存组）。"""
        with self._lock:
            existing = self._load_cache("user_imported") or GroupData(
                group="user_imported", entries=[], fetched_at=time.time(), stale=False,
                label=GROUP_LABELS["user_imported"],
            )
            seen = {e.norad_id: e for e in existing.entries}
            added = 0
            for e in entries:
                if e.norad_id in seen:
                    seen[e.norad_id] = e  # 覆盖更新
                else:
                    seen[e.norad_id] = e
                    added += 1
            merged = GroupData(
                group="user_imported",
                entries=list(seen.values()),
                # 导入改变了数据内容，刷新 fetched_at 以使版本化缓存失效
                # （前端显示的"数据年龄"同步归零，语义上更准确）
                fetched_at=time.time(),
                stale=False,
                label=GROUP_LABELS["user_imported"],
                source="User import",
            )
            self._save_cache(merged)
            self._groups["user_imported"] = merged
            return added

    def user_entries(self) -> list[SatEntry]:
        data = self._get_group_if_cached("user_imported")
        return data.entries if data else []


@lru_cache(maxsize=16)
def _bundled_group(group: str) -> GroupData | None:
    path = _BUNDLED_DIR / f"{group}.json"
    if not path.is_file():
        return None
    try:
        blob = json.loads(path.read_text(encoding="utf-8"))
        entries = _usable_entries(parse_celestrak_json(blob["records"], group=group))
        if entries:
            return GroupData(group, entries, float(blob["fetched_at"]), True,
                             label=GROUP_LABELS.get(group, group), source=blob["source"], bundled=True)
    except (ValueError, OSError, KeyError, TypeError):
        log.warning("无法读取随包轨道快照 group=%s", group)
    return None


catalog_service = CatalogService()
