"""Headless fixed-step human simulation, independent of the HTTP/event loop."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from .models import Decision
from .pathfinding import astar, path_to_any
from .world import (
    World, Pos, PALETTE, AIR, GRASS, DIRT, STONE, WATER, LOG, LEAVES,
    PLANK, COBBLE, GLASS, DOOR, OPEN_DOOR, BED, CHEST, BENCH, TORCH,
    FARMLAND, WHEAT, BERRY, SAPLING, ROOF,
)

INVENTORY_KEYS = ("wood_log", "wood_plank", "stone", "seeds", "wheat", "berries", "sapling", "bread")
DAY_SECONDS = 360.0
DURATIONS = {"idle": 2, "explore": .3, "walk": .1, "forage": 2, "drink": 2.5,
             "eat": 2, "sleep": 20, "chop": 4, "mine": 2.5, "craft": 2,
             "build": .8, "till": 1.5, "plant": 1, "water": 1.5,
             "harvest": 2, "plant_sapling": 1.5, "journal": 4}
ANIMATION = {"chop": "chopping", "mine": "mining", "build": "building", "till": "tilling",
             "plant": "planting", "plant_sapling": "planting", "water": "watering",
             "harvest": "harvesting", "forage": "harvesting", "eat": "eating",
             "drink": "drinking", "sleep": "sleeping", "craft": "building", "journal": "thinking"}


def xyz(p) -> dict:
    return dict(zip(("x", "y", "z"), p))


def distance(a, b) -> float:
    return math.dist(a, b)


@dataclass(frozen=True)
class BlueprintBlock:
    pos: Pos
    block: int
    stage: str
    material: str
    amount: int = 1


def house_blueprint() -> list[BlueprintBlock]:
    blocks = []
    for x in range(12, 19):
        for z in range(12, 19):
            blocks.append(BlueprintBlock((x, 10, z), COBBLE, "foundation", "stone"))
    for y in range(11, 14):
        for x in range(12, 19):
            for z in range(12, 19):
                if x not in {12, 18} and z not in {12, 18}:
                    continue
                block = PLANK
                if x == 15 and z == 18 and y in {11, 12}:
                    block = DOOR
                elif y == 12 and ((x in {12, 18} and z in {14, 15, 16}) or (z == 12 and x in {14, 15, 16})):
                    block = GLASS
                blocks.append(BlueprintBlock((x, y, z), block, "walls", "stone" if block == GLASS else "wood_plank"))
    for x in range(12, 19):
        for z in range(12, 19):
            blocks.append(BlueprintBlock((x, 14, z), ROOF, "roof", "wood_plank"))
    for pos, block in [((13, 11, 13), BED), ((17, 11, 13), CHEST), ((17, 11, 16), BENCH), ((13, 12, 16), TORCH)]:
        blocks.append(BlueprintBlock(pos, block, "furnishing", "wood_plank", 2))
    return blocks


class Simulation:
    def __init__(self, seed: int = 66):
        self.seed, self.rng = seed, random.Random(seed + 731)
        self.world = World(seed)
        self.tick, self.elapsed = 0, DAY_SECONDS * .26
        self.paused, self.speed, self.weather = False, 1, "clear"
        self.weather_override = False
        self.position = [16.0, 11.0, 20.0]
        self.grid_pos: Pos = (16, 11, 20)
        self.yaw = 0.0
        self.needs = dict(hunger=82.0, energy=95.0, thirst=75.0, health=100.0, mood=78.0)
        self.inventory = dict.fromkeys(INVENTORY_KEYS, 0)
        self.animation, self.current_action = "idle", "idle"
        self.current_goal = "Explore and survive"
        self.thought = "An island in the sky. I can hear water; first I need food, then a home."
        self.path: list[Pos] = []
        self.target: Pos | None = None
        self.job: dict | None = None
        self.progress = 0.0
        self.memories: list[dict] = []
        self.journal: list[dict] = []
        self.blueprint = house_blueprint()
        self.farm_sites = [(x, 10, z) for x in (19, 20) for z in range(18, 22)]
        self.crop_age: dict[Pos, float] = {}
        self.wet_age: dict[Pos, float] = {}
        self.berry_regrowth: dict[Pos, float] = {}
        self.sapling_age: dict[Pos, float] = {}
        self.blocks_placed, self.blocks_broken = 0, 0
        self.explored = False
        self.last_journal_day = 0
        self.last_plant_time = -999.0
        self.last_weather_period = int(self.elapsed // 90)
        self.queued_decision: Decision | None = None
        self.llm_status = dict(provider="fallback", model="", thinking=False, last_latency_ms=0,
                               calls_count=0, fallback_active=True, last_error=None)
        self.remember("Woke on a floating island with empty pockets.")

    @property
    def day(self):
        return int(self.elapsed // DAY_SECONDS) + 1

    @property
    def time_of_day(self):
        return (self.elapsed % DAY_SECONDS) / DAY_SECONDS

    @property
    def phase(self):
        t = self.time_of_day
        return "night" if t < .22 or t >= .83 else "dawn" if t < .29 else "morning" if t < .5 else "afternoon" if t < .71 else "evening"

    @property
    def clock_str(self):
        minutes = int(self.time_of_day * 24 * 60)
        return f"{minutes // 60:02}:{minutes % 60:02}"

    def remember(self, text: str):
        self.memories.append(dict(day=self.day, tick=self.tick, text=text))
        self.memories[:] = self.memories[-18:]

    def write_journal(self, text: str | None = None):
        self.journal.append(dict(day=self.day, time=self.clock_str, text=text or
                                f"Day {self.day}: my house is {self.house_progress():.0f}% complete. "
                                f"I have {self.inventory['berries']} berries and {self.inventory['wheat']} wheat. "
                                f"{self.weather.title()} skies; tomorrow I will keep making this island home."))
        self.journal[:] = self.journal[-30:]
        self.last_journal_day = self.day

    def blueprint_matches(self, b: BlueprintBlock):
        value = self.world.get(*b.pos)
        return value == b.block or (b.block == DOOR and value == OPEN_DOOR)

    def next_build(self):
        return next((b for b in self.blueprint if not self.blueprint_matches(b)), None)

    def house_progress(self):
        return 100 * sum(self.blueprint_matches(b) for b in self.blueprint) / len(self.blueprint)

    def tree_bases(self):
        return [p for p in self.world.positions(LOG) if self.world.get(p[0], p[1] - 1, p[2]) != LOG]

    def shelter(self):
        x, y, z = self.grid_pos
        roof = any(self.world.get(x, yy, z) in {ROOF, PLANK, COBBLE} for yy in range(y + 2, min(y + 7, 24)))
        walls = all(any(self.world.get(x + dx * r, y + 1, z + dz * r) in {PLANK, GLASS, DOOR, OPEN_DOOR, COBBLE}
                        for r in range(1, 8)) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        near_bed = any(distance(self.grid_pos, p) <= 4 for p in self.world.positions(BED))
        return dict(roof_overhead=roof, enclosed_walls=walls, near_bed=near_bed, sheltered=roof and walls)

    def perception(self):
        shelter = self.shelter()
        groups = {"tree": self.tree_bases(), "water": self.world.positions(WATER),
                  "berries": self.world.positions(BERRY), "house_site": [(15, 11, 15)],
                  "farm_plot": self.world.positions(FARMLAND)}
        nearby = []
        for kind, points in groups.items():
            for p in sorted(points, key=lambda p: (distance(self.position, p), p))[:3]:
                nearby.append(dict(type=kind, position=xyz(p), distance=round(distance(self.position, p), 2)))
        visible = [f"{e['type']} {e['distance']:.0f} blocks away" for e in nearby if e['distance'] <= 12]
        location = ("inside my house" if shelter["sheltered"] else "beside the pond" if any(e['type'] == 'water' and e['distance'] < 4 for e in nearby)
                    else "in the forest" if any(e['type'] == 'tree' and e['distance'] < 4 for e in nearby) else "in the grassy clearing")
        nearest = {kind: min((e["distance"] for e in nearby if e["type"] == kind), default=None) for kind in groups}
        return dict(location_label=location, sheltered=shelter.pop("sheltered"),
                    visible_summary=", ".join(visible) or "Open sky and grassy ground.", nearby_entities=nearby,
                    nearest_distances=nearest, **shelter)

    def snapshot(self):
        next_block = self.next_build()
        crops = self.world.positions(WHEAT)
        return dict(tick=self.tick, day=self.day, time_of_day=self.time_of_day, clock_str=self.clock_str,
                    phase=self.phase, weather=self.weather, paused=self.paused, speed=self.speed, seed=self.seed,
                    npc=dict(name="Aiden", position=xyz([round(p, 4) for p in self.position]), grid_pos=xyz(self.grid_pos),
                             yaw=self.yaw, animation=self.animation, action_progress=round(self.progress, 4),
                             current_action=self.current_action, current_goal=self.current_goal, thought=self.thought,
                             needs={k: round(v, 3) for k, v in self.needs.items()}, inventory=dict(self.inventory),
                             target_block=xyz(self.target) if self.target else None, path=[xyz(p) for p in self.path],
                             perception=self.perception(), memories=list(self.memories), journal=list(self.journal)),
                    stats=dict(trees_count=len(self.tree_bases()), house_progress=round(self.house_progress(), 2),
                               house_stage=next_block.stage if next_block and self.house_progress() else "not_started" if next_block else "complete",
                               house_bounds={"min": xyz((12, 10, 12)), "max": xyz((18, 14, 18))},
                               farm_plots=len(self.world.locations[FARMLAND]),
                               crops_growing=sum(self.world.get_meta(*p) < 3 for p in crops),
                               crops_ripe=sum(self.world.get_meta(*p) == 3 for p in crops),
                               blocks_placed=self.blocks_placed, blocks_broken=self.blocks_broken),
                    llm_status=dict(self.llm_status))

    def world_init(self):
        return dict(type="world_init", dimensions=dict(width=32, height=24, depth=32),
                    index_formula="y * width * depth + z * width + x", blocks=list(self.world.blocks),
                    block_meta=list(self.world.meta), palette={str(k): v for k, v in PALETTE.items()}, state=self.snapshot())

    def approach(self, target: Pos, reach: int = 1, exact: bool = False, avoid_target: bool = False):
        if exact:
            return astar(self.world, self.grid_pos, target)
        goals = set()
        x, y, z = target
        for xx in range(x - reach, x + reach + 1):
            for zz in range(z - reach, z + reach + 1):
                if abs(xx - x) + abs(zz - z) > reach or (avoid_target and (xx, zz) == (x, z)):
                    continue
                for yy in range(max(1, y - 4), min(23, y + 3)):
                    if self.world.walkable((xx, yy, zz)):
                        goals.add((xx, yy, zz))
        return path_to_any(self.world, self.grid_pos, goals)

    def nearest_reachable(self, candidates, reach=1, avoid_target=False):
        for p in sorted(candidates, key=lambda p: (distance(self.position, p), p)):
            path = self.approach(p, reach, avoid_target=avoid_target)
            if path is not None:
                return p, path
        return None

    def make_job(self, action: str, target: Pos | None = None, path=None, **params):
        self.job = dict(action=action, duration=DURATIONS[action], elapsed=0.0, params=params)
        self.current_action = action
        self.target = target
        self.path = list(path or [])
        self.progress = 0
        self.animation = "walking" if self.path else ANIMATION.get(action, "idle")
        return True

    def start_action(self, action: str, params: dict | None = None) -> bool:
        params = params or {}
        inv, w = self.inventory, self.world
        candidates, reach, avoid = None, 1, False
        if action in {"walk", "explore"}:
            if action == "explore":
                target = w.feet_at(20, 19)
            else:
                values = [params.get(k) for k in ("x", "y", "z")]
                if not all(type(v) is int for v in values):
                    return False
                target = tuple(values)
            if target is None or not w.walkable(target):
                return False
            path = self.approach(target, exact=True)
            return path is not None and self.make_job(action, target, path)
        if action == "eat":
            food = "bread" if inv["bread"] else "berries"
            return inv[food] > 0 and self.make_job(action, food=food)
        if action == "craft":
            recipe = params.get("recipe", "planks")
            if recipe == "planks" and inv["wood_log"] > 0:
                return self.make_job(action, recipe=recipe)
            if recipe == "bread" and inv["wheat"] >= 3:
                return self.make_job(action, recipe=recipe)
            return False
        if action in {"idle", "journal"}:
            return self.make_job(action)
        if action == "sleep":
            candidates = w.positions(BED)
            if not candidates:
                return self.make_job(action, on_bed=False)
        elif action == "drink":
            candidates = w.positions(WATER)
        elif action == "forage":
            candidates = w.positions(BERRY)
        elif action == "chop":
            candidates = self.tree_bases()
        elif action == "mine":
            candidates = [p for p in w.positions(STONE) if p[1] >= 10
                          and p != (self.grid_pos[0], self.grid_pos[1] - 1, self.grid_pos[2])
                          and any(w.get(p[0]+dx, p[1], p[2]+dz) == AIR for dx, dz in ((1,0),(-1,0),(0,1),(0,-1))) ]
            avoid = True
        elif action == "build":
            b = self.next_build()
            if not b or inv[b.material] < b.amount:
                return False
            # Clear a tree if a god intervention placed one on the building site.
            if w.get(*b.pos) in {LOG, LEAVES}:
                return self.start_action("chop")
            result = self.nearest_reachable([b.pos], 3, avoid_target=True)
            if not result:
                return False
            return self.make_job(action, *result, blueprint=b)
        elif action == "till":
            candidates = [p for p in self.farm_sites if w.get(*p) in {GRASS, DIRT} and w.get(p[0], p[1]+1, p[2]) in {AIR, BERRY}]
        elif action == "plant":
            if not inv["seeds"]:
                return False
            candidates = [(x, y+1, z) for x,y,z in w.positions(FARMLAND) if w.get(x,y+1,z) == AIR]
        elif action == "water":
            candidates = [p for p in w.positions(FARMLAND) if w.get_meta(*p) == 0]
            # The permanent adjacent pond supplies water without an unmodeled item.
            if not w.locations[WATER]:
                return False
        elif action == "harvest":
            candidates = [p for p in w.positions(WHEAT) if w.get_meta(*p) == 3]
        elif action == "plant_sapling":
            if not inv["sapling"]:
                return False
            candidates = []
            for x in range(5, 28):
                for z in range(5, 28):
                    if 10 <= x <= 25 and 10 <= z <= 21:
                        continue
                    p = w.feet_at(x, z)
                    if (p and w.get(*p) == AIR and w.get(x,p[1]-1,z) == GRASS
                            and all(w.get(x,p[1]+dy,z) == AIR for dy in range(6))
                            and not any(abs(t[0]-x)<3 and abs(t[2]-z)<3 for t in self.tree_bases()+w.positions(SAPLING))):
                        candidates.append(p)
        if candidates is None:
            return False
        result = self.nearest_reachable(candidates, reach, avoid)
        if not result:
            return False
        return self.make_job(action, *result, on_bed=action == "sleep")

    def apply_decision(self, decision: Decision) -> bool:
        # Validation occurs at an action boundary, using the current world rather than stale prompt state.
        if not self.start_action(decision.action, decision.params):
            return False
        self.thought, self.current_goal = decision.thought, decision.goal
        if decision.journal_entry:
            self.write_journal(decision.journal_entry)
        return True

    def choose(self, action: str, thought: str, goal: str, **params) -> bool:
        if self.start_action(action, params):
            self.thought, self.current_goal = thought, goal
            return True
        return False

    def choose_fallback(self):
        n, inv = self.needs, self.inventory
        if n["thirst"] < 42 and self.choose("drink", "My mouth feels dry. The pond is fresh and close enough to reach.", "Stay hydrated"):
            return
        if n["hunger"] < 48:
            if inv["wheat"] >= 3 and not inv["bread"] and self.choose("craft", "This wheat will make a filling loaf.", "Prepare food", recipe="bread"):
                return
            if self.choose("eat", "I should stop and eat before I get weaker.", "Satisfy hunger"):
                return
            if self.choose("forage", "Those berries will keep me going while I establish a farm.", "Find food"):
                return
        if n["energy"] < 22 or (self.phase == "night" and self.house_progress() == 100):
            if self.choose("sleep", "Time to close my eyes. Tomorrow can wait.", "Sleep until rested"):
                return
        if self.phase == "evening" and self.last_journal_day != self.day:
            self.choose("journal", "The light is fading. I want to remember what I accomplished today.", "Reflect on the day")
            return
        if self.queued_decision:
            decision, self.queued_decision = self.queued_decision, None
            if self.apply_decision(decision):
                return
            self.remember("I reconsidered an idea that was no longer possible.")
        if not self.explored and self.choose("explore", "I will check the clearing and the pond before choosing where to settle.", "Explore the island"):
            return
        if inv["berries"] < 6 and self.choose("forage", "A few berries in my pocket will make building less precarious.", "Stock a little food"):
            return
        b = self.next_build()
        if b:
            if inv[b.material] < b.amount:
                if b.material == "wood_plank":
                    if inv["wood_log"] and self.choose("craft", "These logs can become sturdy planks for my home.", "Craft building materials", recipe="planks"):
                        return
                    if self.choose("chop", "One tree at a time; I will save saplings to replace what I take.", "Gather timber for my home"):
                        return
                elif self.choose("mine", "I need solid stone for the foundation and the little windows.", "Gather building stone"):
                    return
            if self.choose("build", f"The {b.stage} comes next. Each block makes this clearing feel more like home.", "Build one cozy home"):
                return
        else:
            if self.weather in {"rain", "storm"}:
                if not self.shelter()["sheltered"]:
                    if self.choose("walk", "Rain is soaking the clearing. I will wait inside my home.", "Take shelter", x=15, y=11, z=15):
                        return
                elif self.choose("idle", "The rain is watering my garden. I can enjoy the shelter I built.", "Rest indoors"):
                    return
            if self.choose("harvest", "The golden wheat is ready. I should gather it before starting something else.", "Harvest ripe wheat"):
                return
            if inv["wheat"] >= 3 and inv["bread"] < 5 and self.choose("craft", "Fresh bread will last longer than a handful of berries.", "Bake bread", recipe="bread"):
                return
            if self.choose("till", "The ground beside the pond should make a good garden.", "Prepare my farm"):
                return
            if self.choose("plant", "A seed now is a meal later. I will leave room to walk between the plants.", "Sow wheat"):
                return
            if self.choose("water", "The soil is dry. I can carry a little water from the adjacent pond.", "Water the farm"):
                return
            if not inv["seeds"] and not self.world.locations[WHEAT] and self.choose("chop", "I need a few seeds from the forest floor before I can sow.", "Find seeds"):
                return
            if self.elapsed - self.last_plant_time > 60 and self.choose("plant_sapling", "I took wood from this island; I want to give a tree back.", "Renew the forest"):
                return
            if inv["wood_log"] < 4 and self.choose("chop", "A small reserve of timber will help me maintain the house.", "Maintain supplies"):
                return
        self.choose("idle", "The island is quiet for a moment. I can watch the sky and catch my breath.", "Rest and observe")

    def change_block(self, p: Pos, block: int, meta: int = 0):
        old = self.world.get(*p)
        if self.world.set(*p, block, meta):
            if old != block:
                if old != AIR:
                    self.blocks_broken += 1
                if block != AIR:
                    self.blocks_placed += 1

    def finish_job(self):
        job, p, w, inv = self.job, self.target, self.world, self.inventory
        if job is None:
            return
        action, params = job["action"], job["params"]
        if action == "explore":
            self.explored = True
            self.remember("Found freshwater and a flat central clearing for one house.")
        elif action == "forage" and p and w.get(*p) == BERRY:
            self.change_block(p, AIR)
            inv["berries"] += 6
            inv["seeds"] += 1
            self.berry_regrowth[p] = 0
            self.remember("Gathered six wild berries and a seed.")
        elif action == "drink" and p and w.get(*p) == WATER:
            self.needs["thirst"] = min(100, self.needs["thirst"] + 65)
        elif action == "eat" and inv[params["food"]] > 0:
            inv[params["food"]] -= 1
            self.needs["hunger"] = min(100, self.needs["hunger"] + (38 if params["food"] == "bread" else 18))
            self.needs["mood"] = min(100, self.needs["mood"] + 2)
        elif action == "chop" and p and w.get(*p) == LOG:
            x,y,z = p
            logs = 0
            while w.get(x,y+logs,z) == LOG:
                self.change_block((x,y+logs,z), AIR)
                logs += 1
            # Leaves belong to this canopy only if another trunk does not support them.
            trunks = w.positions(LOG)
            for q in w.positions(LEAVES):
                if abs(q[0]-x)<=2 and abs(q[2]-z)<=2 and y<=q[1]<=y+5:
                    if not any(abs(t[0]-q[0])<=2 and abs(t[2]-q[2])<=2 and abs(t[1]-q[1])<=2 for t in trunks):
                        self.change_block(q, AIR)
            inv["wood_log"] += logs
            inv["sapling"] += 1
            inv["seeds"] += 2
            self.remember(f"Chopped a tree for {logs} logs; saved a sapling and seeds.")
        elif action == "mine" and p and w.get(*p) == STONE:
            # Never remove support under our current feet.
            if p != (self.grid_pos[0], self.grid_pos[1]-1, self.grid_pos[2]):
                self.change_block(p, AIR)
                inv["stone"] += 1
        elif action == "craft":
            if params["recipe"] == "planks" and inv["wood_log"]:
                inv["wood_log"] -= 1
                inv["wood_plank"] += 4
            elif params["recipe"] == "bread" and inv["wheat"] >= 3:
                inv["wheat"] -= 3
                inv["bread"] += 1
                self.remember("Baked a loaf from my own wheat.")
        elif action == "build":
            b = params["blueprint"]
            if not self.blueprint_matches(b) and inv[b.material] >= b.amount:
                inv[b.material] -= b.amount
                self.change_block(b.pos, b.block)
                if not self.next_build():
                    self.remember("My house is complete: a roof, a bed, and a place that is mine.")
        elif action == "till" and p and w.get(*p) in {GRASS, DIRT}:
            self.change_block((p[0],p[1]+1,p[2]), AIR)
            self.change_block(p, FARMLAND)
        elif action == "plant" and p and inv["seeds"] and w.get(*p) == AIR and w.get(p[0],p[1]-1,p[2]) == FARMLAND:
            inv["seeds"] -= 1
            self.change_block(p, WHEAT)
            self.crop_age[p] = 0
        elif action == "water" and p and w.get(*p) == FARMLAND:
            self.change_block(p, FARMLAND, 1)
            self.wet_age[p] = 0
        elif action == "harvest" and p and w.get(*p) == WHEAT and w.get_meta(*p) == 3:
            self.change_block(p, AIR)
            inv["wheat"] += 2
            inv["seeds"] += 2
            self.crop_age.pop(p, None)
            self.remember("Harvested ripe wheat and kept seeds for the next crop.")
        elif action == "plant_sapling" and p and inv["sapling"] and w.get(*p) == AIR:
            inv["sapling"] -= 1
            self.change_block(p, SAPLING)
            self.sapling_age[p] = 0
            self.last_plant_time = self.elapsed
            self.remember("Planted a young tree to renew the forest.")
        elif action == "journal":
            self.write_journal()
        self.job, self.target, self.path = None, None, []
        self.animation, self.current_action, self.progress = "idle", "idle", 0

    def update_ecology(self, dt: float):
        w = self.world
        for p in w.positions(FARMLAND):
            if self.weather in {"rain", "storm"}:
                w.set(*p, FARMLAND, 1)
                self.wet_age[p] = 0
            elif w.get_meta(*p) == 1:
                self.wet_age[p] = self.wet_age.get(p, 0) + dt
                if self.wet_age[p] >= 100:
                    w.set(*p, FARMLAND, 0)
        for p in w.positions(WHEAT):
            soil = (p[0],p[1]-1,p[2])
            if w.get(*soil) == FARMLAND and w.get_meta(*soil) == 1:
                self.crop_age[p] = self.crop_age.get(p, 0) + dt
                w.set(*p, WHEAT, min(3, int(self.crop_age[p] // 25)))
        for p in list(self.berry_regrowth):
            self.berry_regrowth[p] += dt
            if self.berry_regrowth[p] >= 100:
                if w.get(*p) == AIR and w.get(p[0],p[1]-1,p[2]) == GRASS:
                    w.set(*p, BERRY)
                del self.berry_regrowth[p]
        for p in list(self.sapling_age):
            self.sapling_age[p] += dt
            if w.get(*p) != SAPLING:
                del self.sapling_age[p]
            elif self.sapling_age[p] >= 120 and (p[0],p[2]) != (self.grid_pos[0],self.grid_pos[2]):
                if w.grow_tree(p):
                    del self.sapling_age[p]

    def update_needs(self, dt: float):
        n, shelter = self.needs, self.shelter()
        sleeping = self.job and self.current_action == "sleep" and not self.path
        n["hunger"] -= dt * (.025 if sleeping else .055)
        n["thirst"] -= dt * (.035 if sleeping else .085)
        if sleeping:
            n["energy"] += dt * (1.8 if self.job["params"].get("on_bed") and shelter["near_bed"] else .65)
        else:
            n["energy"] -= dt * (.055 if self.job else .015)
        exposed = not shelter["sheltered"] and (self.phase == "night" or self.weather != "clear")
        n["mood"] += dt * (-.07 if exposed else .08 if shelter["sheltered"] else .015)
        if min(n["hunger"], n["thirst"]) < 5 or (exposed and self.weather == "storm"):
            n["health"] -= dt * .12
        elif min(n["hunger"], n["thirst"], n["energy"]) > 30:
            n["health"] += dt * .04
        for k in n:
            n[k] = max(0, min(100, n[k]))

    def step(self, dt: float = .1, force: bool = False):
        if self.paused and not force:
            return
        if not 0 < dt <= 5:
            raise ValueError("Simulation step must be in (0, 5] seconds")
        self.tick += 1
        previous_day = self.day
        self.elapsed += dt
        if self.day != previous_day and self.last_journal_day < previous_day:
            self.write_journal("A new dawn is coming. I am learning how to live on this little island.")
        period = int(self.elapsed // 90)
        if period != self.last_weather_period:
            self.last_weather_period = period
            if not self.weather_override:
                self.weather = self.rng.choices(["clear", "rain", "storm"], [7, 2, 1])[0]
        self.update_ecology(dt)
        self.update_needs(dt)
        # Emergency needs interrupt at the next tile boundary, never snapping mid-stride.
        if self.job and not self.path and min(self.needs["hunger"], self.needs["thirst"]) < 15 and self.current_action not in {"eat", "drink", "forage", "craft"}:
            self.job = None
        if not self.job:
            self.choose_fallback()
        if self.path:
            target = self.path[0]
            if not self.world.walkable(target):
                # If an intervention changes the route, return along the current safe tile.
                self.position = list(map(float, self.grid_pos))
                self.path, self.job = [], None
                self.animation = "idle"
                return
            for y in (target[1], target[1]+1):
                if self.world.get(target[0],y,target[2]) == DOOR:
                    self.world.set(target[0],y,target[2],OPEN_DOOR)
            delta = [target[i]-self.position[i] for i in range(3)]
            length = math.sqrt(sum(d*d for d in delta))
            self.yaw = math.atan2(delta[0], delta[2])
            travel = 2.4 * dt
            if length <= travel:
                self.position, self.grid_pos = list(map(float, target)), target
                self.path.pop(0)
            else:
                self.position = [self.position[i] + delta[i] / length * travel for i in range(3)]
            self.animation = "walking"
            return
        if self.job:
            self.animation = ANIMATION.get(self.current_action, "idle")
            self.job["elapsed"] += dt
            self.progress = min(1, self.job["elapsed"] / self.job["duration"])
            if self.progress >= 1 or (self.current_action == "sleep" and self.phase != "night" and self.needs["energy"] >= 96):
                self.finish_job()

    def intervene(self, action: str, value: Any):
        if action == "set_time":
            if isinstance(value, dict):
                value = value.get("time_of_day")
            if type(value) not in {float, int} or not math.isfinite(value) or not 0 <= value < 1:
                raise ValueError("set_time value must be a number in [0, 1)")
            self.elapsed = (self.day-1)*DAY_SECONDS + value*DAY_SECONDS
        elif action == "set_weather":
            if value not in ("clear", "rain", "storm"):
                raise ValueError("set_weather value must be clear, rain or storm")
            self.weather, self.weather_override = value, True
        elif action == "whisper":
            if not isinstance(value, str) or not value.strip() or len(value) > 1000:
                raise ValueError("whisper value must be 1..1000 characters")
            self.remember(f"A whisper from the sky: {value}")
            self.thought = f"I heard a whisper: {value[:200]}. I will think about it while caring for myself."
        elif action == "heal_npc":
            self.needs = dict.fromkeys(self.needs, 100.0)
        elif action == "drop_gift":
            gift = value
            if isinstance(value, dict) and "item" in value:
                gift = {value["item"]: value.get("amount", 1)}
            if not isinstance(gift, dict) or not gift or any(k not in INVENTORY_KEYS or type(v) is not int or not 1 <= v <= 1000 for k,v in gift.items()):
                raise ValueError("drop_gift value must map inventory keys to integer amounts 1..1000")
            for key, amount in gift.items():
                self.inventory[key] += amount
            self.remember("A gift arrived from above; I will put it to good use.")
        elif action == "spawn_tree":
            if not isinstance(value, dict) or any(type(value.get(k)) is not int for k in ("x", "z")):
                raise ValueError("spawn_tree value needs integer x,z and optional integer y")
            if "y" in value and type(value["y"]) is not int:
                raise ValueError("Tree y must be an integer")
            x,z = value["x"], value["z"]
            p = (x,value["y"],z) if "y" in value else self.world.feet_at(x,z)
            if not p or not self.world.inside(*p) or (10<=x<=25 and 10<=z<=21) or (x,z)==(self.grid_pos[0],self.grid_pos[2]) or not self.world.grow_tree(p):
                raise ValueError("Tree needs clear natural ground outside the house/farm clearing")
        else:
            raise ValueError("Unknown intervention")
