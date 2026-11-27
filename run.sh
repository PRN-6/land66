#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ -x "$ROOT/backend/.venv/bin/python" ]; then
  exec "$ROOT/backend/.venv/bin/python" "$ROOT/run.py" "$@"
elif [ -x "$ROOT/backend/.venv/Scripts/python.exe" ]; then
  exec "$ROOT/backend/.venv/Scripts/python.exe" "$ROOT/run.py" "$@"
elif command -v python3 >/dev/null 2>&1; then
  exec python3 "$ROOT/run.py" "$@"
else
  exec python "$ROOT/run.py" "$@"
fi
