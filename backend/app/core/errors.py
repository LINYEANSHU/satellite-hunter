"""统一 API 错误模型。"""
from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    """带 HTTP 状态码与机器可读错误码的业务异常。"""

    def __init__(self, status_code: int, code: str, message: str, detail: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail = detail or {}


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, **exc.detail}},
    )


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = exc.errors()
    # 清理不可序列化对象，只保留定位与提示
    clean = [
        {k: v for k, v in d.items() if k in ("loc", "msg", "type") and not callable(v)}
        for d in details
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION",
                "message": "请求参数校验失败",
                "details": clean,
            }
        },
    )


async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    from app.core.logging import get_logger

    get_logger(__name__).exception("Unhandled error")
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL", "message": f"内部错误: {exc}"}},
    )
