"""WebSocket：卫星追踪、任务进度、接收状态、解码事件推送。

Phase 0 先建立连接管理与广播基础设施，各业务模块通过 hub.publish() 推送。
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger

router = APIRouter()
log = get_logger(__name__)


class ConnectionHub:
    """极简广播 hub：按 topic 分组管理连接。"""

    def __init__(self) -> None:
        self._conns: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, topic: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._conns[topic].add(ws)

    async def disconnect(self, topic: str, ws: WebSocket) -> None:
        async with self._lock:
            self._conns[topic].discard(ws)

    async def publish(self, topic: str, message: dict) -> None:
        data = json.dumps(message, ensure_ascii=False, default=str)
        async with self._lock:
            conns = list(self._conns.get(topic, ()))
        for ws in conns:
            try:
                await ws.send_text(data)
            except Exception:  # 连接已断开等
                await self.disconnect(topic, ws)

    def connections(self, topic: str | None = None) -> int:
        if topic:
            return len(self._conns.get(topic, ()))
        return sum(len(v) for v in self._conns.values())


hub = ConnectionHub()


@router.websocket("/ws/{topic}")
async def ws_endpoint(ws: WebSocket, topic: str) -> None:
    await hub.connect(topic, ws)
    log.info("WS connect topic=%s total=%d", topic, hub.connections())
    try:
        while True:
            # 客户端可发送 {"action": "ping"} 维持心跳；其余消息当前忽略
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("action") == "ping":
                await ws.send_text(json.dumps({"type": "pong", "ts": msg.get("ts")}))
    except WebSocketDisconnect:
        await hub.disconnect(topic, ws)
        log.info("WS disconnect topic=%s total=%d", topic, hub.connections())
    except Exception:
        await hub.disconnect(topic, ws)
        log.exception("WS error topic=%s", topic)
