"""Headless fixed-step multi-agent human simulation, independent of the HTTP/event loop."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from .models import Decision
from .catalog import INVENTORY_KEYS, MATERIALS, catalog_snapshot
from .household import HomeState, Household
from .pathfinding import astar, path_to_any
from .world import (
    World, Pos, PALETTE, AIR, GRASS, DIRT, STONE, WATER, LOG, LEAVES,
    PLANK, COBBLE, GLASS, DOOR, OPEN_DOOR, BED, CHEST, BENCH, TORCH,
    FARMLAND, WHEAT, BERRY, SAPLING, ROOF, FENCE,
)

OBJECT_NAME_TO_BLOCK = {
    "grass": GRASS,
    "dirt": DIRT,
    "stone": STONE,
    "water": WATER,
    "wood_log": LOG,
    "leaves": LEAVES,
    "wood_plank": PLANK,
    "cobblestone": COBBLE,
    "glass": GLASS,
    "door_closed": DOOR,
    "door": DOOR,
    "bed": BED,
    "chest": CHEST,
    "crafting_bench": BENCH,
    "torch": TORCH,
    "lantern": TORCH,
    "farmland": FARMLAND,
    "crop_wheat": WHEAT,
    "wheat": WHEAT,
    "wild_berry": BERRY,
    "berry": BERRY,
    "sapling": SAPLING,
    "roof_shingle": ROOF,
    "roof": ROOF,
    "fence": FENCE,
}
ENTITY_KINDS = ("companion", "villager", "cat", "fox", "sheep", "deer", "duck")
ENTITY_DEFAULT_NAMES = {
    "companion": ["Elena", "Rowan", "Maya", "Soren"],
    "villager": ["Clara", "Leo", "Nora", "Finn"],
    "cat": ["Mochi", "Yuzu", "Biscuit", "Luna"],
    "fox": ["Rusty", "Maple", "Ember", "Pip"],
    "sheep": ["Cloud", "Bramble", "Puff", "Cotton"],
    "deer": ["Willow", "Fern", "Bambi", "Aspen"],
    "duck": ["Puddle", "Quack", "Sunny", "Pippin"],
}
AGENT_ROLES = ("pioneer", "builder", "farmer", "forager", "explorer")
AGENT_DEFAULT_NAMES = ["Elena", "Rowan", "Maya", "Soren", "Clara", "Leo", "Nora", "Finn"]
DAY_SECONDS = 360.0
DURATIONS = {"idle": 2, "explore": .3, "walk": .1, "forage": 2, "drink": 2.5,
             "eat": 2, "sleep": 20, "chop": 4, "mine": 2.5, "craft": 2,
             "build": .8, "till": 1.5, "plant": 1, "water": 1.5,
             "harvest": 2, "plant_sapling": 1.5, "journal": 4,
             "gather": 3, "furnish": 3, "repair": 4, "clean": 5, "wash": 4,
             "refill": 4, "stoke": 2, "store": 2, "take": 2, "fertilize": 2}
ANIMATION = {"chop": "chopping", "mine": "mining", "build": "building", "till": "tilling",
             "plant": "planting", "plant_sapling": "planting", "water": "watering",
             "harvest": "harvesting", "forage": "harvesting", "eat": "eating",
             "drink": "drinking", "sleep": "sleeping", "craft": "building", "journal": "thinking",
             "gather": "harvesting", "furnish": "building", "repair": "building", "clean": "tilling",
             "wash": "watering", "refill": "watering", "stoke": "building", "store": "building", "take": "building", "fertilize": "tilling"}


def xyz(p) -> dict:
    return dict(zip(("x", "y", "z"), p))


def distance(a, b) -> float:
    return math.dist(a, b)


def _encode_pos_map(mapping: dict[Pos, float]) -> list[list]:
    return [[x, y, z, round(float(val), 4)] for (x, y, z), val in mapping.items()]


def _decode_pos_map(items) -> dict[Pos, float]:
    out: dict[Pos, float] = {}
    if isinstance(items, list):
        for entry in items:
            if isinstance(entry, (list, tuple)) and len(entry) == 4:
                out[(int(entry[0]), int(entry[1]), int(entry[2]))] = float(entry[3])
    elif isinstance(items, dict):
        for key, val in items.items():
            parts = str(key).split(",")
            if len(parts) == 3:
                out[(int(parts[0]), int(parts[1]), int(parts[2]))] = float(val)
    return out


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
                blocks.append(BlueprintBlock((x, y, z), block, "walls", "glass_pane" if block == GLASS else "wood_plank"))
    for x in range(13,18):
        roof_y = 14+min(2,x-12,18-x)
        for y in range(14,roof_y):
            for z in (12,18):
                blocks.append(BlueprintBlock((x,y,z),PLANK,"walls","wood_plank"))
    for x in range(11,20):
        for z in range(11,20):
            y = 14+max(0,min(2,x-12,18-x))
            blocks.append(BlueprintBlock((x,y,z),ROOF,"roof","shingles"))
    for pos, block in [((13, 11, 13), BED), ((17, 11, 13), CHEST), ((17, 11, 16), BENCH), ((13, 12, 16), TORCH)]:
        blocks.append(BlueprintBlock(pos, block, "furnishing", "bedding" if block==BED else "wood_plank", 1 if block==BED else 2))
    for x in range(14,17):
        blocks.append(BlueprintBlock((x,10,19),PLANK,"exterior","wood_plank"))
    for x in (12,18):
        blocks.append(BlueprintBlock((x,11,19),FENCE,"exterior","wood_plank"))
        blocks.append(BlueprintBlock((x,12,19),TORCH,"exterior","wood_plank"))
    return blocks


class NpcAgent:
    """Autonomous human inhabitant with its own body, needs, inventory, perception and AI brain status."""

    def __init__(
        self,
        sim: Simulation,
        agent_id: str,
        name: str,
        role: str = "pioneer",
        variant: int = 0,
        start_pos: Pos = (16, 11, 20),
    ):
        self.sim = sim
        self.id = agent_id
        self.name = name
        self.role = role if role in AGENT_ROLES else "pioneer"
        self.variant = variant
        self.position = [float(start_pos[0]), float(start_pos[1]), float(start_pos[2])]
        self.grid_pos: Pos = start_pos
        self.yaw = 0.0
        self.needs = dict(hunger=82.0, energy=95.0, thirst=75.0, health=100.0, mood=78.0, hygiene=90.0, warmth=90.0)
        self.inventory = dict.fromkeys(INVENTORY_KEYS, 0)
        self.household = Household(self)
        self.animation, self.current_action = "idle", "idle"
        self.current_goal = f"Survive and help as {self.role}" if agent_id != "aiden" else "Explore and survive"
        self.thought = (
            "An island in the sky. I can hear water; first I need food, then a home."
            if agent_id == "aiden"
            else f"I arrived on this floating island as {self.name}. Ready to live and lend a hand."
        )
        self.path: list[Pos] = []
        self.target: Pos | None = None
        self.job: dict | None = None
        self.progress = 0.0
        self.memories: list[dict] = []
        self.journal: list[dict] = []
        self.explored = agent_id != "aiden"
        self.last_journal_day = 0
        self.last_plant_time = -999.0
        self.queued_decision: Decision | None = None
        self.llm_status = dict(
            provider="fallback", model="", thinking=False, last_latency_ms=0,
            calls_count=0, fallback_active=True, last_error=None,
        )
        self.remember(
            "Woke on a floating island with empty pockets."
            if agent_id == "aiden"
            else f"Joined the island community as {self.role}."
        )

    def remember(self, text: str):
        self.memories.append(dict(day=self.sim.day, tick=self.sim.tick, text=text))
        self.memories[:] = self.memories[-18:]

    def write_journal(self, text: str | None = None):
        self.journal.append(dict(
            day=self.sim.day,
            time=self.sim.clock_str,
            text=text or (
                f"Day {self.sim.day} ({self.name}): our island house is {self.sim.house_progress():.0f}% complete. "
                f"I carry {self.inventory['berries']} berries and {self.inventory['wheat']} wheat under {self.sim.weather} skies."
            ),
        ))
        self.journal[:] = self.journal[-30:]
        self.last_journal_day = self.sim.day

    def shelter(self):
        w = self.sim.world
        x, y, z = self.grid_pos
        roof = any(w.get(x, yy, z) in {ROOF, PLANK, COBBLE} for yy in range(y + 2, min(y + 7, 24)))
        walls = all(any(w.get(x + dx * r, y + 1, z + dz * r) in {PLANK, GLASS, DOOR, OPEN_DOOR, COBBLE}
                        for r in range(1, 8)) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        near_bed = any(distance(self.grid_pos, p) <= 4 for p in w.positions(BED))
        return dict(roof_overhead=roof, enclosed_walls=walls, near_bed=near_bed, sheltered=roof and walls and self.household.condition["roof"] >= 60)

    def perception(self):
        w = self.sim.world
        shelter = self.shelter()
        groups = {"tree": self.sim.tree_bases(), "water": w.positions(WATER),
                  "berries": w.positions(BERRY), "house_site": [(15, 11, 15)],
                  "farm_plot": w.positions(FARMLAND)}
        nearby = []
        for kind, points in groups.items():
            for p in sorted(points, key=lambda p: (distance(self.position, p), p))[:3]:
                nearby.append(dict(type=kind, position=xyz(p), distance=round(distance(self.position, p), 2)))
        for peer in self.sim.agents.values():
            if peer.id == self.id:
                continue
            nearby.append(dict(
                type="person",
                label=f"{peer.name} ({peer.role})",
                position=xyz(peer.grid_pos),
                distance=round(distance(self.position, peer.position), 2),
            ))
        for ent in sorted(self.sim.entities, key=lambda e: distance(self.position, (e["position"]["x"], e["position"]["y"], e["position"]["z"])))[:4]:
            ep = (ent["position"]["x"], ent["position"]["y"], ent["position"]["z"])
            nearby.append(dict(type=ent["kind"], label=f"{ent['name']} ({ent['kind']})", position=ent["grid_pos"], distance=round(distance(self.position, ep), 2)))
        visible = [f"{e.get('label') or e['type']} {e['distance']:.0f} blocks away" for e in nearby if e['distance'] <= 12]
        location = ("inside the house" if shelter["sheltered"] else "beside the pond" if any(e['type'] == 'water' and e['distance'] < 4 for e in nearby)
                    else "in the forest" if any(e['type'] == 'tree' and e['distance'] < 4 for e in nearby) else "in the grassy clearing")
        nearest = {kind: min((e["distance"] for e in nearby if e["type"] == kind), default=None) for kind in groups}
        return dict(location_label=location, sheltered=shelter.pop("sheltered"),
                    visible_summary=", ".join(visible) or "Open sky and grassy ground.", nearby_entities=nearby,
                    nearest_distances=nearest, home_needs=self.household.snapshot()["maintenance_tasks"], **shelter)

    def snapshot(self) -> dict:
        return dict(
            id=self.id,
            name=self.name,
            role=self.role,
            variant=self.variant,
            position=xyz([round(p, 4) for p in self.position]),
            grid_pos=xyz(self.grid_pos),
            yaw=self.yaw,
            animation=self.animation,
            action_progress=round(self.progress, 4),
            current_action=self.current_action,
            current_goal=self.current_goal,
            thought=self.thought,
            needs={k: round(v, 3) for k, v in self.needs.items()},
            inventory=dict(self.inventory),
            target_block=xyz(self.target) if self.target else None,
            path=[xyz(p) for p in self.path],
            perception=self.perception(),
            memories=list(self.memories),
            journal=list(self.journal),
            llm_status=dict(self.llm_status),
            tools={k:dict(durability=v,owned=self.inventory[k]) for k,v in self.household.tools.items()},
        )

    def export_save(self) -> dict:
        """Serialize individual NPC body state, needs, inventory, tools, memories and journal."""
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "variant": int(self.variant),
            "position": [round(float(v), 4) for v in self.position],
            "grid_pos": list(self.grid_pos),
            "yaw": round(float(self.yaw), 4),
            "needs": {k: round(float(v), 3) for k, v in self.needs.items()},
            "inventory": {k: int(v) for k, v in self.inventory.items()},
            "tools": {k: round(float(v), 3) for k, v in self.household.tools.items()},
            "current_goal": self.current_goal,
            "thought": self.thought,
            "memories": [dict(m) for m in self.memories],
            "journal": [dict(j) for j in self.journal],
            "explored": bool(self.explored),
            "last_journal_day": int(self.last_journal_day),
            "last_plant_time": float(self.last_plant_time),
        }

    @classmethod
    def from_save(cls, sim: Simulation, data: dict) -> NpcAgent:
        """Restore an NpcAgent bound to an already-restored Simulation and HomeState."""
        agent_id = str(data.get("id", "")).strip()
        if not agent_id:
            raise ValueError("Saved agent missing id")
        raw_grid = data.get("grid_pos") or [16, 11, 20]
        grid_pos = (int(raw_grid[0]), int(raw_grid[1]), int(raw_grid[2]))
        agent = cls(
            sim,
            agent_id=agent_id,
            name=str(data.get("name", agent_id.title()))[:32],
            role=str(data.get("role", "pioneer")),
            variant=int(data.get("variant", 0)),
            start_pos=grid_pos,
        )
        raw_pos = data.get("position")
        if isinstance(raw_pos, list) and len(raw_pos) == 3:
            agent.position = [float(raw_pos[0]), float(raw_pos[1]), float(raw_pos[2])]
        agent.yaw = float(data.get("yaw", 0.0))
        for k, v in (data.get("needs") or {}).items():
            if k in agent.needs:
                agent.needs[k] = float(v)
        for k, v in (data.get("inventory") or {}).items():
            if k in agent.inventory:
                agent.inventory[k] = int(v)
        for k, v in (data.get("tools") or {}).items():
            if k in agent.household.tools:
                agent.household.tools[k] = float(v)
        if "current_goal" in data:
            agent.current_goal = str(data["current_goal"])
        if "thought" in data:
            agent.thought = str(data["thought"])
        agent.memories = [dict(m) for m in (data.get("memories") or []) if isinstance(m, dict)][-18:]
        agent.journal = [dict(j) for j in (data.get("journal") or []) if isinstance(j, dict)][-30:]
        agent.explored = bool(data.get("explored", agent_id != "aiden"))
        agent.last_journal_day = int(data.get("last_journal_day", 0))
        agent.last_plant_time = float(data.get("last_plant_time", -999.0))
        return agent

    def approach(self, target: Pos, reach: int = 1, exact: bool = False, avoid_target: bool = False):
        w = self.sim.world
        if exact:
            return astar(w, self.grid_pos, target)
        goals = set()
        x, y, z = target
        for xx in range(x - reach, x + reach + 1):
            for zz in range(z - reach, z + reach + 1):
                if abs(xx - x) + abs(zz - z) > reach or (avoid_target and (xx, zz) == (x, z)):
                    continue
                for yy in range(max(1, y - (5 if reach >= 3 else 2)), min(23, y + 3)):
                    if w.walkable((xx, yy, zz)):
                        goals.add((xx, yy, zz))
        return path_to_any(w, self.grid_pos, goals)

    def nearest_reachable(self, candidates, reach=1, avoid_target=False):
        for p in sorted(candidates, key=lambda p: (distance(self.position, p), p)):
            path = self.approach(p, reach, avoid_target=avoid_target)
            if path is not None:
                return p, path
        return None

    def make_job(self, action: str, target: Pos | None = None, path=None, **params):
        self.job = dict(action=action, duration=DURATIONS[action]*self.household.tool_bonus(action), elapsed=0.0, params=params)
        self.current_action = action
        self.target = target
        self.path = list(path or [])
        self.progress = 0
        self.animation = "walking" if self.path else ANIMATION.get(action, "idle")
        return True

    def start_action(self, action: str, params: dict | None = None) -> bool:
        params = params or {}
        household_action = self.household.start(action,params)
        if household_action is not None:
            return household_action
        inv, w = self.inventory, self.sim.world
        candidates, reach, avoid = None, 1, False
        if action in {"walk", "explore"}:
            if action == "explore":
                if self.id == "aiden":
                    target = w.feet_at(20, 19)
                else:
                    rx = self.sim.rng.randint(6, 26)
                    rz = self.sim.rng.randint(6, 26)
                    target = w.feet_at(rx, rz)
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
            candidates = self.sim.tree_bases()
        elif action == "mine":
            reserved = {tuple(n["position"][k] for k in ("x","y","z")) for n in w.resource_nodes.values() if n["remaining"] > 0}
            candidates = [p for p in w.positions(STONE) if p[1] >= 10
                          and p not in reserved
                          and p != (self.grid_pos[0], self.grid_pos[1] - 1, self.grid_pos[2])
                          and any(w.get(p[0]+dx, p[1], p[2]+dz) == AIR for dx, dz in ((1,0),(-1,0),(0,1),(0,-1))) ]
            avoid = True
        elif action == "build":
            b = self.sim.next_build()
            if not b or inv[b.material] < b.amount:
                return False
            if w.get(*b.pos) in {LOG, LEAVES}:
                return self.start_action("chop")
            result = self.nearest_reachable([b.pos], 3, avoid_target=True)
            if not result:
                return False
            return self.make_job(action, *result, blueprint=b)
        elif action == "till":
            candidates = [p for p in self.sim.farm_sites if w.get(*p) in {GRASS, DIRT} and w.get(p[0], p[1]+1, p[2]) in {AIR, BERRY}]
        elif action == "plant":
            if not inv["seeds"]:
                return False
            candidates = [(x, y+1, z) for x,y,z in w.positions(FARMLAND) if w.get(x,y+1,z) == AIR]
        elif action == "water":
            candidates = [p for p in w.positions(FARMLAND) if w.get_meta(*p) == 0]
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
                            and not any(abs(t[0]-x)<3 and abs(t[2]-z)<3 for t in self.sim.tree_bases()+w.positions(SAPLING))):
                        candidates.append(p)
        if candidates is None:
            return False
        result = self.nearest_reachable(candidates, reach, avoid)
        if not result:
            return False
        return self.make_job(action, *result, on_bed=action == "sleep")

    def can_start(self, action: str, params: dict) -> bool:
        saved = (self.job,self.current_action,self.target,self.path,self.progress,self.animation)
        rng_state = self.sim.rng.getstate()
        try:
            return bool(self.start_action(action,params))
        finally:
            self.job,self.current_action,self.target,self.path,self.progress,self.animation = saved
            self.sim.rng.setstate(rng_state)

    def apply_decision(self, decision: Decision) -> bool:
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
        sim = self.sim
        if n["thirst"] < 42 and self.choose("drink", "My mouth feels dry. The pond is fresh and close enough to reach.", "Stay hydrated"):
            return
        if n["hunger"] < 48:
            if not inv["bread"] and self.household.storage["bread"] > 0 and self.choose("take","I saved bread for a moment like this.","Fetch a meal",item="bread",amount=1):
                return
            if inv["wheat"] >= 3 and not inv["bread"] and self.choose("craft", "This wheat will make a filling loaf.", "Prepare food", recipe="bread"):
                return
            if self.choose("eat", "I should stop and eat before I get weaker.", "Satisfy hunger"):
                return
            if self.choose("forage", "Those berries will keep me going while I work.", "Find food"):
                return
        if n["energy"] < 22 or (sim.phase == "night" and sim.house_progress() == 100):
            if self.choose("sleep", "Time to close my eyes. Tomorrow can wait.", "Sleep until rested"):
                return
        if sim.phase == "evening" and self.last_journal_day != sim.day:
            self.choose("journal", "The light is fading. I want to remember what happened today.", "Reflect on the day")
            return
        if self.queued_decision:
            decision, self.queued_decision = self.queued_decision, None
            if self.apply_decision(decision):
                return
            self.remember("I reconsidered an idea that was no longer possible.")
        if self.household.choose_maintenance():
            return

        # Secondary role specializations
        if self.role == "explorer":
            if self.choose("explore", "Mapping out the edges of our sky island and checking on neighbors.", "Explore the island"):
                return
        elif self.role == "farmer":
            if self.choose("harvest", "Golden wheat is ready for harvest.", "Harvest ripe wheat"):
                return
            if self.choose("water", "Watering the soil beside the pond.", "Water farm plots"):
                return
            if self.choose("plant", "Planting fresh seeds in moist farmland.", "Sow wheat"):
                return
            if self.choose("till", "Preparing rich soil for more crops.", "Expand farm"):
                return
            if inv["berries"] < 4 and self.choose("forage", "Gathering berries and seeds.", "Forage seeds"):
                return
        elif self.role == "forager":
            if inv["berries"] < 8 and self.choose("forage", "Gathering berries across the woodland.", "Forage berries"):
                return
            if sim.elapsed - self.last_plant_time > 45 and self.choose("plant_sapling", "Planting a sapling to keep the forest lush.", "Replant forest"):
                return
            if inv["wood_log"] < 6 and self.choose("chop", "Chopping timber and collecting seeds.", "Gather timber"):
                return

        if not self.explored and self.choose("explore", "I will check the clearing and the pond before choosing where to settle.", "Explore the island"):
            return
        if inv["berries"] < 6 and self.choose("forage", "A few berries in my pocket will make building less precarious.", "Stock a little food"):
            return
        b = sim.next_build()
        if b:
            if inv[b.material] < b.amount:
                if self.household.ensure(b.material,b.amount):
                    return
            if self.choose("build", f"The {b.stage} comes next. Each block makes this clearing feel more like home.", "Build one cozy home"):
                return
        else:
            if sim.weather in {"rain", "storm"}:
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
            if not inv["seeds"] and not sim.world.locations[WHEAT] and self.choose("chop", "I need a few seeds from the forest floor before I can sow.", "Find seeds"):
                return
            if sim.elapsed - self.last_plant_time > 60 and self.choose("plant_sapling", "I took wood from this island; I want to give a tree back.", "Renew the forest"):
                return
            if inv["wood_log"] < 4 and self.choose("chop", "A small reserve of timber will help me maintain the house.", "Maintain supplies"):
                return
            if self.household.choose_upgrades():
                return
        self.choose("idle", "The island is quiet for a moment. I can watch the sky and catch my breath.", "Rest and observe")

    def finish_job(self):
        job, p, w, inv, sim = self.job, self.target, self.sim.world, self.inventory, self.sim
        if job is None:
            return
        action, params = job["action"], job["params"]
        if self.household.finish(action,params,p):
            self.job, self.target, self.path = None, None, []
            self.animation, self.current_action, self.progress = "idle", "idle", 0
            return
        if action == "explore":
            self.explored = True
            self.remember("Found freshwater and a flat central clearing for one house.")
        elif action == "forage" and p and w.get(*p) == BERRY:
            sim.change_block(p, AIR)
            inv["berries"] += 6
            inv["seeds"] += 1
            sim.berry_regrowth[p] = 0
            self.remember("Gathered six wild berries and a seed.")
        elif action == "drink" and p and w.get(*p) == WATER:
            self.needs["thirst"] = min(100, self.needs["thirst"] + 65)
        elif action == "eat" and inv[params["food"]] > 0:
            inv[params["food"]] -= 1
            self.needs["hunger"] = min(100, self.needs["hunger"] + (38 if params["food"] == "bread" else 18))
            self.needs["mood"] = min(100, self.needs["mood"] + 2)
        elif action == "chop" and p and w.get(*p) == LOG:
            x, y, z = p
            logs = 0
            while w.get(x, y + logs, z) == LOG:
                sim.change_block((x, y + logs, z), AIR)
                logs += 1
            trunks = w.positions(LOG)
            for q in w.positions(LEAVES):
                if abs(q[0]-x)<=2 and abs(q[2]-z)<=2 and y<=q[1]<=y+5:
                    if not any(abs(t[0]-q[0])<=2 and abs(t[2]-q[2])<=2 and abs(t[1]-q[1])<=2 for t in trunks):
                        sim.change_block(q, AIR)
            inv["wood_log"] += logs
            inv["sapling"] += 1
            inv["seeds"] += 2
            self.remember(f"Chopped a tree for {logs} logs; saved a sapling and seeds.")
        elif action == "mine" and p and w.get(*p) == STONE:
            if p != (self.grid_pos[0], self.grid_pos[1] - 1, self.grid_pos[2]):
                sim.change_block(p, AIR)
                inv["stone"] += 1
        elif action == "build":
            b = params["blueprint"]
            if not sim.blueprint_matches(b) and inv[b.material] >= b.amount:
                inv[b.material] -= b.amount
                sim.change_block(b.pos, b.block)
                material = {PLANK:"oak_boards", COBBLE:"cut_stone", ROOF:"cedar_shingle", GLASS:"clear_glass", BED:"linen_bedding"}.get(b.block)
                if material:
                    w.set_material(b.pos,material)
                if not sim.next_build():
                    self.remember("My house is complete: a roof, a bed, and a place that is mine.")
        elif action == "till" and p and w.get(*p) in {GRASS, DIRT}:
            sim.change_block((p[0], p[1] + 1, p[2]), AIR)
            sim.change_block(p, FARMLAND)
        elif action == "plant" and p and inv["seeds"] and w.get(*p) == AIR and w.get(p[0], p[1] - 1, p[2]) == FARMLAND:
            inv["seeds"] -= 1
            sim.change_block(p, WHEAT)
            sim.crop_age[p] = 0
        elif action == "water" and p and w.get(*p) == FARMLAND:
            sim.change_block(p, FARMLAND, 1)
            sim.wet_age[p] = 0
        elif action == "harvest" and p and w.get(*p) == WHEAT and w.get_meta(*p) == 3:
            sim.change_block(p, AIR)
            inv["wheat"] += 2
            inv["seeds"] += 2
            sim.crop_age.pop(p, None)
            self.remember("Harvested ripe wheat and kept seeds for the next crop.")
        elif action == "plant_sapling" and p and inv["sapling"] and w.get(*p) == AIR:
            inv["sapling"] -= 1
            sim.change_block(p, SAPLING)
            sim.sapling_age[p] = 0
            self.last_plant_time = sim.elapsed
            self.remember("Planted a young tree to renew the forest.")
        elif action == "journal":
            self.write_journal()
        self.household.wear_tool(action)
        self.job, self.target, self.path = None, None, []
        self.animation, self.current_action, self.progress = "idle", "idle", 0

    def update_needs(self, dt: float):
        n, shelter = self.needs, self.shelter()
        sim = self.sim
        sleeping = self.job and self.current_action == "sleep" and not self.path
        n["hunger"] -= dt * (.025 if sleeping else .055)
        n["thirst"] -= dt * (.035 if sleeping else .085)
        if sleeping:
            n["energy"] += dt * (1.8 if self.job["params"].get("on_bed") and shelter["near_bed"] else .65)
        else:
            n["energy"] -= dt * (.055 if self.job else .015)
        exposed = not shelter["sheltered"] and (sim.phase == "night" or sim.weather != "clear")
        n["mood"] += dt * (-.07 if exposed else .08 if shelter["sheltered"] else .015)
        if min(n["hunger"], n["thirst"]) < 5 or (exposed and sim.weather == "storm"):
            n["health"] -= dt * .12
        elif min(n["hunger"], n["thirst"], n["energy"]) > 30:
            n["health"] += dt * .04
        for k in n:
            n[k] = max(0, min(100, n[k]))

    def step_agent(self, dt: float):
        w = self.sim.world
        self.update_needs(dt)
        self.household.update_personal(dt)
        if self.job and not self.path and min(self.needs["hunger"], self.needs["thirst"]) < 15 and self.current_action not in {"eat", "drink", "forage", "craft"}:
            self.job = None
        if not self.job:
            self.choose_fallback()
        if self.path:
            target = self.path[0]
            if not w.walkable(target):
                self.position = list(map(float, self.grid_pos))
                self.path, self.job = [], None
                self.animation = "idle"
                return
            for y in (target[1], target[1] + 1):
                if w.get(target[0], y, target[2]) == DOOR:
                    w.set(target[0], y, target[2], OPEN_DOOR)
            delta = [target[i] - self.position[i] for i in range(3)]
            length = math.sqrt(sum(d * d for d in delta))
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
            if self.progress >= 1 or (self.current_action == "sleep" and self.sim.phase != "night" and self.needs["energy"] >= 96):
                self.finish_job()


class Simulation:
    def __init__(self, seed: int = 66):
        self.seed, self.rng = seed, random.Random(seed + 731)
        self.world = World(seed)
        self.tick, self.elapsed = 0, DAY_SECONDS * .26
        self.paused, self.speed, self.weather = False, 1, "clear"
        self.weather_override = False
        self.blueprint = house_blueprint()
        self.farm_sites = [(x, 10, z) for x in (19, 20) for z in range(18, 22)]
        self.crop_age: dict[Pos, float] = {}
        self.wet_age: dict[Pos, float] = {}
        self.berry_regrowth: dict[Pos, float] = {}
        self.sapling_age: dict[Pos, float] = {}
        self.blocks_placed, self.blocks_broken = 0, 0
        self.last_weather_period = int(self.elapsed // 90)
        self.entities: list[dict] = []
        self.entity_counter = 0
        self.agent_counter = 1
        self.home = HomeState()
        self.agents: dict[str, NpcAgent] = {
            "aiden": NpcAgent(self, "aiden", "Aiden", role="pioneer", variant=0, start_pos=(16, 11, 20)),
        }

    @property
    def primary(self) -> NpcAgent:
        return self.agents["aiden"]

    @property
    def household(self) -> Household:
        return self.primary.household

    # Backwards-compatible properties forwarding to primary agent ("aiden")
    @property
    def position(self): return self.primary.position
    @position.setter
    def position(self, v): self.primary.position = v
    @property
    def grid_pos(self): return self.primary.grid_pos
    @grid_pos.setter
    def grid_pos(self, v): self.primary.grid_pos = v
    @property
    def yaw(self): return self.primary.yaw
    @yaw.setter
    def yaw(self, v): self.primary.yaw = v
    @property
    def needs(self): return self.primary.needs
    @needs.setter
    def needs(self, v): self.primary.needs = v
    @property
    def inventory(self): return self.primary.inventory
    @inventory.setter
    def inventory(self, v): self.primary.inventory = v
    @property
    def animation(self): return self.primary.animation
    @animation.setter
    def animation(self, v): self.primary.animation = v
    @property
    def current_action(self): return self.primary.current_action
    @current_action.setter
    def current_action(self, v): self.primary.current_action = v
    @property
    def current_goal(self): return self.primary.current_goal
    @current_goal.setter
    def current_goal(self, v): self.primary.current_goal = v
    @property
    def thought(self): return self.primary.thought
    @thought.setter
    def thought(self, v): self.primary.thought = v
    @property
    def path(self): return self.primary.path
    @path.setter
    def path(self, v): self.primary.path = v
    @property
    def target(self): return self.primary.target
    @target.setter
    def target(self, v): self.primary.target = v
    @property
    def job(self): return self.primary.job
    @job.setter
    def job(self, v): self.primary.job = v
    @property
    def progress(self): return self.primary.progress
    @progress.setter
    def progress(self, v): self.primary.progress = v
    @property
    def memories(self): return self.primary.memories
    @property
    def journal(self): return self.primary.journal
    @property
    def explored(self): return self.primary.explored
    @explored.setter
    def explored(self, v): self.primary.explored = v
    @property
    def last_journal_day(self): return self.primary.last_journal_day
    @last_journal_day.setter
    def last_journal_day(self, v): self.primary.last_journal_day = v
    @property
    def last_plant_time(self): return self.primary.last_plant_time
    @last_plant_time.setter
    def last_plant_time(self, v): self.primary.last_plant_time = v
    @property
    def queued_decision(self): return self.primary.queued_decision
    @queued_decision.setter
    def queued_decision(self, v): self.primary.queued_decision = v
    @property
    def llm_status(self): return self.primary.llm_status

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
        self.primary.remember(text)

    def write_journal(self, text: str | None = None):
        self.primary.write_journal(text)

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
        return self.primary.shelter()

    def perception(self):
        return self.primary.perception()

    def start_action(self, action: str, params: dict | None = None) -> bool:
        return self.primary.start_action(action, params)

    def apply_decision(self, decision: Decision) -> bool:
        return self.primary.apply_decision(decision)

    def update_needs(self, dt: float):
        self.primary.update_needs(dt)

    def finish_job(self):
        self.primary.finish_job()

    def add_agent(self, name: str | None = None, role: str = "pioneer", pos: Pos | None = None) -> NpcAgent:
        if len(self.agents) >= 8:
            raise ValueError("Maximum 8 autonomous AI NPCs supported simultaneously")
        spot = self._find_open_spot(pos)
        if not spot:
            raise ValueError("No walkable ground available for new NPC")
        self.agent_counter += 1
        agent_id = f"npc-{self.agent_counter}"
        clean_name = (name or "").strip()[:32]
        if not clean_name:
            clean_name = AGENT_DEFAULT_NAMES[(self.agent_counter - 2) % len(AGENT_DEFAULT_NAMES)]
        agent = NpcAgent(
            self,
            agent_id=agent_id,
            name=clean_name,
            role=role,
            variant=self.agent_counter - 1,
            start_pos=spot,
        )
        self.agents[agent_id] = agent
        self.primary.remember(f"{clean_name} ({agent.role}) arrived on the island.")
        return agent

    def remove_agent(self, agent_id: str) -> None:
        if agent_id == "aiden":
            raise ValueError("Cannot remove primary islander Aiden")
        if agent_id not in self.agents:
            raise ValueError("Unknown agent_id")
        removed = self.agents.pop(agent_id)
        self.primary.remember(f"{removed.name} departed the island.")

    def snapshot(self) -> dict:
        return self.snapshot_for_agent("aiden")

    def snapshot_for_agent(self, agent_id: str = "aiden") -> dict:
        next_block = self.next_build()
        crops = self.world.positions(WHEAT)
        focus = self.agents.get(agent_id, self.primary)
        return dict(
            tick=self.tick, day=self.day, time_of_day=self.time_of_day, clock_str=self.clock_str,
            phase=self.phase, weather=self.weather, paused=self.paused, speed=self.speed, seed=self.seed,
            npc=focus.snapshot(),
            agents=[a.snapshot() for a in self.agents.values()],
            stats=dict(
                trees_count=len(self.tree_bases()), house_progress=round(self.house_progress(), 2),
                house_stage=next_block.stage if next_block and self.house_progress() else "not_started" if next_block else "complete",
                house_bounds={"min": xyz((12, 10, 12)), "max": xyz((18, 14, 18))},
                farm_plots=len(self.world.locations[FARMLAND]),
                crops_growing=sum(self.world.get_meta(*p) < 3 for p in crops),
                crops_ripe=sum(self.world.get_meta(*p) == 3 for p in crops),
                blocks_placed=self.blocks_placed, blocks_broken=self.blocks_broken,
                entities_count=len(self.entities),
                agents_count=len(self.agents),
            ),
            entities=[dict(e) for e in self.entities],
            llm_status=dict(focus.llm_status),
        )

    def world_init(self):
        return dict(
            type="world_init", dimensions=dict(width=32, height=24, depth=32),
            index_formula="y * width * depth + z * width + x", blocks=list(self.world.blocks),
            block_meta=list(self.world.meta), palette={str(k): v for k, v in PALETTE.items()}, state=self.snapshot(),
        )

    def change_block(self, p: Pos, block: int, meta: int = 0):
        old = self.world.get(*p)
        if self.world.set(*p, block, meta):
            if old != block:
                if old != AIR:
                    self.blocks_broken += 1
                if block != AIR:
                    self.blocks_placed += 1

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
            soil = (p[0], p[1] - 1, p[2])
            if w.get(*soil) == FARMLAND and w.get_meta(*soil) == 1:
                self.crop_age[p] = self.crop_age.get(p, 0) + dt
                w.set(*p, WHEAT, min(3, int(self.crop_age[p] // 25)))
        for p in list(self.berry_regrowth):
            self.berry_regrowth[p] += dt
            if self.berry_regrowth[p] >= 100:
                if w.get(*p) == AIR and w.get(p[0], p[1] - 1, p[2]) == GRASS:
                    w.set(*p, BERRY)
                del self.berry_regrowth[p]
        occupied_xz = {(a.grid_pos[0], a.grid_pos[2]) for a in self.agents.values()}
        for p in list(self.sapling_age):
            self.sapling_age[p] += dt
            if w.get(*p) != SAPLING:
                del self.sapling_age[p]
            elif self.sapling_age[p] >= 120 and (p[0], p[2]) not in occupied_xz:
                if w.grow_tree(p):
                    del self.sapling_age[p]

    def step(self, dt: float = .1, force: bool = False):
        if self.paused and not force:
            return
        if not 0 < dt <= 5:
            raise ValueError("Simulation step must be in (0, 5] seconds")
        self.tick += 1
        previous_day = self.day
        self.elapsed += dt
        if self.day != previous_day:
            for agent in self.agents.values():
                if agent.last_journal_day < previous_day:
                    agent.write_journal("A new dawn is coming. I am learning how to live on this little island.")
        period = int(self.elapsed // 90)
        if period != self.last_weather_period:
            self.last_weather_period = period
            if not self.weather_override:
                self.weather = self.rng.choices(["clear", "rain", "storm"], [7, 2, 1])[0]
        self.update_ecology(dt)
        self.primary.household.update(dt)
        self.update_entities(dt)
        for agent in list(self.agents.values()):
            agent.step_agent(dt)

    def intervene(self, action: str, value: Any, agent_id: str | None = None):
        if action == "set_time":
            if isinstance(value, dict):
                value = value.get("time_of_day")
            if type(value) not in {float, int} or not math.isfinite(value) or not 0 <= value < 1:
                raise ValueError("set_time value must be a number in [0, 1)")
            self.elapsed = (self.day - 1) * DAY_SECONDS + value * DAY_SECONDS
        elif action == "set_weather":
            if value not in ("clear", "rain", "storm"):
                raise ValueError("set_weather value must be clear, rain or storm")
            self.weather, self.weather_override = value, True
        elif action == "whisper":
            if not isinstance(value, str) or not value.strip() or len(value) > 1000:
                raise ValueError("whisper value must be 1..1000 characters")
            targets = list(self.agents.values()) if agent_id == "all" else [self._resolve_agent(agent_id)]
            for ag in targets:
                ag.remember(f"A whisper from the sky: {value}")
                ag.thought = f"I heard a whisper: {value[:200]}. I will think about it while caring for myself."
        elif action == "heal_npc":
            targets = list(self.agents.values()) if agent_id == "all" else [self._resolve_agent(agent_id)]
            for ag in targets:
                ag.needs = dict.fromkeys(ag.needs, 100.0)
        elif action == "drop_gift":
            gift = value
            if isinstance(value, dict) and "item" in value:
                gift = {value["item"]: value.get("amount", 1)}
            if not isinstance(gift, dict) or not gift or any(k not in INVENTORY_KEYS or type(v) is not int or not 1 <= v <= 1000 for k, v in gift.items()):
                raise ValueError("drop_gift value must map inventory keys to integer amounts 1..1000")
            ag = self._resolve_agent(agent_id)
            for key, amount in gift.items():
                ag.inventory[key] += amount
            ag.remember("A gift arrived from above; I will put it to good use.")
        elif action == "spawn_tree":
            if not isinstance(value, dict) or any(type(value.get(k)) is not int for k in ("x", "z")):
                raise ValueError("spawn_tree value needs integer x,z and optional integer y")
            if "y" in value and type(value["y"]) is not int:
                raise ValueError("Tree y must be an integer")
            x, z = value["x"], value["z"]
            p = (x, value["y"], z) if "y" in value else self.world.feet_at(x, z)
            occupied = {(a.grid_pos[0], a.grid_pos[2]) for a in self.agents.values()}
            if not p or not self.world.inside(*p) or (10 <= x <= 25 and 10 <= z <= 21) or (x, z) in occupied or not self.world.grow_tree(p):
                raise ValueError("Tree needs clear natural ground outside the house/farm clearing")
        elif action == "spawn_object":
            self._intervene_spawn_object(value)
        elif action == "remove_block":
            if not isinstance(value, dict) or any(type(value.get(k)) is not int for k in ("x", "y", "z")):
                raise ValueError("remove_block needs integer x, y, z")
            p = (value["x"], value["y"], value["z"])
            under_feet = {(a.grid_pos[0], a.grid_pos[1] - 1, a.grid_pos[2]) for a in self.agents.values()}
            if p in under_feet or not self.world.inside(*p):
                raise ValueError("Cannot erase block under NPC feet or outside world")
            self.change_block(p, AIR)
        elif action == "spawn_entity":
            self._intervene_spawn_entity(value)
        elif action == "clear_entities":
            self.entities.clear()
        else:
            raise ValueError("Unknown intervention")

    def _resolve_agent(self, agent_id: str | None) -> NpcAgent:
        if agent_id is None:
            return self.primary
        if agent_id not in self.agents:
            raise ValueError(f"Unknown agent_id: {agent_id}")
        return self.agents[agent_id]

    def _find_open_spot(self, preferred: tuple[int, int, int] | None = None) -> Pos | None:
        if preferred and self.world.walkable(preferred):
            return preferred
        if preferred:
            f = self.world.feet_at(preferred[0], preferred[2], preferred[1])
            if f:
                return f
        candidates = []
        gx, gy, gz = self.grid_pos
        for dx in range(-8, 9):
            for dz in range(-8, 9):
                if abs(dx) + abs(dz) < 2:
                    continue
                p = self.world.feet_at(gx + dx, gz + dz, gy)
                if p and self.world.get(*p) == AIR:
                    candidates.append(p)
        return self.rng.choice(candidates) if candidates else None

    def _intervene_spawn_object(self, value: Any) -> None:
        if not isinstance(value, dict):
            raise ValueError("spawn_object requires an object payload")
        obj = value.get("object")
        x, y, z = value.get("x"), value.get("y"), value.get("z")
        has_xz = type(x) is int and type(z) is int
        occupied = {a.grid_pos for a in self.agents.values()}
        if obj == "tree":
            p = (x, y, z) if has_xz and type(y) is int else self.world.feet_at(x, z) if has_xz else self._find_open_spot()
            if not p or p in occupied or not self.world.grow_tree(p):
                raise ValueError("No suitable clear spot for tree")
            return
        if isinstance(obj, int):
            block_id = obj
        elif isinstance(obj, str) and obj in OBJECT_NAME_TO_BLOCK:
            block_id = OBJECT_NAME_TO_BLOCK[obj]
        else:
            raise ValueError("Unsupported world object")
        if has_xz:
            p = (x, y, z) if type(y) is int else self.world.feet_at(x, z)
        else:
            p = self._find_open_spot()
        if not p or not self.world.inside(*p):
            raise ValueError("Target coordinate outside world")
        if p in occupied and block_id not in {AIR, WATER, TORCH, SAPLING, WHEAT, BERRY}:
            raise ValueError("Cannot place solid block onto NPC position")
        if block_id == WHEAT:
            below = (p[0], p[1] - 1, p[2])
            if self.world.get(*below) in {GRASS, DIRT}:
                self.change_block(below, FARMLAND, 1)
            self.change_block(p, WHEAT, int(value.get("meta", 3)) if type(value.get("meta")) is int else 3)
            self.crop_age[p] = 75.0
            return
        if block_id == DOOR:
            self.change_block(p, DOOR)
            if self.world.inside(p[0], p[1] + 1, p[2]) and self.world.get(p[0], p[1] + 1, p[2]) == AIR:
                self.change_block((p[0], p[1] + 1, p[2]), DOOR)
            return
        meta = int(value.get("meta", 1 if block_id == FARMLAND else 0)) if type(value.get("meta")) is int else (1 if block_id == FARMLAND else 0)
        self.change_block(p, block_id, meta)
        if block_id == SAPLING:
            self.sapling_age[p] = 0.0

    def _intervene_spawn_entity(self, value: Any) -> None:
        if not isinstance(value, dict):
            raise ValueError("spawn_entity requires an object payload")
        kind = str(value.get("kind", "cat")).lower()
        if kind not in ENTITY_KINDS:
            raise ValueError(f"kind must be one of {ENTITY_KINDS}")
        if len(self.entities) >= 24:
            raise ValueError("Maximum 24 creatures/companions on this island")
        x, y, z = value.get("x"), value.get("y"), value.get("z")
        pref = (x, y, z) if type(x) is int and type(y) is int and type(z) is int else None
        if not pref and type(x) is int and type(z) is int:
            pref = self.world.feet_at(x, z)
        spot = self._find_open_spot(pref)
        if not spot:
            raise ValueError("No walkable ground available")
        self.entity_counter += 1
        names = ENTITY_DEFAULT_NAMES[kind]
        custom_name = str(value.get("name", "")).strip()[:24]
        name = custom_name or names[(self.entity_counter - 1) % len(names)]
        variant = self.entity_counter % 4
        self.entities.append({
            "id": f"ent-{self.entity_counter}",
            "kind": kind,
            "name": name,
            "variant": variant,
            "position": {"x": float(spot[0]), "y": float(spot[1]), "z": float(spot[2])},
            "grid_pos": xyz(spot),
            "yaw": round(self.rng.uniform(0, math.tau), 3),
            "animation": "idle",
            "target": None,
            "wait": self.rng.uniform(0.6, 2.2),
        })
        self.primary.remember(f"A {kind} named {name} appeared on the island.")

    def update_entities(self, dt: float) -> None:
        for ent in self.entities:
            pos = ent["position"]
            gx, gy, gz = ent["grid_pos"]["x"], ent["grid_pos"]["y"], ent["grid_pos"]["z"]
            target = ent.get("target")
            if target is None:
                ent["wait"] = max(0.0, ent.get("wait", 0.0) - dt)
                if ent["wait"] <= 0:
                    neighbors = []
                    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)):
                        p = self.world.feet_at(gx + dx, gz + dz, gy)
                        if p and abs(p[1] - gy) <= 1:
                            if ent["kind"] == "duck" and self.world.get(p[0], p[1] - 1, p[2]) == WATER:
                                neighbors.append(p)
                            elif self.world.walkable(p):
                                neighbors.append(p)
                    if neighbors:
                        ent["target"] = list(self.rng.choice(neighbors))
                        ent["animation"] = "walking"
                    else:
                        ent["wait"] = 1.5
                        ent["animation"] = "idle"
                else:
                    ent["animation"] = "grazing" if ent["kind"] in {"sheep", "deer"} and ent["wait"] > 1.0 else "sitting" if ent["kind"] == "cat" and ent["wait"] > 1.2 else "idle"
                continue

            tx, ty, tz = target
            dx = tx - pos["x"]
            dy = ty - pos["y"]
            dz = tz - pos["z"]
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            speed = 1.85 if ent["kind"] in {"fox", "deer"} else 1.55 if ent["kind"] in {"companion", "villager"} else 1.25
            step_d = speed * dt
            if dist > 0.01:
                ent["yaw"] = round(math.atan2(dx, dz), 3)
            if dist <= step_d:
                pos["x"], pos["y"], pos["z"] = float(tx), float(ty), float(tz)
                ent["grid_pos"] = {"x": int(tx), "y": int(ty), "z": int(tz)}
                ent["target"] = None
                ent["wait"] = self.rng.uniform(0.8, 3.2)
                ent["animation"] = "idle"
            else:
                pos["x"] = round(pos["x"] + dx / dist * step_d, 4)
                pos["y"] = round(pos["y"] + dy / dist * step_d, 4)
                pos["z"] = round(pos["z"] + dz / dist * step_d, 4)
                ent["animation"] = "walking"

    def export_save(self) -> dict:
        """Export the full simulation state for durable save-file persistence."""
        return {
            "save_version": 1,
            "seed": int(self.seed),
            "tick": int(self.tick),
            "elapsed": round(float(self.elapsed), 4),
            "paused": bool(self.paused),
            "speed": int(self.speed),
            "weather": self.weather,
            "weather_override": bool(self.weather_override),
            "blocks_placed": int(self.blocks_placed),
            "blocks_broken": int(self.blocks_broken),
            "last_weather_period": int(self.last_weather_period),
            "entity_counter": int(self.entity_counter),
            "agent_counter": int(self.agent_counter),
            "world": self.world.export_state(),
            "home": self.home.export_state(),
            "crop_age": _encode_pos_map(self.crop_age),
            "wet_age": _encode_pos_map(self.wet_age),
            "berry_regrowth": _encode_pos_map(self.berry_regrowth),
            "sapling_age": _encode_pos_map(self.sapling_age),
            "entities": [
                {
                    **e,
                    "position": dict(e["position"]),
                    "grid_pos": dict(e["grid_pos"]),
                    "target": list(e["target"]) if e.get("target") else None,
                }
                for e in self.entities
            ],
            "agents": [agent.export_save() for agent in self.agents.values()],
        }

    @classmethod
    def from_save(cls, data: dict) -> Simulation:
        """Restore a full Simulation instance from exported save data."""
        if not isinstance(data, dict) or not isinstance(data.get("world"), dict):
            raise ValueError("Invalid save file: missing world payload")

        sim = cls.__new__(cls)
        sim.seed = int(data.get("seed", 66))
        sim.tick = max(0, int(data.get("tick", 0)))
        sim.rng = random.Random(sim.seed + 731 + sim.tick)
        sim.world = World.from_state(data["world"])
        sim.elapsed = max(0.0, float(data.get("elapsed", DAY_SECONDS * 0.26)))
        sim.paused = bool(data.get("paused", False))
        raw_speed = int(data.get("speed", 1))
        sim.speed = raw_speed if raw_speed in {1, 2, 5} else 1
        raw_weather = str(data.get("weather", "clear"))
        sim.weather = raw_weather if raw_weather in {"clear", "rain", "storm"} else "clear"
        sim.weather_override = bool(data.get("weather_override", False))
        sim.blueprint = house_blueprint()
        sim.farm_sites = [(x, 10, z) for x in (19, 20) for z in range(18, 22)]
        sim.crop_age = _decode_pos_map(data.get("crop_age", []))
        sim.wet_age = _decode_pos_map(data.get("wet_age", []))
        sim.berry_regrowth = _decode_pos_map(data.get("berry_regrowth", []))
        sim.sapling_age = _decode_pos_map(data.get("sapling_age", []))
        sim.blocks_placed = max(0, int(data.get("blocks_placed", 0)))
        sim.blocks_broken = max(0, int(data.get("blocks_broken", 0)))
        sim.last_weather_period = int(data.get("last_weather_period", int(sim.elapsed // 90)))
        sim.entities = []
        for e in data.get("entities", []):
            if not isinstance(e, dict) or not isinstance(e.get("position"), dict) or not isinstance(e.get("grid_pos"), dict):
                continue
            sim.entities.append({
                "id": str(e.get("id", f"ent-{len(sim.entities) + 1}")),
                "kind": str(e.get("kind", "cat")),
                "name": str(e.get("name", "Companion"))[:24],
                "variant": int(e.get("variant", 0)),
                "position": {k: float(e["position"][k]) for k in ("x", "y", "z")},
                "grid_pos": {k: int(e["grid_pos"][k]) for k in ("x", "y", "z")},
                "yaw": float(e.get("yaw", 0.0)),
                "animation": str(e.get("animation", "idle")),
                "target": list(e["target"]) if isinstance(e.get("target"), (list, tuple)) and len(e["target"]) == 3 else None,
                "wait": float(e.get("wait", 1.0)),
            })
        sim.entity_counter = max(len(sim.entities), int(data.get("entity_counter", len(sim.entities))))
        sim.agent_counter = max(1, int(data.get("agent_counter", 1)))
        sim.home = HomeState.from_state(data.get("home", {}))
        sim.agents = {}
        for agent_data in data.get("agents", []):
            if not isinstance(agent_data, dict):
                continue
            agent = NpcAgent.from_save(sim, agent_data)
            sim.agents[agent.id] = agent
        if "aiden" not in sim.agents:
            raise ValueError("Invalid save file: primary islander 'aiden' missing")
        sim.agent_counter = max(sim.agent_counter, len(sim.agents))
        return sim
