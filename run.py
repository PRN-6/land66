"""Universal launcher for land66: runs both FastAPI backend (:8000) and Vite frontend (:5173)."""
from __future__ import annotations

import argparse
import os
import queue
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"


def find_backend_python() -> Path:
    candidates = [
        BACKEND_DIR / ".venv" / "Scripts" / "python.exe",
        BACKEND_DIR / ".venv" / "bin" / "python",
        Path(sys.executable),
    ]
    for cand in candidates:
        if cand.exists():
            return cand
    return Path(sys.executable)


def find_npm() -> str:
    if sys.platform == "win32":
        return shutil.which("npm.cmd") or shutil.which("npm") or "npm.cmd"
    return shutil.which("npm") or "npm"


def is_port_in_use(port: int) -> bool:
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.3)
                if sock.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def ensure_setup(py_exe: Path, npm_exe: str) -> None:
    env_file = BACKEND_DIR / ".env"
    env_example = BACKEND_DIR / ".env.example"
    if not env_file.exists() and env_example.exists():
        env_file.write_text(env_example.read_text(encoding="utf-8"), encoding="utf-8")
        print("[setup] Created backend/.env from .env.example")

    if not (FRONTEND_DIR / "node_modules").exists():
        print("[setup] Installing frontend dependencies (npm install)...")
        subprocess.run([npm_exe, "install"], cwd=FRONTEND_DIR, check=True)


def run_checks(py_exe: Path, npm_exe: str) -> int:
    print("[check] Running backend pytest suite...")
    res_py = subprocess.run([str(py_exe), "-m", "pytest", "tests", "-v"], cwd=BACKEND_DIR)
    if res_py.returncode != 0:
        return res_py.returncode

    print("[check] Running frontend TypeScript check & production build...")
    res_ts = subprocess.run([npm_exe, "run", "build"], cwd=FRONTEND_DIR)
    return res_ts.returncode


def terminate_tree(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass


def stream_output(name: str, pipe, out_q: queue.Queue[tuple[str, str]]) -> None:
    try:
        for line in iter(pipe.readline, ""):
            out_q.put((name, line.rstrip("\r\n")))
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def wait_http_ready(url: str, timeout: float = 12.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.6) as resp:
                if resp.status < 500:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.2)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Run land66 backend & frontend together with one command.")
    parser.add_argument("--backend-port", type=int, default=8000, help="FastAPI/WebSocket port (default: 8000)")
    parser.add_argument("--frontend-port", type=int, default=5173, help="Vite dev server port (default: 5173)")
    parser.add_argument("--reload", action="store_true", help="Enable Uvicorn --reload for backend development")
    parser.add_argument("--open", action="store_true", help="Open the browser automatically once ready")
    parser.add_argument("--test", action="store_true", help="Run all backend tests + frontend typecheck/build")
    args = parser.parse_args()

    py_exe = find_backend_python()
    npm_exe = find_npm()
    ensure_setup(py_exe, npm_exe)

    if args.test:
        return run_checks(py_exe, npm_exe)

    if is_port_in_use(args.backend_port):
        print(f"[error] Backend port {args.backend_port} is already in use. Stop the existing process or pass --backend-port.")
        return 1
    if is_port_in_use(args.frontend_port):
        print(f"[error] Frontend port {args.frontend_port} is already in use. Stop the existing process or pass --frontend-port.")
        return 1

    backend_cmd = [
        str(py_exe),
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        str(args.backend_port),
    ]
    if args.reload:
        backend_cmd.append("--reload")

    frontend_env = os.environ.copy()
    frontend_env["VITE_API_URL"] = f"http://localhost:{args.backend_port}"
    frontend_env["VITE_WS_URL"] = f"ws://localhost:{args.backend_port}/ws"
    frontend_cmd = [npm_exe, "run", "dev", "--", "--host", "0.0.0.0", "--port", str(args.frontend_port)]

    popen_kwargs: dict = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "bufsize": 1,
    }
    if sys.platform != "win32":
        popen_kwargs["start_new_session"] = True
    else:
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

    print(f"[land66] Starting backend on http://localhost:{args.backend_port} and frontend on http://localhost:{args.frontend_port} ...")
    backend_proc = subprocess.Popen(backend_cmd, cwd=BACKEND_DIR, **popen_kwargs)
    frontend_proc = subprocess.Popen(frontend_cmd, cwd=FRONTEND_DIR, env=frontend_env, **popen_kwargs)

    log_q: queue.Queue[tuple[str, str]] = queue.Queue()
    for label, proc in (("backend", backend_proc), ("frontend", frontend_proc)):
        t = threading.Thread(target=stream_output, args=(label, proc.stdout, log_q), daemon=True)
        t.start()

    opened = False
    try:
        def check_open() -> None:
            nonlocal opened
            if args.open and not opened:
                if wait_http_ready(f"http://localhost:{args.backend_port}/api/health", timeout=8.0) and wait_http_ready(
                    f"http://localhost:{args.frontend_port}", timeout=8.0
                ):
                    opened = True
                    webbrowser.open(f"http://localhost:{args.frontend_port}")

        threading.Thread(target=check_open, daemon=True).start()
        print(f"[land66] Open http://localhost:{args.frontend_port} in your browser (Ctrl+C to stop both servers).")

        while True:
            while True:
                try:
                    src, line = log_q.get_nowait()
                    print(f"[{src}] {line}", flush=True)
                except queue.Empty:
                    break

            b_code = backend_proc.poll()
            f_code = frontend_proc.poll()
            if b_code is not None or f_code is not None:
                while not log_q.empty():
                    src, line = log_q.get_nowait()
                    print(f"[{src}] {line}", flush=True)
                if b_code is not None:
                    print(f"[land66] Backend exited with code {b_code}; stopping frontend...")
                    return b_code or 1
                if f_code is not None:
                    print(f"[land66] Frontend exited with code {f_code}; stopping backend...")
                    return f_code or 1
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n[land66] Shutting down backend & frontend...")
        return 0
    finally:
        terminate_tree(frontend_proc)
        terminate_tree(backend_proc)
        print("[land66] Both servers stopped.")


if __name__ == "__main__":
    raise SystemExit(main())
