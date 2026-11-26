"""Run from backend/: uvicorn app.main:app --host 0.0.0.0 --port 8000"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .brain import Brain
from .models import ConfigPatch, Control, Intervention, Decision
from .simulation import Simulation

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
logger = logging.getLogger("land66")


class Runtime:
    def __init__(self, seed=66, brain: Brain | None = None):
        self.sim = Simulation(seed)
        self.brain = brain or Brain(timeout=float(os.getenv("LLM_TIMEOUT_SECONDS", "12")))
        self.clients: set[asyncio.Queue] = set()
        self.thinking_task: asyncio.Task | None = None
        self.loop_task: asyncio.Task | None = None
        self.next_think_tick = 0

    def sync_status(self):
        b = self.brain
        self.sim.llm_status.update(provider=b.config.provider, model=b.config.model,
                                   thinking=self.thinking_task is not None and not self.thinking_task.done(),
                                   last_latency_ms=b.last_latency_ms, calls_count=b.calls_count,
                                   fallback_active=b.fallback_active, last_error=b.last_error)

    def publish(self, message):
        # Per-client writers isolate the simulation from slow/disconnected browsers.
        # Overflow forces reconnect + a full snapshot; never silently lose block deltas.
        for queue in list(self.clients):
            if queue.full():
                self.clients.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)
            else:
                queue.put_nowait(message)

    def broadcast_tick(self):
        self.sync_status()
        self.publish(dict(type="tick_update", block_updates=self.sim.world.drain_updates(), state=self.sim.snapshot()))

    async def cancel_thinking(self):
        if self.thinking_task:
            self.thinking_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.thinking_task
            self.thinking_task = None
        self.sim.queued_decision = None
        self.sync_status()

    async def reset(self, seed):
        await self.cancel_thinking()
        self.sim = Simulation(seed)
        self.next_think_tick = 0
        self.sync_status()
        self.publish(self.sim.world_init())

    def complete_thinking(self):
        if not self.thinking_task or not self.thinking_task.done():
            return
        decision, trace = self.thinking_task.result()
        self.thinking_task = None
        if decision is not None:
            # start_action only stages a job; restore it to validate without interrupting movement.
            s = self.sim
            saved = (s.job, s.current_action, s.target, s.path, s.progress, s.animation)
            try:
                valid = s.start_action(decision.action, decision.params)
            finally:
                s.job, s.current_action, s.target, s.path, s.progress, s.animation = saved
            if valid:
                s.queued_decision = decision
            else:
                trace["used_fallback"] = True
                trace["error"] = "Decision is not executable in the current world/inventory."
                self.brain.last_error = trace["error"]
                self.brain.fallback_active = True
        if trace["used_fallback"]:
            trace["parsed_decision"] = Decision(thought=self.sim.thought, goal=self.sim.current_goal,
                                                 action=self.sim.current_action, params={}).model_dump()
        self.sync_status()
        self.publish(dict(type="llm_trace", trace=trace))

    async def run(self):
        while True:
            started = time.monotonic()
            try:
                self.complete_thinking()
                if not self.sim.paused:
                    # Speed increases fixed substeps, not wall-time broadcast frequency.
                    for _ in range(self.sim.speed):
                        self.sim.step(.1)
                    if self.thinking_task is None and self.sim.tick >= self.next_think_tick:
                        self.thinking_task = asyncio.create_task(self.brain.decide(self.sim.snapshot()))
                        self.next_think_tick = self.sim.tick + self.brain.config.decision_interval_ticks
                    self.broadcast_tick()
            except Exception:
                logger.exception("Simulation tick failed; pausing for inspection")
                self.sim.paused = True
                self.sim.llm_status["last_error"] = "Simulation paused after an internal error; see server logs."
                self.publish(dict(type="tick_update", block_updates=self.sim.world.drain_updates(), state=self.sim.snapshot()))
            await asyncio.sleep(max(.001, .1 - (time.monotonic()-started)))

    async def close(self):
        if self.loop_task:
            self.loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.loop_task
        await self.cancel_thinking()


def create_app(seed: int | None = None, brain: Brain | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        runtime = Runtime(seed if seed is not None else int(os.getenv("LAND66_SEED", "66")), brain)
        app.state.runtime = runtime
        runtime.loop_task = asyncio.create_task(runtime.run())
        try:
            yield
        finally:
            await runtime.close()

    app = FastAPI(title="land66 backend", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                       allow_methods=["*"], allow_headers=["*"])

    def runtime() -> Runtime:
        return app.state.runtime

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    @app.get("/api/state")
    async def state():
        runtime().sync_status()
        return runtime().sim.snapshot()

    @app.get("/api/llm/config")
    async def config():
        return runtime().brain.config.public()

    @app.post("/api/llm/config")
    async def configure(patch: ConfigPatch):
        rt = runtime()
        try:
            rt.brain.configure(patch.model_dump(exclude_none=True))
        except (ValueError, ValidationError):
            # Never reflect a validation payload that might contain an API key.
            raise HTTPException(422, "Invalid LLM configuration; check provider, URL and numeric ranges")
        await rt.cancel_thinking()
        rt.brain.fallback_active = not rt.brain.configured()
        rt.brain.last_error = None
        rt.next_think_tick = rt.sim.tick
        rt.broadcast_tick()
        return rt.brain.config.public()

    @app.post("/api/llm/test")
    async def test_llm():
        return await runtime().brain.test()

    @app.get("/api/llm/models")
    async def models():
        return await runtime().brain.models()

    @app.get("/api/llm/traces")
    async def traces(limit: int = Query(default=30, ge=1, le=100)):
        return list(reversed(runtime().brain.traces[-limit:]))

    @app.post("/api/sim/control")
    async def control(command: Control):
        rt = runtime()
        if command.action == "pause":
            rt.sim.paused = True
        elif command.action == "resume":
            rt.sim.paused = False
        elif command.action == "step":
            rt.sim.paused = True
            rt.sim.step(.1, force=True)
        elif command.action == "set_speed":
            if command.speed is None:
                raise HTTPException(422, "set_speed requires speed: 1, 2 or 5")
            rt.sim.speed = command.speed
        elif command.action == "reset":
            await rt.reset(command.seed if command.seed is not None else rt.sim.seed)
            return rt.sim.snapshot()
        rt.broadcast_tick()
        return rt.sim.snapshot()

    @app.post("/api/god/intervene")
    async def intervene(command: Intervention):
        rt = runtime()
        try:
            rt.sim.intervene(command.action, command.value)
        except (ValueError, TypeError):
            raise HTTPException(422, "Invalid intervention value or unavailable target")
        rt.broadcast_tick()
        return rt.sim.snapshot()

    @app.websocket("/ws")
    async def websocket(ws: WebSocket):
        await ws.accept()
        rt = runtime()
        queue = asyncio.Queue(maxsize=64)
        # Snapshot and subscription are atomic before the first await of socket I/O.
        rt.sync_status()
        queue.put_nowait(rt.sim.world_init())
        rt.clients.add(queue)

        async def send():
            while True:
                message = await queue.get()
                if message is None:
                    await ws.close(code=1013, reason="Client fell behind; reconnect for a full world snapshot")
                    return
                await asyncio.wait_for(ws.send_json(message), timeout=5)

        async def receive():
            while True:
                await ws.receive_text()

        sender, receiver = asyncio.create_task(send()), asyncio.create_task(receive())
        try:
            done, _ = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except (WebSocketDisconnect, RuntimeError, TimeoutError):
            pass
        finally:
            rt.clients.discard(queue)
            for task in (sender, receiver):
                task.cancel()
            await asyncio.gather(sender, receiver, return_exceptions=True)

    return app


app = create_app()
