"""卫星目录服务：CelesTrak GP 获取 + 磁盘缓存 + 限速 + 离线回退。

规则（需求 10.1）：
- 同一分组最新数据至少间隔 cache_ttl（默认 2 小时）才重新请求
- 获取失败时使用最后一次成功缓存并标记 stale
- 缓存文件内含 fetched_at（数据历元信息），前端据此显示数据年龄
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.services.orbit.omm import SatEntry, parse_celestrak_json

log = get_logger(__name__)

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

    def as_status(self) -> dict:
        epochs = [e.epoch for e in self.entries if e.epoch]
        return {
            "group": self.group,
            "label": self.label or GROUP_LABELS.get(self.group, self.group),
            "count": len(self.entries),
            "fetched_at": self.fetched_at,
            "age_hours": round((time.time() - self.fetched_at) / 3600.0, 2),
            "stale": self.stale,
            "error": self.error,
            "newest_epoch": max(epochs).isoformat() if epochs else None,
        }


class CatalogService:
    def __init__(self) -> None:
        self._groups: dict[str, GroupData] = {}
        self._last_attempt: dict[str, float] = {}
        self._lock = threading.Lock()
        # 失败后的最短重试间隔，避免对上游形成压力
        self._min_retry_s = 600.0

    # ---------------------------------------------------------------- 缓存 IO
    def _cache_path(self, group: str):
        return settings.orbit_cache_dir / f"{group}.json"

    def _load_cache(self, group: str) -> GroupData | None:
        path = self._cache_path(group)
        if not path.exists():
            return None
        try:
            blob = json.loads(path.read_text(encoding="utf-8"))
            entries = parse_celestrak_json(blob["records"], group=group)
            return GroupData(
                group=group,
                entries=entries,
                fetched_at=blob["fetched_at"],
                stale=False,
                label=blob.get("label", ""),
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
            "source": "CelesTrak GP (OMM JSON)",
            "records": [e.omm for e in data.entries],
        }
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(blob, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # ---------------------------------------------------------------- 对外接口
    def get_group(self, group: str, force: bool = False) -> GroupData:
        """获取分组数据：内存 → 磁盘缓存 → CelesTrak。"""
        if group not in settings.orbit_groups and group != "user_imported":
            raise AppError(400, "BAD_GROUP", f"未知分组: {group}")

        with self._lock:
            return self._get_group_locked(group, force)

    def _get_group_locked(self, group: str, force: bool) -> GroupData:
        now = time.time()
        mem = self._groups.get(group)
        ttl = settings.orbit_cache_ttl_hours * 3600.0

        if mem is not None and not force and (now - mem.fetched_at) < ttl:
            return mem

        disk = self._load_cache(group)
        if mem is None and disk is not None and not force and (now - disk.fetched_at) < ttl:
            self._groups[group] = disk
            return disk

        # 限速：距上次失败尝试过短则直接用缓存
        last_try = self._last_attempt.get(group, 0.0)
        fresh_enough = disk is not None and (now - disk.fetched_at) < ttl
        if (now - last_try) < self._min_retry_s and fresh_enough:
            data = disk
            data.stale = False
            return data
        if fresh_enough and not force:
            data = disk
            self._groups[group] = data
            return data

        # 请求 CelesTrak
        self._last_attempt[group] = now
        try:
            url = settings.celestrak_base
            resp = httpx.get(
                url,
                params={"GROUP": group, "FORMAT": "json"},
                timeout=60.0,
                headers={"User-Agent": "SatelliteHunter/0.1 (educational game)"},
            )
            resp.raise_for_status()
            records = resp.json()
            if not isinstance(records, list) or not records:
                raise ValueError("CelesTrak 返回空数据")
            entries = parse_celestrak_json(records, group=group)
            data = GroupData(
                group=group,
                entries=entries,
                fetched_at=now,
                stale=False,
                label=GROUP_LABELS.get(group, group),
            )
            self._save_cache(data)
            self._groups[group] = data
            log.info("CelesTrak 分组更新 group=%s count=%d", group, len(entries))
            return data
        except Exception as ex:
            log.warning("CelesTrak 获取失败 group=%s: %s", group, ex)
            if disk is not None:
                data = GroupData(
                    group=group,
                    entries=disk.entries,
                    fetched_at=disk.fetched_at,
                    stale=True,
                    error=f"在线获取失败，已回退到缓存: {ex}",
                    label=GROUP_LABELS.get(group, group),
                )
                self._groups[group] = data
                return data
            raise AppError(
                503,
                "ORBIT_DATA_UNAVAILABLE",
                f"无法获取轨道数据且无本地缓存（分组 {group}）。请检查网络连接。",
            )

    def entries(self, group: str) -> list[SatEntry]:
        return self.get_group(group).entries

    def find(self, norad_id: int, group: str | None = None) -> SatEntry | None:
        if group:
            for e in self.entries(group):
                if e.norad_id == norad_id:
                    return e
            return None
        for g, data in list(self._groups.items()):
            for e in data.entries:
                if e.norad_id == norad_id:
                    return e
        # 未加载的分组中查找（stations 优先）
        for g in settings.orbit_groups:
            data = self._get_group_if_cached(g)
            if data:
                for e in data.entries:
                    if e.norad_id == norad_id:
                        return e
        return None

    def _get_group_if_cached(self, group: str) -> GroupData | None:
        if group in self._groups:
            return self._groups[group]
        return self._load_cache(group)

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
                fetched_at=existing.fetched_at,
                stale=False,
                label=GROUP_LABELS["user_imported"],
            )
            self._save_cache(merged)
            self._groups["user_imported"] = merged
            return added

    def user_entries(self) -> list[SatEntry]:
        data = self._get_group_if_cached("user_imported")
        return data.entries if data else []


catalog_service = CatalogService()
