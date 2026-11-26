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
from fastapi import Body, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .brain import Brain
from .models import ConfigPatch, Control, CreateAgentRequest, Decision, Intervention, Provider
from .simulation import Simulation

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
logger = logging.getLogger("land66")


class Runtime:
    def __init__(self, seed=66, brain: Brain | None = None):
        self.sim = Simulation(seed)
        self.default_timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
        self.brains: dict[str, Brain] = {
            "aiden": brain or Brain(timeout=self.default_timeout),
        }
        self.clients: set[asyncio.Queue] = set()
        self.thinking_tasks: dict[str, asyncio.Task] = {}
        self.loop_task: asyncio.Task | None = None
        self.next_think_ticks: dict[str, int] = {"aiden": 0}

    @property
    def brain(self) -> Brain:
        return self.brains["aiden"]

    @brain.setter
    def brain(self, b: Brain) -> None:
        self.brains["aiden"] = b

    @property
    def thinking_task(self) -> asyncio.Task | None:
        return self.thinking_tasks.get("aiden")

    @thinking_task.setter
    def thinking_task(self, task: asyncio.Task | None) -> None:
        if task is None:
            self.thinking_tasks.pop("aiden", None)
        else:
            self.thinking_tasks["aiden"] = task

    def get_brain(self, agent_id: str | None = None) -> Brain:
        aid = agent_id or "aiden"
        if aid not in self.sim.agents or aid not in self.brains:
            raise HTTPException(404, f"Unknown agent '{aid}'")
        return self.brains[aid]

    def sync_status(self):
        for aid, agent in self.sim.agents.items():
            b = self.brains.get(aid)
            if not b:
                continue
            task = self.thinking_tasks.get(aid)
            agent.llm_status.update(
                provider=b.config.provider,
                model=b.config.model,
                thinking=task is not None and not task.done(),
                last_latency_ms=b.last_latency_ms,
                calls_count=b.calls_count,
                fallback_active=b.fallback_active,
                last_error=b.last_error,
            )

    def publish(self, message):
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

    async def cancel_thinking(self, agent_id: str | None = None):
        targets = [agent_id] if agent_id else list(self.thinking_tasks.keys())
        for aid in targets:
            task = self.thinking_tasks.pop(aid, None)
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            if aid in self.sim.agents:
                self.sim.agents[aid].queued_decision = None
        self.sync_status()

    async def reset(self, seed):
        await self.cancel_thinking()
        primary_brain = self.brains["aiden"]
        self.sim = Simulation(seed)
        self.brains = {"aiden": primary_brain}
        self.next_think_ticks = {"aiden": 0}
        self.sync_status()
        self.publish(self.sim.world_init())

    def complete_thinking(self):
        for aid, task in list(self.thinking_tasks.items()):
            if not task.done():
                continue
            del self.thinking_tasks[aid]
            agent = self.sim.agents.get(aid)
            b = self.brains.get(aid)
            if not agent or not b:
                continue
            decision, trace = task.result()
            if decision is not None:
                saved = (agent.job, agent.current_action, agent.target, agent.path, agent.progress, agent.animation)
                try:
                    valid = agent.start_action(decision.action, decision.params)
                finally:
                    agent.job, agent.current_action, agent.target, agent.path, agent.progress, agent.animation = saved
                if valid:
                    agent.queued_decision = decision
                else:
                    trace["used_fallback"] = True
                    trace["error"] = "Decision is not executable in the current world/inventory."
                    b.last_error = trace["error"]
                    b.fallback_active = True
            if trace["used_fallback"]:
                trace["parsed_decision"] = Decision(
                    thought=agent.thought,
                    goal=agent.current_goal,
                    action=agent.current_action,
                    params={},
                ).model_dump()
            trace.setdefault("agent_id", aid)
            trace.setdefault("agent_name", agent.name)
            self.sync_status()
            self.publish(dict(type="llm_trace", trace=trace))

    async def run(self):
        while True:
            started = time.monotonic()
            try:
                self.complete_thinking()
                if not self.sim.paused:
                    for _ in range(self.sim.speed):
                        self.sim.step(.1)
                    for aid, agent in list(self.sim.agents.items()):
                        b = self.brains.get(aid)
                        if not b:
                            continue
                        next_tick = self.next_think_ticks.get(aid, 0)
                        if aid not in self.thinking_tasks and self.sim.tick >= next_tick:
                            snap = self.sim.snapshot_for_agent(aid)
                            self.thinking_tasks[aid] = asyncio.create_task(b.decide(snap, agent_id=aid))
                            self.next_think_ticks[aid] = self.sim.tick + b.config.decision_interval_ticks
                    self.broadcast_tick()
            except Exception:
                logger.exception("Simulation tick failed; pausing for inspection")
                self.sim.paused = True
                self.sim.llm_status["last_error"] = "Simulation paused after an internal error; see server logs."
                self.publish(dict(type="tick_update", block_updates=self.sim.world.drain_updates(), state=self.sim.snapshot()))
            await asyncio.sleep(max(.001, .1 - (time.monotonic() - started)))

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

    app = FastAPI(title="land66 backend", version="1.1.0", lifespan=lifespan)
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

    @app.get("/api/agents")
    async def list_agents():
        rt = runtime()
        rt.sync_status()
        return [
            {
                **agent.snapshot(),
                "llm_config": rt.brains[aid].config.public() if aid in rt.brains else None,
            }
            for aid, agent in rt.sim.agents.items()
        ]

    @app.post("/api/agents")
    async def create_agent(req: CreateAgentRequest):
        rt = runtime()
        pos = (req.x, req.y, req.z) if req.x is not None and req.y is not None and req.z is not None else None
        if pos is None and req.x is not None and req.z is not None:
            pos = rt.sim.world.feet_at(req.x, req.z)
        try:
            agent = rt.sim.add_agent(name=req.name, role=req.role, pos=pos)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        new_brain = Brain(timeout=rt.default_timeout)
        if req.llm_config is not None:
            try:
                new_brain.configure(req.llm_config.model_dump(exclude_none=True))
                new_brain.fallback_active = not new_brain.configured()
            except (ValueError, ValidationError):
                rt.sim.agents.pop(agent.id, None)
                raise HTTPException(422, "Invalid initial llm_config for agent")
        rt.brains[agent.id] = new_brain
        rt.next_think_ticks[agent.id] = rt.sim.tick
        rt.broadcast_tick()
        return {**agent.snapshot(), "llm_config": new_brain.config.public()}

    @app.delete("/api/agents/{agent_id}")
    async def delete_agent(agent_id: str):
        rt = runtime()
        if agent_id == "aiden":
            raise HTTPException(422, "Cannot remove primary NPC Aiden")
        if agent_id not in rt.sim.agents:
            raise HTTPException(404, "Agent not found")
        await rt.cancel_thinking(agent_id)
        rt.sim.remove_agent(agent_id)
        rt.brains.pop(agent_id, None)
        rt.next_think_ticks.pop(agent_id, None)
        rt.broadcast_tick()
        return {"ok": True, "removed": agent_id}

    @app.get("/api/llm/config")
    async def config(agent_id: str | None = Query(default=None)):
        return runtime().get_brain(agent_id).config.public()

    @app.post("/api/llm/config")
    async def configure(patch: ConfigPatch, agent_id: str | None = Query(default=None)):
        rt = runtime()
        aid = agent_id or "aiden"
        b = rt.get_brain(aid)
        try:
            b.configure(patch.model_dump(exclude_none=True))
        except (ValueError, ValidationError):
            raise HTTPException(422, "Invalid LLM configuration; check provider, URL and numeric ranges")
        await rt.cancel_thinking(aid)
        b.fallback_active = not b.configured()
        b.last_error = None
        rt.next_think_ticks[aid] = rt.sim.tick
        rt.broadcast_tick()
        return b.config.public()

    @app.post("/api/llm/apply_all")
    async def configure_all(patch: ConfigPatch):
        rt = runtime()
        data = patch.model_dump(exclude_none=True)
        for aid, b in list(rt.brains.items()):
            try:
                b.configure(data)
            except (ValueError, ValidationError):
                raise HTTPException(422, "Invalid LLM configuration; check provider, URL and numeric ranges")
            await rt.cancel_thinking(aid)
            b.fallback_active = not b.configured()
            b.last_error = None
            rt.next_think_ticks[aid] = rt.sim.tick
        rt.broadcast_tick()
        return {"ok": True, "count": len(rt.brains)}

    @app.post("/api/llm/test")
    async def test_llm(patch: ConfigPatch | None = Body(default=None), agent_id: str | None = Query(default=None)):
        return await runtime().get_brain(agent_id).test(patch.model_dump(exclude_none=True) if patch else None)

    @app.get("/api/llm/models")
    async def models(
        provider: Provider | None = Query(default=None),
        base_url: str | None = Query(default=None),
        agent_id: str | None = Query(default=None),
    ):
        try:
            return await runtime().get_brain(agent_id).models(provider=provider, base_url=base_url)
        except (ValueError, ValidationError):
            raise HTTPException(422, "Invalid provider or base_url")

    @app.get("/api/llm/detect")
    async def detect_local_llms():
        return await runtime().brain.detect_local()

    @app.get("/api/llm/traces")
    async def traces(limit: int = Query(default=30, ge=1, le=100), agent_id: str | None = Query(default=None)):
        rt = runtime()
        if agent_id:
            return list(reversed(rt.get_brain(agent_id).traces[-limit:]))
        combined = [tr for b in rt.brains.values() for tr in b.traces]
        combined.sort(key=lambda t: t.get("timestamp", ""))
        return list(reversed(combined[-limit:]))

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
            rt.sim.intervene(command.action, command.value, agent_id=command.agent_id)
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, str(exc) or "Invalid intervention value or unavailable target")
        rt.broadcast_tick()
        return rt.sim.snapshot()

    @app.websocket("/ws")
    async def websocket(ws: WebSocket):
        await ws.accept()
        rt = runtime()
        queue = asyncio.Queue(maxsize=64)
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
