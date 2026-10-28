#!/usr/bin/env python3
"""Read-only MT5 snapshot bridge for Grandmaster Digital Hub.

Serves exactly one endpoint, GET /snapshot, on 127.0.0.1:8765.

Safety contract:
  - Loopback bind only, with a Host header allowlist (DNS-rebinding guard).
  - No order, modify, close, cancel or withdrawal method exists anywhere.
  - Ticket, comment, magic and identifier are never read into the payload.
  - The account login is masked before it leaves this process.
  - If the MetaTrader5 package or terminal is unavailable the bridge keeps
    running and answers {"connected": false, ...} instead of crashing.
"""

import datetime
import glob
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HOST = "127.0.0.1"
PORT = int(os.environ.get("MT5_BRIDGE_PORT", "8765"))
MAX_POSITIONS = 100
MAX_ABS_NUMBER = 1e12
RETRY_SECONDS = 10
WATCH_SYMBOL = (os.environ.get("MT5_SYMBOL") or "XAUUSDm").strip()[:24]
STALE_SECONDS = max(5, int(os.environ.get("MT5_STALE_SECONDS", "120")))
TRADE_MODES = {0: "demo", 1: "contest", 2: "real"}


def _utc_iso(epoch_seconds):
    try:
        value = float(epoch_seconds)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return datetime.datetime.fromtimestamp(value, tz=datetime.timezone.utc).isoformat()

ALLOWED_HOSTS = {
    f"127.0.0.1:{PORT}",
    f"localhost:{PORT}",
    "127.0.0.1",
    "localhost",
}

try:
    import MetaTrader5 as mt5
except Exception:  # package missing or unsupported platform
    mt5 = None

_mt5_lock = threading.Lock()
_initialized = False
_next_attempt_at = 0.0
_last_failure_reason = "terminal_unavailable"
_logged_failure = None


def _terminal_paths():
    """Explicit MT5_TERMINAL_PATH wins; otherwise find an installed terminal."""
    explicit = os.environ.get("MT5_TERMINAL_PATH", "").strip()
    if explicit:
        return [explicit] if os.path.isfile(explicit) else [None]
    candidates = []
    for root in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        if not root:
            continue
        candidates.extend(glob.glob(os.path.join(root, "MetaTrader 5*", "terminal64.exe")))
    usable = [candidate for candidate in sorted(candidates) if os.path.isfile(candidate)]
    return usable or [None]


def _ensure_initialized():
    """Attach to a running terminal. Returns (ready, reason)."""
    global _initialized, _next_attempt_at, _last_failure_reason, _logged_failure
    if mt5 is None:
        return False, "mt5_package_unavailable"
    if _initialized and mt5.account_info() is not None:
        return True, None
    if time.monotonic() < _next_attempt_at:
        return False, _last_failure_reason

    for path in _terminal_paths():
        try:
            started = mt5.initialize(path) if path else mt5.initialize()
        except Exception:
            started = False
        if started:
            _initialized = True
            _next_attempt_at = 0.0
            _last_failure_reason = None
            return True, None

    _initialized = False
    _next_attempt_at = time.monotonic() + RETRY_SECONDS
    error = None
    try:
        error = mt5.last_error()
    except Exception:
        error = None
    code = error[0] if isinstance(error, tuple) and error else None
    _last_failure_reason = (
        "terminal_not_authorized" if code == -6 else "terminal_unavailable"
    )
    if _logged_failure != _last_failure_reason:
        _logged_failure = _last_failure_reason
        print(
            f"[mt5-bridge] terminal unavailable ({_last_failure_reason}, code {code}); "
            "log in to the terminal and the bridge retries automatically",
            flush=True,
        )
    return False, _last_failure_reason


def _number(value, digits):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")):
        return None
    if abs(result) > MAX_ABS_NUMBER:
        return None
    return round(result, digits)


def _price(value):
    return _number(value, 5)


def _money(value):
    return _number(value, 2)


def _volume(value):
    return _number(value, 2)


def _text(value, limit=64):
    if value is None:
        return None
    cleaned = " ".join(str(value).split())[:limit]
    return cleaned or None


def _mask_login(value):
    if value is None or value == "":
        return None
    text = "".join(str(value).split())
    if not text:
        return None
    if text.startswith("****"):
        return text
    return f"****{text[-4:]}" if len(text) > 4 else "****"


def _terminal_snapshot():
    try:
        info = mt5.terminal_info() if mt5 is not None else None
    except Exception:
        info = None
    if info is None:
        return {"connected": False, "build": None, "company": None}
    return {
        "connected": bool(getattr(info, "connected", False)),
        "build": _number(getattr(info, "build", None), 0),
        "company": _text(getattr(info, "company", None), 48),
    }


def _symbol_snapshot(symbol_name):
    """Read-only market-data health. Does not select symbols or change settings."""
    if mt5 is None or not symbol_name:
        return None
    try:
        info = mt5.symbol_info(symbol_name)
        if info is None:
            matches = mt5.symbols_get(symbol_name) or ()
            info = next(
                (item for item in matches if getattr(item, "name", None) == symbol_name),
                None,
            )
        if info is None:
            return {
                "name": symbol_name,
                "available": False,
                "visible": False,
                "bid": None,
                "ask": None,
                "tickTime": None,
                "tickAgeSeconds": None,
                "stale": True,
            }
        tick = None
        try:
            tick = mt5.symbol_info_tick(symbol_name)
        except Exception:
            tick = None
        tick_time = getattr(tick, "time", None) if tick else None
        age = None
        if tick_time:
            try:
                age = max(0, int(time.time() - float(tick_time)))
            except (TypeError, ValueError):
                age = None
        return {
            "name": symbol_name,
            "available": True,
            "visible": bool(getattr(info, "visible", False)),
            "bid": _price(getattr(tick, "bid", None)) if tick else None,
            "ask": _price(getattr(tick, "ask", None)) if tick else None,
            "tickTime": _utc_iso(tick_time),
            "tickAgeSeconds": age,
            "stale": age is None or age > STALE_SECONDS,
        }
    except Exception:
        return None


def _disconnected(reason):
    return {
        "connected": False,
        "reason": reason,
        "checkedAt": datetime.datetime.now(tz=datetime.timezone.utc).isoformat(),
        "terminal": _terminal_snapshot(),
        "account": None,
        "positions": [],
        "positionsTruncated": False,
        "symbolHealth": _symbol_snapshot(WATCH_SYMBOL),
    }


def read_snapshot():
    if mt5 is None:
        return _disconnected("mt5_package_unavailable")

    with _mt5_lock:
        try:
            ready, reason = _ensure_initialized()
            if not ready:
                return _disconnected(reason)
            account_info = mt5.account_info()
            if account_info is None:
                return _disconnected("terminal_not_logged_in")

            trade_mode_raw = getattr(account_info, "trade_mode", None)
            trade_mode = TRADE_MODES.get(trade_mode_raw, "unknown")
            account = {
                "login": _mask_login(getattr(account_info, "login", None)),
                "server": _text(getattr(account_info, "server", None), 64),
                "currency": _text(getattr(account_info, "currency", None), 8),
                "balance": _money(getattr(account_info, "balance", None)),
                "equity": _money(getattr(account_info, "equity", None)),
                "margin": _money(getattr(account_info, "margin", None)),
                "freeMargin": _money(getattr(account_info, "margin_free", None)),
                "profit": _money(getattr(account_info, "profit", None)),
                "tradeMode": trade_mode,
                "isDemo": trade_mode == "demo",
            }

            raw_positions = mt5.positions_get() or ()
            positions = []
            for position in list(raw_positions)[:MAX_POSITIONS]:
                position_type = getattr(position, "type", None)
                side = "BUY" if position_type == 0 else "SELL" if position_type == 1 else "UNKNOWN"
                positions.append(
                    {
                        "symbol": _text(getattr(position, "symbol", None), 24) or "UNKNOWN",
                        "side": side,
                        "volume": _volume(getattr(position, "volume", None)),
                        "openPrice": _price(getattr(position, "price_open", None)),
                        "currentPrice": _price(getattr(position, "price_current", None)),
                        "profit": _money(getattr(position, "profit", None)),
                    }
                )

            return {
                "connected": True,
                "reason": None,
                "checkedAt": datetime.datetime.now(
                    tz=datetime.timezone.utc
                ).isoformat(),
                "terminal": _terminal_snapshot(),
                "account": account,
                "positions": positions,
                "positionsTruncated": len(raw_positions) > MAX_POSITIONS,
                "symbolHealth": _symbol_snapshot(WATCH_SYMBOL),
            }
        except Exception:
            # Never surface exception text: it can contain local paths or account data.
            return _disconnected("bridge_error")


class Handler(BaseHTTPRequestHandler):
    server_version = "GrandmasterMt5Bridge/1.0"
    protocol_version = "HTTP/1.1"

    def _host_allowed(self):
        host = (self.headers.get("Host") or "").strip().lower()
        return host in ALLOWED_HOSTS

    def _send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_only(self):
        self._send_json(405, {"error": "read_only"}, {"Allow": "GET"})

    do_POST = _read_only
    do_PUT = _read_only
    do_PATCH = _read_only
    do_DELETE = _read_only

    def do_GET(self):
        if not self._host_allowed():
            self._send_json(421, {"error": "host_not_allowed"})
            return
        if urlsplit(self.path).path != "/snapshot":
            self._send_json(404, {"error": "not_found"})
            return
        self._send_json(200, read_snapshot())

    def do_HEAD(self):
        if not self._host_allowed():
            self._send_json(421, {"error": "host_not_allowed"})
            return
        if urlsplit(self.path).path != "/snapshot":
            self._send_json(404, {"error": "not_found"})
            return
        self._send_json(200, read_snapshot())

    def log_message(self, message, *args):
        sys.stderr.write("[mt5-bridge] %s\n" % (message % args))


def main():
    if mt5 is None:
        print("[mt5-bridge] MetaTrader5 package unavailable; serving connected:false", flush=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[mt5-bridge] read-only snapshot at http://{HOST}:{PORT}/snapshot", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
