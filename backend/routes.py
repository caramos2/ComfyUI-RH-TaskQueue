"""HTTP routes exposed by the plugin under the /rh_queue prefix.

These routes cover the duration history only. Task state is never stored
here: the plugin reads it from ComfyUI's own Jobs API, so this backend stays
a small, single-purpose component.
"""

import logging

from aiohttp import web

from .duration_store import DurationStore
from .fingerprint import is_valid_signature, is_valid_version

PLUGIN_VERSION = "1.0.0"

_JOB_STATUSES = ("pending", "in_progress", "completed", "failed", "cancelled")


def _json(data, status=200):
    return web.json_response(data, status=status)


def _detect_caps():
    """Inspect the live server route table for the APIs we can rely on."""
    caps = {"jobs_api": False, "legacy_api": False, "cancel_api": False}
    try:
        from server import PromptServer

        app = PromptServer.instance.app
        paths = set()
        for route in app.router.routes():
            resource = getattr(route, "resource", None)
            if resource is None:
                continue
            canonical = getattr(resource, "canonical", None)
            if canonical:
                paths.add(canonical)
        caps["jobs_api"] = "/api/jobs" in paths
        caps["legacy_api"] = "/queue" in paths and "/history" in paths
        caps["cancel_api"] = "/api/jobs/{job_id}/cancel" in paths
    except Exception as exc:  # pragma: no cover - diagnostics only
        logging.debug("[ComfyUI-RH-TaskQueue] capability detection failed: %s", exc)
    return caps


def _int_param(request, name, default, minimum, maximum):
    raw = request.rel_url.query.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(value, maximum))


async def _read_json(request):
    try:
        return await request.json()
    except Exception:
        return None


def register_routes(routes, store: DurationStore):
    """Attach the /rh_queue/* routes to ComfyUI's route table."""

    @routes.get("/rh_queue/health")
    async def rh_health(request):
        caps = _detect_caps()
        mode = "jobs_api" if caps["jobs_api"] else (
            "legacy" if caps["legacy_api"] else "unknown"
        )
        return _json(
            {
                "version": PLUGIN_VERSION,
                "db": store.health(),
                "caps": caps,
                "mode": mode,
            }
        )

    @routes.post("/rh_queue/estimate")
    async def rh_estimate(request):
        payload = await _read_json(request)
        if not isinstance(payload, dict):
            return _json({"error": "invalid json body"}, status=400)
        signature = payload.get("signature")
        if not is_valid_signature(signature):
            return _json({"error": "invalid signature"}, status=400)
        record = store.get(signature)
        if record is None:
            return _json(
                {
                    "found": False,
                    "last_duration": None,
                    "avg_duration": None,
                    "sample_count": 0,
                    "updated_at": None,
                }
            )
        return _json(
            {
                "found": True,
                "last_duration": record["last_duration"],
                "avg_duration": record["avg_duration"],
                "sample_count": record["sample_count"],
                "updated_at": record["updated_at"],
            }
        )

    @routes.post("/rh_queue/record")
    async def rh_record(request):
        payload = await _read_json(request)
        if not isinstance(payload, dict):
            return _json({"error": "invalid json body"}, status=400)
        signature = payload.get("signature")
        if not is_valid_signature(signature):
            return _json({"error": "invalid signature"}, status=400)
        version = payload.get("signature_version", 1)
        if not is_valid_version(version):
            return _json({"error": "invalid signature_version"}, status=400)
        duration = payload.get("duration")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)):
            return _json({"error": "invalid duration"}, status=400)
        if duration < 0:
            return _json({"error": "duration must be >= 0"}, status=400)
        prompt_id = payload.get("prompt_id")
        record = store.record(signature, float(duration), prompt_id, version)
        return _json(
            {
                "ok": True,
                "last_duration": record["last_duration"],
                "avg_duration": record["avg_duration"],
                "sample_count": record["sample_count"],
            }
        )

    @routes.get("/rh_queue/history")
    async def rh_history(request):
        limit = _int_param(request, "limit", 50, 1, 500)
        offset = _int_param(request, "offset", 0, 0, 10 ** 9)
        return _json(store.list(limit=limit, offset=offset))

    @routes.delete("/rh_queue/history/{signature}")
    async def rh_history_delete(request):
        signature = request.match_info.get("signature", "")
        if not is_valid_signature(signature):
            return _json({"error": "invalid signature"}, status=400)
        return _json({"ok": True, "deleted": store.delete(signature)})
