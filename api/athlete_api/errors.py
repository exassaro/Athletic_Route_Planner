"""One error shape for every failure: {"error": code, "message": text, "detail": ...} (blueprint section 12)."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorBody(BaseModel):
    error: str
    message: str
    detail: Any = None


class ApiError(Exception):
    def __init__(self, status: int, error: str, message: str, detail: Any = None,
                 headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status, self.error, self.message, self.detail, self.headers = status, error, message, detail, headers


def _json(status: int, error: str, message: str, detail: Any = None, headers=None) -> JSONResponse:
    return JSONResponse(status_code=status, headers=headers,
                        content=ErrorBody(error=error, message=message, detail=detail).model_dump(mode="json"))


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return _json(exc.status, exc.error, exc.message, exc.detail, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError):
        detail = [{k: v for k, v in e.items() if k in ("loc", "msg", "type")} for e in exc.errors()]
        return _json(422, "invalid_request", "The request is not valid.", detail)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        codes = {404: "not_found", 405: "method_not_allowed"}
        return _json(exc.status_code, codes.get(exc.status_code, "http_error"), str(exc.detail))


def responses(*statuses: int) -> dict[int, dict]:
    """OpenAPI entries for the error statuses an endpoint can return."""
    return {s: {"model": ErrorBody} for s in statuses}
