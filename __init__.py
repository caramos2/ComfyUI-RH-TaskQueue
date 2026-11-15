"""ComfyUI-RH-TaskQueue - RunningHub style task monitoring for ComfyUI.

The plugin has two halves:
  * a tiny Python backend that stores workflow duration samples and exposes
    them under /rh_queue/*,
  * a frontend extension that renders the right-hand task drawer, keeps a
    plugin-managed submission queue and reports real execution durations.

ComfyUI loads a custom node as a *top level* module, so relative imports are
unavailable and a plain "backend" package name would risk colliding with
another custom node. The backend is therefore loaded under a unique package
name with an explicit search location.
"""

import importlib
import importlib.util
import logging
import os
import sys

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND_PKG = "rh_taskqueue_backend"


def _load_backend():
    """Import the backend package under a collision-proof name."""
    if _BACKEND_PKG in sys.modules:
        return sys.modules[_BACKEND_PKG]
    pkg_dir = os.path.join(_HERE, "backend")
    init_file = os.path.join(pkg_dir, "__init__.py")
    spec = importlib.util.spec_from_file_location(
        _BACKEND_PKG, init_file, submodule_search_locations=[pkg_dir]
    )
    if spec is None or spec.loader is None:
        raise ImportError("cannot load rh_taskqueue_backend package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[_BACKEND_PKG] = module
    spec.loader.exec_module(module)
    return module


def _register_backend():
    try:
        from server import PromptServer

        backend = _load_backend()
        duration_store = importlib.import_module(_BACKEND_PKG + ".duration_store")
        routes_mod = importlib.import_module(_BACKEND_PKG + ".routes")

        db_path = os.path.join(_HERE, "data", "duration_history.sqlite3")
        store = duration_store.DurationStore(db_path)
        routes_mod.register_routes(PromptServer.instance.routes, store)
        logging.info(
            "[ComfyUI-RH-TaskQueue] registered /rh_queue/* routes (db=%s)", db_path
        )
    except Exception as exc:
        # Never break ComfyUI startup because of an optional plugin.
        logging.warning("[ComfyUI-RH-TaskQueue] backend not registered: %s", exc)


_register_backend()
