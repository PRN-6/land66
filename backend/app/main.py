"""Run from backend/: uvicorn app.main:app --host 0.0.0.0 --port 8000"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .brain import Brain
from .models import ConfigPatch, Control, CreateAgentRequest, CreateWorldRequest, Decision, Intervention, Provider
from .simulation import Simulation
from .world import VALID_BIOMES, WORLD_PRESETS

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
logger = logging.getLogger("land66")


class Runtime:
    def __init__(self, seed=66, brain: Brain | None = None, persist: bool = False):
        self.persist = persist
        self.worlds: dict[str, Simulation] = {
            "homestead": Simulation(seed, biome="homestead", world_id="homestead", world_name="Homestead"),
            "market": Simulation(seed + 100, biome="market", world_id="market", world_name="Market"),
        }
        self.active_world_id = "homestead"
        self.default_timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
        self.brains_by_world: dict[str, dict[str, Brain]] = {
            wid: {
                aid: (brain if wid == "homestead" and aid == sim.primary_id and brain else Brain(timeout=self.default_timeout))
                for aid in sim.agents
            }
            for wid, sim in self.worlds.items()
        }
        self.clients: set[asyncio.Queue] = set()
        self.thinking_tasks: dict[str, asyncio.Task] = {}
        self.loop_task: asyncio.Task | None = None
        self.next_ticks_by_world: dict[str, dict[str, int]] = {
            wid: {aid: 0 for aid in sim.agents}
            for wid, sim in self.worlds.items()
        }
        self.active_market_trip: dict | None = None
        self._last_autosave_tick = 0

    @property
    def sim(self) -> Simulation:
        return self.worlds[self.active_world_id]

    @sim.setter
    def sim(self, s: Simulation) -> None:
        self.active_world_id = s.world_id
        self.worlds[self.active_world_id] = s

    @property
    def brains(self) -> dict[str, Brain]:
        return self.brains_by_world.setdefault(self.active_world_id, {})

    @brains.setter
    def brains(self, mapping: dict[str, Brain]) -> None:
        self.brains_by_world[self.active_world_id] = mapping

    @property
    def next_think_ticks(self) -> dict[str, int]:
        return self.next_ticks_by_world.setdefault(self.active_world_id, {})

    @next_think_ticks.setter
    def next_think_ticks(self, mapping: dict[str, int]) -> None:
        self.next_ticks_by_world[self.active_world_id] = mapping

    @property
    def brain(self) -> Brain:
        pid = self.sim.primary_id
        return self.brains.setdefault(pid, Brain(timeout=self.default_timeout))

    @brain.setter
    def brain(self, b: Brain) -> None:
        self.brains[self.sim.primary_id] = b

    @property
    def thinking_task(self) -> asyncio.Task | None:
        return self.thinking_tasks.get(self.sim.primary_id)

    @thinking_task.setter
    def thinking_task(self, task: asyncio.Task | None) -> None:
        pid = self.sim.primary_id
        if task is None:
            self.thinking_tasks.pop(pid, None)
        else:
            self.thinking_tasks[pid] = task

    def get_brain(self, agent_id: str | None = None) -> Brain:
        aid = agent_id or self.sim.primary_id
        if aid not in self.sim.agents or aid not in self.brains:
            raise HTTPException(404, f"Unknown agent '{aid}'")
        return self.brains[aid]

    def sync_status(self):
        for aid in list(self.brains.keys()):
            if aid not in self.sim.agents:
                self.brains.pop(aid, None)
                self.next_think_ticks.pop(aid, None)
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
                locked=b.config.locked,
            )

    def worlds_summary(self) -> list[dict]:
        return [
            {
                "id": wid,
                "name": sim.world_name,
                "preset": sim.biome,
                "preset_label": WORLD_PRESETS.get(sim.biome, {}).get("label", sim.biome),
                "seed": sim.seed,
                "locked": False,
                "builtin": wid in {"homestead", "market"},
                "agents_count": len(sim.agents),
            }
            for wid, sim in self.worlds.items()
        ]

    def snapshot(self) -> dict:
        snap = self.sim.snapshot()
        snap["worlds"] = self.worlds_summary()
        return snap

    def world_init_payload(self) -> dict:
        payload = self.sim.world_init()
        payload["state"] = self.snapshot()
        return payload

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
        self.publish(dict(type="tick_update", block_updates=self.sim.world.drain_updates(), state=self.snapshot()))

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

    def export_runtime_bundle(self) -> dict:
        worlds_out: dict[str, dict] = {}
        for wid, sim in self.worlds.items():
            wdata = sim.export_save()
            if not sim.agents:
                wdata["allow_empty_agents"] = True
            worlds_out[wid] = wdata
        return {
            "format": "land66-runtime-autosave-v1",
            "active_world_id": self.active_world_id,
            "active_market_trip": dict(self.active_market_trip) if self.active_market_trip else None,
            "worlds": worlds_out,
            "brains_by_world": {
                wid: {aid: b.config.public() for aid, b in bmap.items()}
                for wid, bmap in self.brains_by_world.items()
            },
        }

    def load_runtime_bundle(self, bundle: dict) -> bool:
        raw_worlds = bundle.get("worlds")
        if not isinstance(raw_worlds, dict) or not raw_worlds:
            return False
        restored_worlds: dict[str, Simulation] = {}
        restored_brains: dict[str, dict[str, Brain]] = {}
        restored_ticks: dict[str, dict[str, int]] = {}
        raw_brains = bundle.get("brains_by_world") if isinstance(bundle.get("brains_by_world"), dict) else {}

        for wid, wdata in raw_worlds.items():
            if not isinstance(wdata, dict):
                continue
            try:
                r_sim = Simulation.from_save(wdata)
            except Exception:
                continue
            restored_worlds[wid] = r_sim
            saved_wbrains = raw_brains.get(wid) if isinstance(raw_brains.get(wid), dict) else {}
            wbrains: dict[str, Brain] = {}
            wticks: dict[str, int] = {}
            for aid in r_sim.agents:
                b = Brain(timeout=self.default_timeout)
                cfg = saved_wbrains.get(aid)
                if isinstance(cfg, dict):
                    patch = {
                        k: cfg[k]
                        for k in ("provider", "model", "base_url", "temperature", "decision_interval_ticks", "enabled", "locked")
                        if k in cfg and cfg[k] is not None
                    }
                    try:
                        b.configure(patch)
                    except Exception:
                        pass
                wbrains[aid] = b
                wticks[aid] = r_sim.tick
            restored_brains[wid] = wbrains
            restored_ticks[wid] = wticks

        if "homestead" not in restored_worlds:
            return False
        self.worlds = restored_worlds
        self.brains_by_world = restored_brains
        self.next_ticks_by_world = restored_ticks
        raw_trip = bundle.get("active_market_trip")
        self.active_market_trip = dict(raw_trip) if isinstance(raw_trip, dict) else None
        raw_active = str(bundle.get("active_world_id", "homestead"))
        self.active_world_id = raw_active if raw_active in self.worlds else "homestead"
        self.sync_status()
        self._last_autosave_tick = self.sim.tick
        return True

    def save_autosave(self) -> None:
        if not self.persist:
            return
        try:
            from .save_store import write_runtime_autosave
            write_runtime_autosave(self.export_runtime_bundle())
            self._last_autosave_tick = self.sim.tick
        except Exception:
            logger.exception("Failed to write runtime autosave")

    def restore_autosave(self) -> bool:
        if not self.persist:
            return False
        try:
            from .save_store import read_runtime_autosave
            data = read_runtime_autosave()
            if data and self.load_runtime_bundle(data):
                return True
        except Exception:
            logger.exception("Failed to restore runtime autosave; starting fresh")
        return False

    async def reset(self, seed):
        await self.cancel_thinking()
        old_pid = self.sim.primary_id
        old_brains = dict(self.brains)
        primary_brain = old_brains.get(old_pid) or Brain(timeout=self.default_timeout)
        coins = self.sim.coins
        biome = self.sim.biome
        wid = self.sim.world_id
        wname = self.sim.world_name
        new_sim = Simulation(seed, biome=biome, coins=coins, world_id=wid, world_name=wname)
        self.worlds[wid] = new_sim
        new_pid = new_sim.primary_id
        self.brains = {
            aid: (old_brains.get(aid) or (primary_brain if aid == new_pid else Brain(timeout=self.default_timeout)))
            for aid in new_sim.agents
        }
        self.next_think_ticks = {aid: 0 for aid in new_sim.agents}
        if self.active_market_trip and wid in {"homestead", "market"}:
            self.active_market_trip = None
        self.sync_status()
        self.save_autosave()
        self.publish(self.world_init_payload())

    async def create_world(
        self,
        name: str | None = None,
        preset: str = "homestead",
        seed: int | None = None,
        starter_name: str | None = None,
        starter_role: str = "pioneer",
        switch: bool = True,
    ) -> tuple[dict, dict]:
        clean_preset = preset.strip().lower()
        if clean_preset not in VALID_BIOMES:
            raise ValueError(f"Unknown world preset '{preset}'. Valid presets: {', '.join(sorted(VALID_BIOMES))}")
        if len(self.worlds) >= 12:
            raise ValueError("Maximum 12 floating worlds reached; delete a custom world before creating another.")

        clean_name = (name or "").strip()[:40]
        if not clean_name:
            base_label = WORLD_PRESETS[clean_preset]["label"]
            clean_name = f"{base_label} {len(self.worlds) + 1}"
        base_slug = re.sub(r"[^a-z0-9]+", "-", clean_name.lower()).strip("-") or f"world-{len(self.worlds) + 1}"
        world_id = base_slug
        suffix = 2
        while world_id in self.worlds:
            world_id = f"{base_slug[:28]}-{suffix}"
            suffix += 1

        chosen_seed = int(seed) if seed is not None else self.sim.seed + 137 * len(self.worlds)
        new_sim = Simulation(
            seed=chosen_seed,
            biome=clean_preset,
            coins=self.sim.coins,
            world_id=world_id,
            world_name=clean_name,
        )
        pid = new_sim.primary_id
        s_name = (starter_name or "").strip()[:32]
        if s_name:
            new_sim.primary.name = s_name
        new_sim.primary.role = starter_role

        self.worlds[world_id] = new_sim
        self.brains_by_world[world_id] = {pid: Brain(timeout=self.default_timeout)}
        self.next_ticks_by_world[world_id] = {pid: 0}

        if switch:
            await self.cancel_thinking()
            self.active_world_id = world_id
            self.sync_status()
            self.publish(self.world_init_payload())
        else:
            self.broadcast_tick()

        summary = next(w for w in self.worlds_summary() if w["id"] == world_id)
        self.save_autosave()
        return summary, self.snapshot()

    async def delete_world(self, world_id: str) -> dict:
        wid = world_id.strip().lower()
        if wid in {"homestead", "market"}:
            raise ValueError(f"Cannot delete built-in world '{wid}'")
        if wid not in self.worlds:
            raise KeyError(f"Unknown world '{world_id}'")
        was_active = self.active_world_id == wid
        if was_active:
            await self.cancel_thinking()
            self.active_world_id = "homestead"
        self.worlds.pop(wid, None)
        self.brains_by_world.pop(wid, None)
        self.next_ticks_by_world.pop(wid, None)
        self.sync_status()
        if was_active:
            self.publish(self.world_init_payload())
        else:
            self.broadcast_tick()
        self.save_autosave()
        return self.snapshot()

    async def switch_world(self, target_world: str) -> dict:
        if target_world not in self.worlds:
            raise ValueError(f"Unknown world '{target_world}'")
        if target_world == self.active_world_id:
            return self.snapshot()
        await self.cancel_thinking()
        src = self.sim
        dst = self.worlds[target_world]
        # Each world has independent AI inhabitants with their own mind, needs & bags; share realm coin purse only.
        dst.coins = src.coins
        self.active_world_id = target_world
        dst_brains = self.brains_by_world.setdefault(target_world, {})
        for aid in dst.agents:
            if aid not in dst_brains:
                dst_brains[aid] = Brain(timeout=self.default_timeout)
        self.next_think_ticks = {aid: dst.tick for aid in dst.agents}
        self.sync_status()
        self.save_autosave()
        self.publish(self.world_init_payload())
        return self.snapshot()

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
                    for k in ("provider", "model", "base_url", "temperature", "decision_interval_ticks", "enabled", "locked")
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
        self.save_autosave()
        self.publish(self.world_init_payload())
        return self.snapshot()

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
                valid = agent.can_start(decision.action, decision.params)
                if valid:
                    if (
                        not agent.threatened_by
                        and not agent.hostile_target
                        and agent.current_action not in {"attack", "sleep", "drink", "eat"}
                        and agent.apply_decision(decision)
                    ):
                        agent.queued_decision = None
                    else:
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

    async def step_weekly_market_trip(self, step_dt: float = 0.1) -> None:
        """Send Homestead NPC to Market every 7th day, sell surplus crops/products, and return home."""
        from .market import execute_sell, sellable_surplus_for_market

        home_sim = self.worlds.get("homestead")
        market_sim = self.worlds.get("market")
        if not home_sim or not market_sim:
            return

        # 1. Start weekly Day-7 trip if due
        if (
            self.active_market_trip is None
            and home_sim.day >= 7
            and home_sim.day % 7 == 0
            and home_sim.day > home_sim.last_market_day
        ):
            traveler_id = "aiden" if "aiden" in home_sim.agents else (home_sim.primary_id if home_sim.agents else None)
            if traveler_id and traveler_id in home_sim.agents:
                if self.active_world_id == "homestead":
                    await self.cancel_thinking(traveler_id)
                home_sim.last_market_day = home_sim.day
                traveler = home_sim.agents.pop(traveler_id)
                home_pos = list(traveler.grid_pos)
                traveler_brain = self.brains_by_world.setdefault("homestead", {}).pop(traveler_id, None) or Brain(
                    timeout=self.default_timeout
                )
                self.next_ticks_by_world.setdefault("homestead", {}).pop(traveler_id, None)

                traveler.sim = market_sim
                traveler.job = None
                traveler.target = None
                traveler.path = []
                traveler.hostile_target = None
                traveler.threatened_by = None
                spawn_spot = market_sim._find_open_spot((16, 11, 22)) or (16, 11, 22)
                traveler.grid_pos = spawn_spot
                traveler.position = [float(spawn_spot[0]), float(spawn_spot[1]), float(spawn_spot[2])]
                traveler.current_action = "walk"
                traveler.animation = "walking"
                traveler.current_goal = f"Day {home_sim.day} Sky Market: sell crops & goods"
                traveler.thought = f"Day {home_sim.day}! Traveled to Sky Market to sell my surplus crops and products."
                traveler.remember(f"Day {home_sim.day}: Arrived at Sky Market to trade crops and products.")
                market_sim.agents[traveler_id] = traveler
                self.brains_by_world.setdefault("market", {})[traveler_id] = traveler_brain
                self.next_ticks_by_world.setdefault("market", {})[traveler_id] = market_sim.tick
                market_sim.coins = home_sim.coins

                self.active_market_trip = {
                    "agent_id": traveler_id,
                    "home_world": "homestead",
                    "home_pos": home_pos,
                    "day": home_sim.day,
                    "next_trade_elapsed": market_sim.elapsed + 1.0,
                    "return_at_elapsed": market_sim.elapsed + 10.0,
                    "sold": {},
                    "earned": 0,
                }
                self.sync_status()
                self.save_autosave()
                return

        # 2. Progress ongoing Market trip even when God is viewing Homestead
        trip = self.active_market_trip
        if not trip:
            return

        aid = str(trip.get("agent_id", "aiden"))
        agent = market_sim.agents.get(aid)
        if not agent:
            self.active_market_trip = None
            return

        if self.active_world_id != "market":
            market_sim.step(step_dt, force=True)

        surplus = sellable_surplus_for_market(home_sim, agent)
        if market_sim.elapsed >= float(trip.get("next_trade_elapsed", 0.0)) and surplus:
            item, qty, _price = surplus[0]
            try:
                _msg, info = execute_sell(market_sim, item, qty, agent_id=aid)
                earned = int(info.get("earned", 0))
                sold_map = trip.setdefault("sold", {})
                sold_map[item] = int(sold_map.get(item, 0)) + qty
                trip["earned"] = int(trip.get("earned", 0)) + earned
                for wsim in self.worlds.values():
                    wsim.coins = market_sim.coins
                merchant = next(
                    (m for mid, m in market_sim.agents.items() if mid != aid),
                    None,
                )
                if merchant is not None:
                    merchant.thought = f"Bought {qty}x {item.replace('_', ' ')} from {agent.name} for {earned} coins!"
            except ValueError:
                pass
            trip["next_trade_elapsed"] = market_sim.elapsed + 1.2

        # 3. Return home once surplus is sold and visit window finished
        if not sellable_surplus_for_market(home_sim, agent) and market_sim.elapsed >= float(
            trip.get("return_at_elapsed", 0.0)
        ):
            if self.active_world_id == "market":
                await self.cancel_thinking(aid)
            market_sim.agents.pop(aid, None)
            ret_brain = self.brains_by_world.setdefault("market", {}).pop(aid, None) or Brain(
                timeout=self.default_timeout
            )
            self.next_ticks_by_world.setdefault("market", {}).pop(aid, None)

            agent.sim = home_sim
            agent.job = None
            agent.target = None
            agent.path = []
            raw_home = trip.get("home_pos") or [16, 11, 20]
            pref = (int(raw_home[0]), int(raw_home[1]), int(raw_home[2]))
            land_spot = home_sim._find_open_spot(pref) or (16, 11, 20)
            agent.grid_pos = land_spot
            agent.position = [float(land_spot[0]), float(land_spot[1]), float(land_spot[2])]
            agent.current_action = "idle"
            agent.animation = "idle"
            earned_total = int(trip.get("earned", 0))
            sold_summary = ", ".join(f"{q}x {k.replace('_', ' ')}" for k, q in (trip.get("sold") or {}).items())
            if earned_total > 0:
                summary_msg = f"Returned from Day {trip['day']} Sky Market: sold {sold_summary} for {earned_total} coins!"
            else:
                summary_msg = f"Returned home from visiting friends at Sky Market on Day {trip['day']}."
            agent.current_goal = "Build, farm, and prepare for next weekly Market"
            agent.thought = summary_msg
            agent.remember(summary_msg)
            agent.write_journal(summary_msg)

            home_sim.agents[aid] = agent
            home_sim._away_stub = None
            self.brains_by_world.setdefault("homestead", {})[aid] = ret_brain
            self.next_ticks_by_world.setdefault("homestead", {})[aid] = home_sim.tick
            self.active_market_trip = None
            self.sync_status()
            self.save_autosave()

    async def run(self):
        while True:
            started = time.monotonic()
            try:
                self.complete_thinking()
                if not self.sim.paused:
                    for _ in range(self.sim.speed):
                        self.sim.step(.1)
                        await self.step_weekly_market_trip(.1)
                    for aid, agent in list(self.sim.agents.items()):
                        b = self.brains.get(aid)
                        if not b:
                            continue
                        next_tick = self.next_think_ticks.get(aid, 0)
                        interval = b.config.decision_interval_ticks
                        min_cooldown_tick = next_tick - max(0, interval - 10)
                        ready_after_job = (
                            b.configured()
                            and not b.fallback_active
                            and agent.job is None
                            and agent.queued_decision is None
                            and self.sim.tick >= min_cooldown_tick
                        )
                        if aid not in self.thinking_tasks and (self.sim.tick >= next_tick or ready_after_job):
                            snap = self.sim.snapshot_for_agent(aid)
                            self.thinking_tasks[aid] = asyncio.create_task(b.decide(snap, agent_id=aid))
                            self.next_think_ticks[aid] = self.sim.tick + interval
                    self.broadcast_tick()
                    if self.persist and self.sim.tick - self._last_autosave_tick >= 25:
                        self.save_autosave()
            except Exception:
                logger.exception("Simulation tick failed; pausing for inspection")
                self.sim.paused = True
                self.sim.llm_status["last_error"] = "Simulation paused after an internal error; see server logs."
                self.publish(dict(type="tick_update", block_updates=self.sim.world.drain_updates(), state=self.snapshot()))
            await asyncio.sleep(max(.001, .1 - (time.monotonic() - started)))

    async def close(self):
        if self.loop_task:
            self.loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.loop_task
        await self.cancel_thinking()
        self.save_autosave()


def create_app(seed: int | None = None, brain: Brain | None = None, persist: bool | None = None) -> FastAPI:
    no_persist = "PYTEST_CURRENT_TEST" in os.environ or os.getenv("LAND66_NO_PERSIST", "").lower() in {"1", "true", "yes"}
    use_persist = (not no_persist) if persist is None else bool(persist)

    @asynccontextmanager
    async def lifespan(app):
        runtime = Runtime(seed if seed is not None else int(os.getenv("LAND66_SEED", "66")), brain, persist=use_persist)
        runtime.restore_autosave()
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
        return runtime().snapshot()

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
        rt.save_autosave()
        rt.broadcast_tick()
        return {**agent.snapshot(), "llm_config": new_brain.config.public()}

    @app.delete("/api/agents/{agent_id}")
    async def delete_agent(agent_id: str):
        rt = runtime()
        if agent_id == rt.sim.primary_id:
            raise HTTPException(422, f"Cannot remove primary NPC {rt.sim.primary.name}")
        if agent_id not in rt.sim.agents:
            raise HTTPException(404, "Agent not found")
        await rt.cancel_thinking(agent_id)
        rt.sim.remove_agent(agent_id)
        rt.brains.pop(agent_id, None)
        rt.next_think_ticks.pop(agent_id, None)
        rt.save_autosave()
        rt.broadcast_tick()
        return {"ok": True, "removed": agent_id}

    def _is_fixed_brain(brain: Brain) -> bool:
        """Return True when an NPC's AI assignment should be protected from bulk overrides."""
        return bool(brain.config.locked or (brain.config.provider != "fallback" and brain.config.enabled))

    @app.get("/api/llm/config")
    async def config(agent_id: str | None = Query(default=None)):
        return runtime().get_brain(agent_id).config.public()

    @app.post("/api/llm/config")
    async def configure(patch: ConfigPatch, agent_id: str | None = Query(default=None)):
        rt = runtime()
        aid = agent_id or rt.sim.primary_id
        b = rt.get_brain(aid)
        data = patch.model_dump(exclude_none=True)
        if b.config.locked and patch.locked is not False:
            protected_changes = [
                field
                for field in ("provider", "model", "base_url", "enabled")
                if field in data and data[field] != getattr(b.config, field)
            ]
            if protected_changes:
                agent = rt.sim.agents.get(aid)
                who = agent.name if agent else aid
                fixed_label = b.config.model or b.config.provider
                raise HTTPException(
                    409,
                    f"{who} is fixed to {b.config.provider} ({fixed_label}). Unlock it first to change.",
                )
        try:
            b.configure(data)
        except (ValueError, ValidationError):
            raise HTTPException(422, "Invalid LLM configuration; check provider, URL and numeric ranges")
        await rt.cancel_thinking(aid)
        b.fallback_active = not b.configured()
        b.last_error = None
        rt.next_think_ticks[aid] = rt.sim.tick
        rt.save_autosave()
        rt.broadcast_tick()
        return b.config.public()

    @app.post("/api/llm/apply_all")
    async def configure_all(patch: ConfigPatch):
        rt = runtime()
        data = patch.model_dump(exclude_none=True)
        try:
            Brain(timeout=rt.default_timeout).configure(data)
        except (ValueError, ValidationError):
            raise HTTPException(422, "Invalid LLM configuration; check provider, URL and numeric ranges")
        updated = 0
        skipped: list[str] = []
        for aid, b in list(rt.brains.items()):
            if _is_fixed_brain(b):
                agent = rt.sim.agents.get(aid)
                skipped.append(agent.name if agent else aid)
                continue
            b.configure(data)
            await rt.cancel_thinking(aid)
            b.fallback_active = not b.configured()
            b.last_error = None
            rt.next_think_ticks[aid] = rt.sim.tick
            updated += 1
        rt.save_autosave()
        rt.broadcast_tick()
        return {"ok": True, "count": updated, "skipped": skipped}

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
            await rt.step_weekly_market_trip(.1)
        elif command.action == "set_speed":
            if command.speed is None:
                raise HTTPException(422, "set_speed requires speed: 1, 2 or 5")
            rt.sim.speed = command.speed
        elif command.action == "reset":
            await rt.reset(command.seed if command.seed is not None else rt.sim.seed)
            return rt.snapshot()
        rt.save_autosave()
        rt.broadcast_tick()
        return rt.snapshot()

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

    @app.get("/api/worlds")
    def list_worlds():
        rt = runtime()
        return {
            "active_world": rt.active_world_id,
            "worlds": rt.worlds_summary(),
            "presets": [{"id": pid, **meta} for pid, meta in WORLD_PRESETS.items()],
        }

    @app.post("/api/world/create")
    async def create_world(req: CreateWorldRequest):
        rt = runtime()
        try:
            summary, snap = await rt.create_world(
                name=req.name,
                preset=req.preset,
                seed=req.seed,
                starter_name=req.starter_name,
                starter_role=req.starter_role,
                switch=req.switch,
            )
        except ValueError as err:
            raise HTTPException(422, str(err))
        return {"ok": True, "world": summary, "state": snap, "worlds": rt.worlds_summary()}

    @app.delete("/api/world/{world_id}")
    async def remove_world(world_id: str):
        rt = runtime()
        try:
            snap = await rt.delete_world(world_id)
        except KeyError as err:
            raise HTTPException(404, str(err))
        except ValueError as err:
            raise HTTPException(422, str(err))
        return {"ok": True, "deleted": world_id, "state": snap, "worlds": rt.worlds_summary()}

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
        return {"ok": True, "correct": correct, "feedback": feedback, "gate": home_sim.gate_snapshot(), "state": rt.snapshot()}

    @app.post("/api/gate/study")
    def gate_study(req: dict | None = None):
        rt = runtime()
        if rt.active_world_id != "homestead":
            raise HTTPException(422, "Travel to Homestead Island to study the ruined gate plinth.")
        agent_id = (req or {}).get("agent_id")
        ag = rt.sim._resolve_agent(agent_id)
        if rt.sim.gate_discovered:
            return {"ok": True, "message": "All 3 Teleport Gate runes are already deciphered!", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}
        started = ag.start_action("study_gate")
        if not started:
            raise HTTPException(422, f"{ag.name} could not find a clear path to the Teleport Gate plinth.")
        rt.broadcast_tick()
        return {"ok": True, "message": f"{ag.name} is walking over to study the Ancient Gate ruins.", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}

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
                        return {"ok": True, "message": f"{ag.name} is studying the Gate runes.", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}
                nxt = rt.sim.next_gate_block()
                if not nxt:
                    return {"ok": True, "message": "Teleport Gate is already complete!", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}
                if ag.inventory.get(nxt.material, 0) >= nxt.amount and ag.start_action("build_gate"):
                    rt.broadcast_tick()
                    return {"ok": True, "message": f"{ag.name} is assembling {nxt.surface_material.replace('_', ' ')} onto the gate.", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}
                if nxt.material == "sunstone":
                    if ag.inventory.get("crystal", 0) >= 1 and ag.inventory.get("gold_ore", 0) >= 1 and ag.start_action("craft", {"recipe": "sunstone"}):
                        rt.broadcast_tick()
                        return {"ok": True, "message": f"{ag.name} is forging a Sunstone core from Crystal + Gold Ore.", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}
                    target_res = "gold_ore" if ag.inventory.get("gold_ore", 0) < 1 else "crystal"
                    if ag.start_action("gather", {"resource": target_res}):
                        rt.broadcast_tick()
                        return {"ok": True, "message": f"{ag.name} is gathering {target_res.replace('_', ' ')} to craft Sunstone.", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}
                if ag.start_action("gather", {"resource": nxt.material}):
                    rt.broadcast_tick()
                    return {"ok": True, "message": f"{ag.name} is gathering {nxt.material.replace('_', ' ')} for the Gate.", "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}
                raise ValueError(f"{ag.name} cannot reach more {nxt.material.replace('_', ' ')} nodes right now.")
            placed = rt.sim.assemble_gate_block(agent_id)
        except ValueError as err:
            raise HTTPException(422, str(err))
        rt.broadcast_tick()
        msg = "Sky Teleport Gate activated! Travel to Sky Market is unlocked." if rt.sim.gate_unlocked else f"Added {placed.surface_material.replace('_', ' ')} to the Teleport Gate."
        return {"ok": True, "message": msg, "gate": rt.sim.gate_snapshot(), "state": rt.snapshot()}

    @app.post("/api/npc/action")
    def dispatch_npc_action(req: dict):
        rt = runtime()
        action = str(req.get("action", "")).strip()
        params = req.get("params") if isinstance(req.get("params"), dict) else {}
        agent_id = req.get("agent_id")
        ag = rt.sim._resolve_agent(agent_id)
        if not action:
            raise HTTPException(422, "action is required")
        if action == "attack":
            target_id = str(params.get("target_id", "")).strip()
            target_name = str(params.get("target_name", "")).strip().lower()
            tgt = (
                rt.sim.agents.get(target_id)
                if target_id in rt.sim.agents
                else next((a for a in rt.sim.agents.values() if a.id != ag.id and target_name and target_name in a.name.lower()), None)
            )
            if tgt and tgt.id != ag.id:
                ag.hostile_target = tgt.id
        elif action == "idle":
            ag.hostile_target = None
            ag.threatened_by = None
        ok = ag.start_action(action, params)
        if not ok:
            raise HTTPException(422, f"{ag.name} cannot start '{action}' right now (missing materials, weapon, or reachable target).")
        rt.broadcast_tick()
        return {"ok": True, "action": action, "agent_id": ag.id, "state": rt.snapshot()}

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
        return {"ok": True, "message": msg, **info, "state": rt.snapshot()}

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
        return {"ok": True, "message": msg, **info, "state": rt.snapshot()}

    @app.post("/api/god/intervene")
    async def intervene(command: Intervention):
        rt = runtime()
        if command.action == "create_world":
            val = command.value if isinstance(command.value, dict) else {}
            try:
                _, snap = await rt.create_world(
                    name=val.get("name"),
                    preset=str(val.get("preset", val.get("biome", "homestead"))),
                    seed=val.get("seed"),
                    starter_name=val.get("starter_name"),
                    starter_role=str(val.get("starter_role", "pioneer")),
                    switch=bool(val.get("switch", True)),
                )
            except (ValueError, TypeError) as exc:
                raise HTTPException(422, str(exc) or "Invalid world creation parameters")
            return snap
        try:
            rt.sim.intervene(command.action, command.value, agent_id=command.agent_id)
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, str(exc) or "Invalid intervention value or unavailable target")
        rt.save_autosave()
        rt.broadcast_tick()
        return rt.snapshot()

    @app.websocket("/ws")
    async def websocket(ws: WebSocket):
        await ws.accept()
        rt = runtime()
        queue = asyncio.Queue(maxsize=64)
        rt.sync_status()
        queue.put_nowait(rt.world_init_payload())
        rt.clients.add(queue)

        async def send(tg: anyio.abc.TaskGroup):
            try:
                while True:
                    message = await queue.get()
                    if message is None:
                        await ws.close(code=1013, reason="Client fell behind; reconnect for a full world snapshot")
                        return
                    with anyio.fail_after(5):
                        await ws.send_json(message)
            except (WebSocketDisconnect, RuntimeError, TimeoutError):
                pass
            finally:
                tg.cancel_scope.cancel()

        async def receive(tg: anyio.abc.TaskGroup):
            try:
                while True:
                    await ws.receive_text()
            except (WebSocketDisconnect, RuntimeError):
                pass
            finally:
                tg.cancel_scope.cancel()

        try:
            async with anyio.create_task_group() as tg:
                tg.start_soon(send, tg)
                tg.start_soon(receive, tg)
        finally:
            rt.clients.discard(queue)

    return app


app = create_app()
