"""ISO 时间参数的统一解析（naive UTC 约定）。

后端内部时间一律使用 naive UTC（见 transforms.py / models.py 注释）。API 的
`at` 类参数可能携带 `Z` 后缀或非 UTC 偏移（如 `+08:00`）：

- `astimezone(utc) + replace(tzinfo=None)`：先把时刻换算到 UTC 再去掉 tzinfo（正确）
- `replace(tzinfo=None)`：直接丢弃偏移，时刻含义改变（错误，会产生数小时级偏差）

历史上多个路由各自手写解析，部分用了后一种错误写法；本模块提供唯一实现，
所有路由共用，保证语义一致。
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.core.errors import AppError


def parse_utc_at(at: str | None) -> datetime:
    """ISO 时刻 → naive UTC datetime。空值返回当前 UTC；非法格式抛 400 BAD_TIME。"""
    if not at:
        return datetime.utcnow()
    try:
        dt = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    except ValueError:
        raise AppError(400, "BAD_TIME", f"时间格式无效: {at!r}")
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt
