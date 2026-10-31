"""应用配置管理。

所有路径默认相对于 backend/ 目录解析；可用环境变量覆盖（前缀 SH_）。
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SH_", env_file=".env", extra="ignore")

    app_name: str = "Satellite Hunter: Ground Station"
    version: str = "0.1.0"
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "INFO"

    # 运行数据根目录（数据库、轨道缓存、录波、输出）
    data_dir: Path = BACKEND_DIR / "data"

    # 轨道数据
    celestrak_base: str = "https://celestrak.org/NORAD/elements/gp.php"
    orbit_cache_ttl_hours: float = 2.0  # 同组数据至少间隔 2 小时才重新请求
    default_min_elevation_deg: float = 0.0

    # 允许使用的卫星分组（CelesTrak GROUP 参数）
    orbit_groups: tuple[str, ...] = (
        "stations",
        "weather",
        "amateur",
        "science",
        "visual",
        "geo",
        "active",
    )

    # SatDump
    satdump_bin: str = "satdump"  # Windows PATH 中的可执行名
    wsl_distro: str = "Ubuntu-24.04"
    satdump_timeout_s: int = 3600

    # 安全
    cors_origins: tuple[str, ...] = (
        "http://localhost:5273",
        "http://127.0.0.1:5273",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "satellite_hunter.db"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"

    @property
    def orbit_cache_dir(self) -> Path:
        return self.data_dir / "orbit_cache"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def recordings_dir(self) -> Path:
        return self.data_dir / "recordings"

    @property
    def decoded_dir(self) -> Path:
        return self.data_dir / "decoded"

    @property
    def frontend_dist(self) -> Path:
        return BACKEND_DIR.parent / "frontend" / "dist"

    def ensure_dirs(self) -> None:
        for d in (
            self.data_dir,
            self.orbit_cache_dir,
            self.logs_dir,
            self.recordings_dir,
            self.decoded_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
