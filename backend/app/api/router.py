"""API 路由汇总。"""
from fastapi import APIRouter

from app.api.routes import game, missions_ws, recordings, satellites, stations, system

api_router = APIRouter(prefix="/api")
api_router.include_router(system.router)
api_router.include_router(game.router)
api_router.include_router(satellites.router)
api_router.include_router(stations.router)
api_router.include_router(recordings.router)
api_router.include_router(missions_ws.router)
