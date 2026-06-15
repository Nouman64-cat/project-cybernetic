"""
Project-root entry point for the SynapseGrip API server.

Run from the project root (project-cybernetic/):

    python run_server.py                 # default: localhost:7005, reload on
    python run_server.py --port 7005     # custom port
    python run_server.py --no-reload     # production-style, no file watcher

Why this file exists
--------------------
The server/ directory is a Python package that uses relative imports
(e.g. `from .config import settings`).  Relative imports only resolve when
the package is loaded as part of a known parent package — i.e. when Python
is invoked from the project root with `server` on the module path.

Running `python main.py` or `uvicorn main:app` from *inside* server/ treats
main.py as a top-level script and breaks all relative imports.  This script
solves that by always launching from the correct directory context.
"""

import argparse
import sys
from pathlib import Path

# Ensure the project root is on sys.path so `import server` resolves
# correctly even when invoked as `python run_server.py` from any CWD.
ROOT = Path(__file__).parent.resolve()
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402 — import after path is set


def main() -> None:
    parser = argparse.ArgumentParser(description="SynapseGrip API server")
    parser.add_argument("--host", default="0.0.0.0",
                        help="Bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=7005,
                        help="Bind port (default: 7005)")
    parser.add_argument("--no-reload", dest="reload",
                        action="store_false", default=True)
    args = parser.parse_args()

    uvicorn.run(
        "server.main:app",   # <-- module path, not file path
        host=args.host,
        port=args.port,
        reload=args.reload,
        reload_dirs=[str(ROOT / "server")] if args.reload else None,
    )


if __name__ == "__main__":
    main()
