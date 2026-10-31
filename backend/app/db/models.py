"""SQLAlchemy ORM 模型。

游戏数据按存档（Save）隔离；所有外部世界数据（卫星、录波、解码结果）
都通过 source 字段标记数据来源，参见需求书 9.4 数据真实性。
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # SQLite 存 naive UTC


def gen_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


def _ts_columns():
    return None


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


# ---------------------------------------------------------------- 存档与玩家
class Save(Base, TimestampMixin):
    __tablename__ = "saves"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    game_version: Mapped[str] = mapped_column(String(16), default="0.1.0")
    last_played_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    sim_time_mode: Mapped[str] = mapped_column(String(16), default="realtime")  # realtime | sim
    sim_time_scale: Mapped[float] = mapped_column(Float, default=1.0)
    sim_time_offset_s: Mapped[float] = mapped_column(Float, default=0.0)  # 模拟时间偏移(秒)


class PlayerState(Base, TimestampMixin):
    __tablename__ = "player_state"

    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), primary_key=True)
    credits: Mapped[float] = mapped_column(Float, default=5000.0)
    research_points: Mapped[float] = mapped_column(Float, default=0.0)
    xp: Mapped[float] = mapped_column(Float, default=0.0)
    level: Mapped[int] = mapped_column(Integer, default=1)
    total_missions_done: Mapped[int] = mapped_column(Integer, default=0)
    satellites_discovered: Mapped[int] = mapped_column(Integer, default=0)


# ---------------------------------------------------------------- 地面站
class Station(Base, TimestampMixin):
    __tablename__ = "stations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    lat: Mapped[float] = mapped_column(Float)  # WGS84 纬度
    lon: Mapped[float] = mapped_column(Float)  # WGS84 经度
    alt_m: Mapped[float] = mapped_column(Float, default=0.0)  # 海拔(米)
    min_elevation_deg: Mapped[float] = mapped_column(Float, default=5.0)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|maintenance|offline
    is_virtual: Mapped[bool] = mapped_column(Boolean, default=True)  # 真实接收模式的站须为 false
    maintenance: Mapped[float] = mapped_column(Float, default=100.0)  # 维护状态 0-100
    power_draw_w: Mapped[float] = mapped_column(Float, default=0.0)

    __table_args__ = (Index("ix_stations_save", "save_id"),)


# ---------------------------------------------------------------- 设备
class Equipment(Base, TimestampMixin):
    """玩家拥有的设备实例。station_id 为空表示在库存中。"""

    __tablename__ = "equipment"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    station_id: Mapped[str | None] = mapped_column(
        ForeignKey("stations.id", ondelete="SET NULL"), index=True, nullable=True
    )
    catalog_id: Mapped[str] = mapped_column(String(64))  # 设备目录 ID（见 app/data/equipment.json）
    tier: Mapped[int] = mapped_column(Integer, default=1)  # 同型号升级等级
    status: Mapped[str] = mapped_column(String(16), default="ok")  # ok|fault|offline
    condition: Mapped[float] = mapped_column(Float, default=100.0)  # 磨损/故障状态 0-100
    slot: Mapped[str | None] = mapped_column(String(32), nullable=True)  # 在站内占用的槽位


# ---------------------------------------------------------------- 任务
class Mission(Base, TimestampMixin):
    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    station_id: Mapped[str] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"), index=True)
    satellite_id: Mapped[int] = mapped_column(Integer, index=True)  # NORAD 目录号
    satellite_name: Mapped[str] = mapped_column(String(128), default="")
    type: Mapped[str] = mapped_column(String(32))  # tutorial/track/plan/capture/decode/auto/collection
    status: Mapped[str] = mapped_column(String(16), default="planned")
    # planned | active | completed | failed | cancelled | scheduled
    priority: Mapped[int] = mapped_column(Integer, default=5)  # 1 最高
    aos: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    los: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    max_elevation_deg: Mapped[float] = mapped_column(Float, default=0.0)
    frequency_hz: Mapped[float | None] = mapped_column(Float, nullable=True)
    required_equipment: Mapped[list] = mapped_column(JSON, default=list)  # [{"category": "antenna", ...}]
    planned_duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    estimated_data_mb: Mapped[float] = mapped_column(Float, default=0.0)
    reward_credits: Mapped[float] = mapped_column(Float, default=0.0)
    reward_rp: Mapped[float] = mapped_column(Float, default=0.0)
    reward_xp: Mapped[float] = mapped_column(Float, default=0.0)
    seed: Mapped[int] = mapped_column(Integer, default=0)  # 模拟确定性随机种子
    result: Mapped[dict] = mapped_column(JSON, default=dict)  # 执行结果与原因
    auto: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failure_reason: Mapped[str] = mapped_column(Text, default="")
    data_produced_mb: Mapped[float] = mapped_column(Float, default=0.0)

    __table_args__ = (Index("ix_missions_save_status", "save_id", "status"),)


# ---------------------------------------------------------------- 卫星图鉴
class CollectionEntry(Base, TimestampMixin):
    __tablename__ = "collection_entries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    satellite_id: Mapped[int] = mapped_column(Integer, index=True)  # NORAD 目录号
    satellite_name: Mapped[str] = mapped_column(String(128), default="")
    category: Mapped[str] = mapped_column(String(32), default="other")
    status: Mapped[str] = mapped_column(String(16), default="tracked")
    # tracked | received | decoded  —— 对应可轨道追踪/已接收/已解码
    first_observed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    successful_missions: Mapped[int] = mapped_column(Integer, default=0)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")

    __table_args__ = (UniqueConstraint("save_id", "satellite_id", name="uq_collection_sat"),)


# ---------------------------------------------------------------- 数据收藏
class CollectionItem(Base, TimestampMixin):
    """玩家保存的数据收藏（解码图、频谱截图、任务结果、笔记等）。

    source 必须是 9.4 节定义的来源之一；禁止把非真实数据标成 Real Observation。
    """

    __tablename__ = "collection_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    satellite_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(32))
    # decoded_image | spectrum_snapshot | mission_result | iq_record_note | orbit_snapshot | note
    source: Mapped[str] = mapped_column(String(24))
    # REAL_ORBIT | SIMULATED_RF | RECORDED_IQ | LIVE_SDR | DECODED_OUTPUT | GAME_EVENT
    title: Mapped[str] = mapped_column(String(128))
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)  # 小体量元数据
    notes: Mapped[str] = mapped_column(Text, default="")


# ---------------------------------------------------------------- 成就
class Achievement(Base):
    __tablename__ = "achievements"

    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), primary_key=True)
    achievement_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    unlocked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------- 录波与 SatDump
class Recording(Base, TimestampMixin):
    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(256))
    path: Mapped[str] = mapped_column(String(512))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    format: Mapped[str] = mapped_column(String(16), default="")  # cf32/cs16/cs8/cu8/f32...
    sample_rate_hz: Mapped[float] = mapped_column(Float, default=0.0)
    center_frequency_hz: Mapped[float] = mapped_column(Float, default=0.0)
    satellite_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(24), default="RECORDED_IQ")
    notes: Mapped[str] = mapped_column(Text, default="")


class SatdumpJob(Base, TimestampMixin):
    __tablename__ = "satdump_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    recording_id: Mapped[str] = mapped_column(ForeignKey("recordings.id", ondelete="CASCADE"))
    pipeline: Mapped[str] = mapped_column(String(64))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending | running | done | failed | cancelled
    log_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    output_dir: Mapped[str | None] = mapped_column(String(512), nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str] = mapped_column(Text, default="")
    result_files: Mapped[list] = mapped_column(JSON, default=list)


# ---------------------------------------------------------------- 自动化规则与事件
class AutoRule(Base, TimestampMixin):
    __tablename__ = "auto_rules"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    station_id: Mapped[str] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(64))
    rules: Mapped[dict] = mapped_column(JSON, default=dict)  # 优先级规则配置
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class GameEvent(Base):
    """游戏事件流水：成就解锁、特殊事件、经济变动等，供回放与成就判定。"""

    __tablename__ = "game_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    ts: Mapped[float] = mapped_column(Float, default=time.time)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(24), default="GAME_EVENT")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
