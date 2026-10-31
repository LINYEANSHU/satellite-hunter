"""设备目录与设备管理。

目录定义在 app/data/equipment.json；真实 RF 参数与游戏平衡参数
通过命名约定区分（game_ 前缀 / 其余为真实参考规格，见 _meta）。
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Equipment, PlayerState, Station

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

CATEGORIES = ("antenna", "sdr", "amplifier", "filter", "rotator", "computer", "storage")

# 每类设备在站内的槽位（单站单件）
SLOTS = {c: c for c in CATEGORIES}


@lru_cache(maxsize=1)
def load_catalog() -> dict:
    with open(DATA_DIR / "equipment.json", encoding="utf-8") as f:
        return json.load(f)


def find_def(catalog_id: str) -> dict | None:
    cat = load_catalog()
    for category in CATEGORIES:
        for item in cat.get(category, []):
            if item["id"] == catalog_id:
                return {**item, "category": category}
    return None


def catalog_view() -> dict:
    cat = load_catalog()
    return {
        "categories": [
            {"category": c, "items": [{**i, "category": c} for i in cat.get(c, [])]}
            for c in CATEGORIES
        ],
        "meta": cat.get("_meta", {}),
    }


def station_equipment(db: Session, station_id: str) -> list[Equipment]:
    return (
        db.query(Equipment)
        .filter(Equipment.station_id == station_id)
        .all()
    )


def station_by_category(db: Session, station_id: str) -> dict[str, Equipment | None]:
    """站内按类别取设备（每槽一件）。"""
    out = {c: None for c in CATEGORIES}
    for eq in station_equipment(db, station_id):
        d = find_def(eq.catalog_id)
        if d:
            out[d["category"]] = eq
    return out


def create_starter_kit(db: Session, save_id: str, station_id: str) -> None:
    """新地面站赠送初始设备（需求 2.1：入门级配置）。"""
    for cid in ("ant_whip", "sdr_starter", "rot_manual", "pc_basic", "sto_basic"):
        db.add(Equipment(save_id=save_id, station_id=station_id, catalog_id=cid))


def buy_equipment(db: Session, save_id: str, catalog_id: str) -> Equipment:
    """购买设备进入库存（不安装）。"""
    d = find_def(catalog_id)
    if d is None:
        raise AppError(404, "EQUIPMENT_NOT_FOUND", f"未知设备: {catalog_id}")
    player = db.get(PlayerState, save_id)
    if player is None:
        raise AppError(404, "SAVE_NOT_FOUND", "存档不存在")
    if player.credits < d["price"]:
        raise AppError(402, "INSUFFICIENT_CREDITS", f"Credits 不足（需要 {d['price']}）")
    player.credits -= d["price"]
    eq = Equipment(save_id=save_id, catalog_id=catalog_id, station_id=None)
    db.add(eq)
    db.flush()
    return eq


def install_equipment(db: Session, save_id: str, equipment_id: str, station_id: str) -> Equipment:
    """安装：库存设备 → 站内槽位（同槽旧设备退回库存）。"""
    eq = db.get(Equipment, equipment_id)
    if eq is None or eq.save_id != save_id:
        raise AppError(404, "EQUIPMENT_NOT_FOUND", "设备不存在")
    st = db.get(Station, station_id)
    if st is None or st.save_id != save_id:
        raise AppError(404, "STATION_NOT_FOUND", "地面站不存在")
    d = find_def(eq.catalog_id)
    if d is None:
        raise AppError(500, "CATALOG_CORRUPT", f"设备目录缺少 {eq.catalog_id}")

    # 同槽位旧设备退回库存
    for other in station_equipment(db, station_id):
        od = find_def(other.catalog_id)
        if od and od["category"] == d["category"] and other.id != eq.id:
            other.station_id = None

    eq.station_id = station_id
    db.flush()
    return eq


def unequip_equipment(db: Session, save_id: str, equipment_id: str) -> Equipment:
    eq = db.get(Equipment, equipment_id)
    if eq is None or eq.save_id != save_id:
        raise AppError(404, "EQUIPMENT_NOT_FOUND", "设备不存在")
    eq.station_id = None
    db.flush()
    return eq


def sell_equipment(db: Session, save_id: str, equipment_id: str) -> float:
    """出售库存设备（半价）。站内设备须先拆卸。"""
    eq = db.get(Equipment, equipment_id)
    if eq is None or eq.save_id != save_id:
        raise AppError(404, "EQUIPMENT_NOT_FOUND", "设备不存在")
    if eq.station_id:
        raise AppError(409, "EQUIPMENT_INSTALLED", "请先拆卸设备再出售")
    d = find_def(eq.catalog_id)
    refund = (d["price"] if d else 0) * 0.5
    player = db.get(PlayerState, save_id)
    if player:
        player.credits += refund
    db.delete(eq)
    db.flush()
    return round(refund, 1)


def equipment_view(eq: Equipment) -> dict:
    d = find_def(eq.catalog_id) or {}
    return {
        "id": eq.id,
        "catalog_id": eq.catalog_id,
        "name": d.get("name", eq.catalog_id),
        "desc": d.get("desc", ""),
        "category": d.get("category"),
        "price": d.get("price"),
        "specs": {k: v for k, v in d.items() if k not in ("id", "name", "desc", "price")},
        "station_id": eq.station_id,
        "status": eq.status,
        "condition": eq.condition,
    }
