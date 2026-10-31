"""pytest 共享夹具：临时数据库 + TestClient。

通过直接修改共享 settings 单例的属性实现隔离（所有模块持有同一对象引用），
并在测试结束后恢复。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path):
    from app.core import config as cfg
    from app.db import database

    saved = {"data_dir": cfg.settings.data_dir}
    cfg.settings.data_dir = tmp_path / "sh_data"
    cfg.settings.ensure_dirs()

    test_engine = database._make_engine(cfg.settings.db_url)
    saved_engine = database.engine
    saved_sessionlocal = database.SessionLocal
    database.engine = test_engine
    database.SessionLocal = database.sessionmaker(
        bind=test_engine, autoflush=False, expire_on_commit=False
    )

    from app.db.models import Base

    Base.metadata.create_all(test_engine)

    from app.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c

    database.engine = saved_engine
    database.SessionLocal = saved_sessionlocal
    cfg.settings.data_dir = saved["data_dir"]
    test_engine.dispose()
