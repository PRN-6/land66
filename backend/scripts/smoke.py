"""Bounded real Uvicorn HTTP + WebSocket smoke check; always reaps its child server."""
from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from websockets.sync.client import connect


def main():
    root = Path(__file__).resolve().parents[1]
    # Check the requested port without connecting to or terminating another developer's server.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 8000))
    log_path = root / "smoke-server.log"
    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
                                cwd=root, stdout=log, stderr=subprocess.STDOUT,
                                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        try:
            with httpx.Client(base_url="http://127.0.0.1:8000", timeout=1, trust_env=False) as client:
                deadline = time.monotonic()+15
                while True:
                    if proc.poll() is not None:
                        raise RuntimeError(f"Uvicorn exited early; see {log_path}")
                    try:
                        response = client.get("/api/health")
                        response.raise_for_status()
                        assert response.json() == {"ok": True}
                        break
                    except httpx.TransportError:
                        if time.monotonic() > deadline:
                            raise TimeoutError(f"Uvicorn did not start; see {log_path}")
                        time.sleep(.1)
                with connect("ws://127.0.0.1:8000/ws", open_timeout=3, close_timeout=2, proxy=None) as ws:
                    init = json.loads(ws.recv(timeout=3))
                    assert init['type'] == 'world_init' and len(init['blocks']) == 24576
                    for _ in range(20):
                        update = json.loads(ws.recv(timeout=3))
                        if update['type'] == 'tick_update':
                            break
                    else:
                        raise AssertionError("No tick_update received")
                    assert update['state']['tick'] >= init['state']['tick']
                assert client.post('/api/sim/control',json={'action':'pause'}).json()['paused']
                tick = client.get('/api/state').json()['tick']
                assert client.post('/api/sim/control',json={'action':'step'}).json()['tick'] == tick+1
            print("PASS: Uvicorn startup, /api/health, /api/state, WebSocket world_init/tick_update, pause and step.")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            print(f"Stopped smoke server (PID {proc.pid}).")


if __name__ == '__main__':
    main()
