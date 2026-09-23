"""Double-submit CSRF protection for cookie-authenticated mutating requests
(docs/plans/session-persistence-and-url-routing.md, D-csrf).

Only applies to real HTTP requests (BaseHTTPMiddleware never sees websocket scopes - the
websocket handshake is protected separately, by the Origin check in
infrastructure/websocket/router.py). Needs no server-side session store: the frontend reads the
non-httponly `mlops_csrf` cookie and echoes it as a header, and this only checks that the two
match - the value itself is meaningless outside that comparison.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from mlops_serious_game.application.services.auth_service import CSRF_COOKIE_NAME

CSRF_HEADER_NAME = "x-csrf-token"

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Endpoints reachable before any CSRF cookie exists yet (there's nothing to double-submit
# against), plus /reset-memory, a pre-existing unauthenticated dev/testing utility with no cookie
# session of its own to protect.
_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/verify-email",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/reset-memory",
}


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in _MUTATING_METHODS and request.url.path not in _EXEMPT_PATHS:
            cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
            header_token = request.headers.get(CSRF_HEADER_NAME)
            if not cookie_token or not header_token or cookie_token != header_token:
                return JSONResponse(
                    {"detail": "Missing or invalid CSRF token."}, status_code=403
                )
        return await call_next(request)
