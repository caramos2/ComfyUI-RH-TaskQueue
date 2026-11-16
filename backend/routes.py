"""HTTP routes exposed by the plugin under the /rh_queue prefix.

These routes cover the duration history only. Task state is never stored
here: the plugin reads it from ComfyUI's own Jobs API, so this backend stays
a small, single-purpose component.
"""

import json
import logging
import os
import subprocess
import sys
import time

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


def _output_base_dir(kind):
    """The ComfyUI directory a given output type lives in."""
    import folder_paths

    if kind == "input":
        return folder_paths.get_input_directory()
    if kind == "temp":
        return folder_paths.get_temp_directory()
    return folder_paths.get_output_directory()


def _resolve_output_path(kind, subfolder, filename):
    """Resolve an output file inside ComfyUI's own directories.

    Returns the file path when it exists, the containing folder when only
    the folder exists, and None when neither does. Raises ValueError when
    the path would escape the base directory.
    """
    base = os.path.realpath(_output_base_dir(kind))
    candidate = os.path.realpath(os.path.join(base, subfolder or "", filename))
    try:
        inside = os.path.commonpath([base, candidate]) == base
    except ValueError:
        inside = False
    if not inside:
        raise ValueError("path escapes the ComfyUI output directory")
    if os.path.isfile(candidate):
        return candidate
    folder = os.path.dirname(candidate)
    if os.path.isdir(folder):
        return folder
    return None


def _reveal_in_file_manager(path, is_file):
    """Show a path in the OS file manager. True when it was opened."""
    try:
        if sys.platform.startswith("win"):
            if is_file:
                subprocess.Popen('explorer /select,"' + os.path.normpath(path) + '"')
            else:
                subprocess.Popen('explorer "' + os.path.normpath(path) + '"')
            return True
        if sys.platform == "darwin":
            args = ["open", "-R"] if is_file else ["open"]
            subprocess.Popen(args + [path])
            return True
        folder = path if not is_file else os.path.dirname(path)
        subprocess.Popen(["xdg-open", folder])
        return True
    except Exception as exc:  # pragma: no cover - desktop integration
        logging.warning("[ComfyUI-RH-TaskQueue] could not open the file manager: %s", exc)
        return False


_TITLE_CACHE = {"at": 0.0, "titles": {}}
_TITLE_CACHE_TTL = 60.0


def _user_workflow_titles():
    """Map graph id -> workflow title from the user's workflow folder.

    ComfyUI stores every saved workflow as a JSON file whose name IS the
    workflow title, and whose "id" field is the graph id ComfyUI reports as
    workflow_id. That file is the only place a title exists at all: the
    graph ComfyUI keeps in the job has an id but no name.
    """
    titles = {}
    try:
        import folder_paths

        user_dir = folder_paths.get_user_directory()
    except Exception as exc:  # pragma: no cover - depends on the install
        logging.debug("[ComfyUI-RH-TaskQueue] workflow titles unavailable: %s", exc)
        return titles

    # The frontend keeps the saved workflows in its own profile folder, which
    # is "user/default" on a default install.
    folders = [
        os.path.join(user_dir, "default", "workflows"),
        os.path.join(user_dir, "workflows"),
    ]
    for folder in folders:
        try:
            names = sorted(os.listdir(folder))
        except OSError:
            continue
        for name in names:
            if name.startswith(".") or not name.lower().endswith(".json"):
                continue
            path = os.path.join(folder, name)
            try:
                if os.path.getsize(path) > 32 * 1024 * 1024:
                    continue
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except Exception:
                continue
            if isinstance(data, dict):
                graph_id = data.get("id")
                if isinstance(graph_id, str) and graph_id:
                    titles[graph_id] = name[:-5]
    return titles


def _cached_workflow_titles():
    now = time.time()
    if now - _TITLE_CACHE["at"] < _TITLE_CACHE_TTL:
        return _TITLE_CACHE["titles"]
    titles = _user_workflow_titles()
    _TITLE_CACHE["at"] = now
    _TITLE_CACHE["titles"] = titles
    return titles


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
        if record is None:
            # Defensive: a missing row must not become a 500 for the frontend.
            return _json(
                {
                    "ok": False,
                    "found": False,
                    "last_duration": None,
                    "avg_duration": None,
                    "sample_count": 0,
                }
            )
        return _json(
            {
                "ok": True,
                "last_duration": record["last_duration"],
                "avg_duration": record["avg_duration"],
                "sample_count": record["sample_count"],
            }
        )

    @routes.get("/rh_queue/workflow_titles")
    async def rh_workflow_titles(request):
        """Workflow id -> title, read from the user's saved workflows."""
        titles = _cached_workflow_titles()
        return _json({"titles": titles, "count": len(titles)})

    @routes.post("/rh_queue/reveal")
    async def rh_reveal(request):
        """Show an output file in the OS file manager.

        The file name is resolved against ComfyUI's own output directories
        and must stay inside them.
        """
        payload = await _read_json(request)
        if not isinstance(payload, dict):
            return _json({"error": "invalid json body"}, status=400)
        filename = payload.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            return _json({"error": "filename is required"}, status=400)
        subfolder = payload.get("subfolder") or ""
        kind = payload.get("type") or "output"
        if not isinstance(subfolder, str) or not isinstance(kind, str):
            return _json({"error": "invalid subfolder or type"}, status=400)
        try:
            resolved = _resolve_output_path(kind, subfolder, filename)
        except ValueError as exc:
            return _json({"error": str(exc)}, status=400)
        if resolved is None:
            return _json({"error": "output not found"}, status=404)
        opened = _reveal_in_file_manager(resolved, os.path.isfile(resolved))
        return _json({"ok": opened, "path": resolved})

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
