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
        self.worlds: dict[str, Simulation] = {
            "homestead": Simulation(seed, biome="homestead"),
            "market": Simulation(seed + 100, biome="market"),
        }
        self.active_world_id = "homestead"
        self.default_timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
        self.brains: dict[str, Brain] = {
            "aiden": brain or Brain(timeout=self.default_timeout),
        }
        self.clients: set[asyncio.Queue] = set()
        self.thinking_tasks: dict[str, asyncio.Task] = {}
        self.loop_task: asyncio.Task | None = None
        self.next_think_ticks: dict[str, int] = {"aiden": 0}

    @property
    def sim(self) -> Simulation:
        return self.worlds[self.active_world_id]

    @sim.setter
    def sim(self, s: Simulation) -> None:
        self.active_world_id = s.biome
        self.worlds[self.active_world_id] = s

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
        coins = self.sim.coins
        biome = self.active_world_id
        self.worlds[biome] = Simulation(seed, biome=biome, coins=coins)
        self.brains = {"aiden": primary_brain}
        self.next_think_ticks = {"aiden": 0}
        self.sync_status()
        self.publish(self.sim.world_init())

    async def switch_world(self, target_world: str) -> dict:
        if target_world not in {"homestead", "market"}:
            raise ValueError("world must be 'homestead' or 'market'")
        if target_world == self.active_world_id:
            return self.sim.snapshot()
        if target_world == "market" and not self.worlds["homestead"].gate_unlocked:
            raise PermissionError("Decipher the 3 runes and build the 7-block Sky Teleport Gate on Homestead first.")
        await self.cancel_thinking()
        src = self.sim
        dst = self.worlds[target_world]
        # Carry player purse, shared party inventory, tools, and needs across worlds
        dst.coins = src.coins
        dst.primary.inventory = dict(src.primary.inventory)
        dst.primary.needs = dict(src.primary.needs)
        dst.primary.household.tools = dict(src.primary.household.tools)
        for aid in dst.agents:
            if aid not in self.brains:
                self.brains[aid] = Brain(timeout=self.default_timeout)
        self.active_world_id = target_world
        self.next_think_ticks = {aid: dst.tick for aid in dst.agents}
        self.sync_status()
        self.publish(self.sim.world_init())
        return self.sim.snapshot()

    def export_save(self, name: str | None = None) -> dict:
        from datetime import datetime, timezone
        from .save_store import SAVE_FORMAT

        data = self.sim.export_save()
        data["format"] = SAVE_FORMAT
        data["name"] = (name or f"Day {self.sim.day} ({self.sim.clock_str})").strip()[:64]
        data["saved_at"] = datetime.now(timezone.utc).isoformat()
        data["brains"] = {
            agent_id: brain.config.public()
            for agent_id, brain in self.brains.items()
        }
        return data

    async def load_save(self, data: dict) -> dict:
        await self.cancel_thinking()
        old_brains = dict(self.brains)
        new_sim = Simulation.from_save(data)
        self.sim = new_sim
        saved_brains = data.get("brains") if isinstance(data.get("brains"), dict) else {}
        new_brains: dict[str, Brain] = {}
        new_ticks: dict[str, int] = {}
        for agent_id in self.sim.agents:
            brain = Brain()
            saved_cfg = saved_brains.get(agent_id)
            if isinstance(saved_cfg, dict):
                patch = {
                    k: saved_cfg[k]
                    for k in ("provider", "model", "base_url", "temperature", "decision_interval_ticks", "enabled")
                    if k in saved_cfg and saved_cfg[k] is not None
                }
                prev = old_brains.get(agent_id)
                if prev and prev.config.api_key and patch.get("provider") == prev.config.provider:
                    patch["api_key"] = prev.config.api_key
                try:
                    brain.configure(patch)
                except Exception:
                    pass
            new_brains[agent_id] = brain
            new_ticks[agent_id] = self.sim.tick
        self.brains = new_brains
        self.next_think_ticks = new_ticks
        self.sync_status()
        self.publish(self.sim.world_init())
        return self.sim.snapshot()

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

    @app.get("/api/sim/save")
    def download_save():
        from fastapi.responses import JSONResponse
        rt = runtime()
        payload = rt.export_save()
        filename = f"land66-day{rt.sim.day}-tick{rt.sim.tick}.json"
        return JSONResponse(
            content=payload,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.post("/api/sim/load")
    async def upload_save(payload: dict):
        rt = runtime()
        try:
            snapshot = await rt.load_save(payload)
        except ValueError as err:
            raise HTTPException(400, str(err))
        return {"ok": True, "state": snapshot}

    @app.get("/api/sim/saves")
    def list_saves():
        from .save_store import list_save_slots
        return {"saves": list_save_slots()}

    @app.post("/api/sim/saves")
    def create_save_slot(req: dict):
        from .save_store import SaveSlotRequest, write_save_slot
        from pydantic import ValidationError
        rt = runtime()
        try:
            validated = SaveSlotRequest(**req)
            payload = rt.export_save(validated.name)
            summary = write_save_slot(validated.name, payload)
        except ValidationError as err:
            raise HTTPException(422, str(err))
        except ValueError as err:
            raise HTTPException(422, str(err))
        return {"ok": True, "save": summary}

    @app.post("/api/sim/saves/{slot}/load")
    async def load_named_save(slot: str):
        from .save_store import read_save_slot
        rt = runtime()
        try:
            data = read_save_slot(slot)
            snapshot = await rt.load_save(data)
        except FileNotFoundError as err:
            raise HTTPException(404, str(err))
        except ValueError as err:
            raise HTTPException(400, str(err))
        return {"ok": True, "slot": slot, "state": snapshot}

    @app.delete("/api/sim/saves/{slot}")
    def remove_named_save(slot: str):
        from .save_store import delete_save_slot
        try:
            removed = delete_save_slot(slot)
        except FileNotFoundError as err:
            raise HTTPException(404, str(err))
        except ValueError as err:
            raise HTTPException(422, str(err))
        return {"ok": True, "slot": removed}

    @app.post("/api/world/switch")
    async def switch_world(req: dict):
        rt = runtime()
        target = str(req.get("world", "")).strip().lower()
        try:
            snap = await rt.switch_world(target)
        except PermissionError as err:
            raise HTTPException(403, str(err))
        except ValueError as err:
            raise HTTPException(422, str(err))
        return {"ok": True, "world": target, "state": snap}

    @app.post("/api/gate/decipher")
    def gate_decipher(req: dict):
        rt = runtime()
        home_sim = rt.worlds["homestead"]
        rune = str(req.get("rune", "")).strip()
        answer = str(req.get("answer", "")).strip()
        try:
            correct, feedback = home_sim.decipher_gate_rune(rune, answer)
        except ValueError as err:
            raise HTTPException(422, str(err))
        if rt.active_world_id == "homestead":
            rt.broadcast_tick()
        return {"ok": True, "correct": correct, "feedback": feedback, "gate": home_sim.gate_snapshot(), "state": rt.sim.snapshot()}

    @app.post("/api/gate/study")
    def gate_study(req: dict | None = None):
        rt = runtime()
        if rt.active_world_id != "homestead":
            raise HTTPException(422, "Travel to Homestead Island to study the ruined gate plinth.")
        agent_id = (req or {}).get("agent_id")
        ag = rt.sim._resolve_agent(agent_id)
        if rt.sim.gate_discovered:
            return {"ok": True, "message": "All 3 Teleport Gate runes are already deciphered!", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}
        started = ag.start_action("study_gate")
        if not started:
            raise HTTPException(422, f"{ag.name} could not find a clear path to the Teleport Gate plinth.")
        rt.broadcast_tick()
        return {"ok": True, "message": f"{ag.name} is walking over to study the Ancient Gate ruins.", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}

    @app.post("/api/gate/build")
    def gate_build(req: dict | None = None):
        rt = runtime()
        if rt.active_world_id != "homestead":
            raise HTTPException(422, "Switch to Homestead Island to assemble the Teleport Gate.")
        body = req or {}
        mode = str(body.get("mode", "place")).strip().lower()
        agent_id = body.get("agent_id")
        try:
            if mode == "npc":
                ag = rt.sim._resolve_agent(agent_id)
                if not rt.sim.gate_discovered:
                    if ag.start_action("study_gate"):
                        rt.broadcast_tick()
                        return {"ok": True, "message": f"{ag.name} is studying the Gate runes.", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}
                nxt = rt.sim.next_gate_block()
                if not nxt:
                    return {"ok": True, "message": "Teleport Gate is already complete!", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}
                if ag.inventory.get(nxt.material, 0) >= nxt.amount and ag.start_action("build_gate"):
                    rt.broadcast_tick()
                    return {"ok": True, "message": f"{ag.name} is assembling {nxt.surface_material.replace('_', ' ')} onto the gate.", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}
                if nxt.material == "sunstone":
                    if ag.inventory.get("crystal", 0) >= 1 and ag.inventory.get("gold_ore", 0) >= 1 and ag.start_action("craft", {"recipe": "sunstone"}):
                        rt.broadcast_tick()
                        return {"ok": True, "message": f"{ag.name} is forging a Sunstone core from Crystal + Gold Ore.", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}
                    target_res = "gold_ore" if ag.inventory.get("gold_ore", 0) < 1 else "crystal"
                    if ag.start_action("gather", {"resource": target_res}):
                        rt.broadcast_tick()
                        return {"ok": True, "message": f"{ag.name} is gathering {target_res.replace('_', ' ')} to craft Sunstone.", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}
                if ag.start_action("gather", {"resource": nxt.material}):
                    rt.broadcast_tick()
                    return {"ok": True, "message": f"{ag.name} is gathering {nxt.material.replace('_', ' ')} for the Gate.", "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}
                raise ValueError(f"{ag.name} cannot reach more {nxt.material.replace('_', ' ')} nodes right now.")
            placed = rt.sim.assemble_gate_block(agent_id)
        except ValueError as err:
            raise HTTPException(422, str(err))
        rt.broadcast_tick()
        msg = "Sky Teleport Gate activated! Travel to Sky Market is unlocked." if rt.sim.gate_unlocked else f"Added {placed.surface_material.replace('_', ' ')} to the Teleport Gate."
        return {"ok": True, "message": msg, "gate": rt.sim.gate_snapshot(), "state": rt.sim.snapshot()}

    @app.post("/api/npc/action")
    def dispatch_npc_action(req: dict):
        rt = runtime()
        action = str(req.get("action", "")).strip()
        params = req.get("params") if isinstance(req.get("params"), dict) else {}
        agent_id = req.get("agent_id")
        ag = rt.sim._resolve_agent(agent_id)
        if not action:
            raise HTTPException(422, "action is required")
        ok = ag.start_action(action, params)
        if not ok:
            raise HTTPException(422, f"{ag.name} cannot start '{action}' right now (missing materials, weapon, or reachable target).")
        rt.broadcast_tick()
        return {"ok": True, "action": action, "agent_id": ag.id, "state": rt.sim.snapshot()}

    @app.get("/api/market/catalog")
    def get_market_catalog():
        from .market import market_catalog_payload
        rt = runtime()
        return market_catalog_payload(rt.sim, rt.active_world_id)

    @app.post("/api/market/buy")
    def market_buy(req: dict):
        from .market import execute_buy
        rt = runtime()
        item_id = str(req.get("item_id", "")).strip()
        qty = req.get("quantity", 1)
        agent_id = req.get("agent_id")
        if type(qty) is not int:
            raise HTTPException(422, "quantity must be an integer")
        try:
            msg, info = execute_buy(rt.sim, item_id, qty, agent_id)
        except ValueError as err:
            raise HTTPException(422, str(err))
        rt.broadcast_tick()
        return {"ok": True, "message": msg, **info, "state": rt.sim.snapshot()}

    @app.post("/api/market/sell")
    def market_sell(req: dict):
        from .market import execute_sell
        rt = runtime()
        item = str(req.get("item", "")).strip()
        qty = req.get("quantity", 1)
        agent_id = req.get("agent_id")
        if type(qty) is not int:
            raise HTTPException(422, "quantity must be an integer")
        try:
            msg, info = execute_sell(rt.sim, item, qty, agent_id)
        except ValueError as err:
            raise HTTPException(422, str(err))
        rt.broadcast_tick()
        return {"ok": True, "message": msg, **info, "state": rt.sim.snapshot()}

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


app = create_app()
