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
    World, WORLD_PRESETS, VALID_BIOMES, Pos, PALETTE, AIR, GRASS, DIRT, STONE, WATER, LOG, LEAVES,
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
             "refill": 4, "stoke": 2, "store": 2, "take": 2, "fertilize": 2,
             "study_gate": 3, "build_gate": 1.2, "hunt": 2.2, "attack": 1.2}
ANIMATION = {"chop": "chopping", "mine": "mining", "build": "building", "till": "tilling",
             "plant": "planting", "plant_sapling": "planting", "water": "watering",
             "harvest": "harvesting", "forage": "harvesting", "eat": "eating",
             "drink": "drinking", "sleep": "sleeping", "craft": "building", "journal": "thinking",
             "gather": "harvesting", "furnish": "building", "repair": "building", "clean": "tilling",
             "wash": "watering", "refill": "watering", "stoke": "building", "store": "building", "take": "building", "fertilize": "tilling",
             "study_gate": "thinking", "build_gate": "building", "hunt": "hunting", "attack": "hunting"}

WEAPON_DAMAGE: dict[str, float] = {
    "iron_sword": 36.0,
    "hunting_bow": 26.0,
    "wooden_spear": 22.0,
}

HUNTABLE_KINDS = {"deer", "fox", "sheep", "duck"}
HUNT_LOOT: dict[str, dict[str, int]] = {
    "deer": {"raw_meat": 3, "hide": 2},
    "sheep": {"raw_meat": 2, "hide": 1, "cloth": 1},
    "fox": {"raw_meat": 1, "hide": 2},
    "duck": {"raw_meat": 1, "feather": 3},
}


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
    surface_material: str = ""


def gate_blueprint() -> list[BlueprintBlock]:
    return [
        BlueprintBlock((10, 11, 14), STONE, "gate_base", "obsidian", 1, "obsidian"),
        BlueprintBlock((10, 11, 16), STONE, "gate_base", "obsidian", 1, "obsidian"),
        BlueprintBlock((10, 12, 14), STONE, "gate_columns", "marble", 1, "marble"),
        BlueprintBlock((10, 12, 16), STONE, "gate_columns", "marble", 1, "marble"),
        BlueprintBlock((10, 13, 14), STONE, "gate_conduit", "crystal", 1, "crystal_vein"),
        BlueprintBlock((10, 13, 16), STONE, "gate_conduit", "crystal", 1, "crystal_vein"),
        BlueprintBlock((10, 13, 15), STONE, "gate_core", "sunstone", 1, "sunstone"),
    ]


GATE_RUNE_ANSWERS: dict[str, tuple[str, str]] = {
    "anchor": ("obsidian", "Anchored! Obsidian resists the gravitational shear of sky portals."),
    "conduit": ("crystal", "Unlocked! Polished White Marble columns topped with Crystal Veins channel energy."),
    "core": ("sunstone", "Deciphered! A radiant Sunstone keystone completes the portal circuit (craft from Crystal + Gold Ore)."),
}


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
        self.hostile_target: str | None = None
        self.threatened_by: str | None = None
        self.under_attack_until: float = 0.0
        self.llm_status = dict(
            provider="fallback", model="", thinking=False, last_latency_ms=0,
            calls_count=0, fallback_active=True, last_error=None, locked=False,
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
                agent_id=peer.id,
                health=round(peer.needs["health"], 1),
                label=f"{peer.name} ({peer.role})",
                position=xyz(peer.grid_pos),
                distance=round(distance(self.position, peer.position), 2),
            ))
        for e in sorted(self.sim.entities, key=lambda e: distance(self.position, (e["position"]["x"], e["position"]["y"], e["position"]["z"])))[:4]:
            ep = (e["position"]["x"], e["position"]["y"], e["position"]["z"])
            nearby.append(dict(type=e["kind"], label=f"{e['name']} ({e['kind']})", position=e["grid_pos"], distance=round(distance(self.position, ep), 2)))
        for d in sorted(self.sim.dropped_items, key=lambda d: distance(self.position, (d["position"]["x"], d["position"]["y"], d["position"]["z"])))[:3]:
            dp = (d["position"]["x"], d["position"]["y"], d["position"]["z"])
            nearby.append(dict(
                type="dropped_item",
                label=f"{d['amount']}x {d['item'].replace('_', ' ')} ({'landed' if d['landed'] else 'falling'})",
                position=d["grid_pos"],
                distance=round(distance(self.position, dp), 2),
            ))
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
            weapons={k: dict(durability=v, owned=self.inventory[k]) for k, v in self.household.weapons.items()},
            hostile_target=self.hostile_target,
            threatened_by=self.threatened_by if self.sim.elapsed < self.under_attack_until else None,
        )

    def export_save(self) -> dict:
        """Serialize individual NPC body state, needs, inventory, tools, weapons, memories and journal."""
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
            "weapons": {k: round(float(v), 3) for k, v in self.household.weapons.items()},
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
        for k, v in (data.get("weapons") or {}).items():
            if k in agent.household.weapons:
                agent.household.weapons[k] = float(v)
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
                if self.id == self.sim.primary_id and self.sim.biome == "homestead":
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
            food = "cooked_meat" if inv["cooked_meat"] else "bread" if inv["bread"] else "berries"
            return inv[food] > 0 and self.make_job(action, food=food)
        if action == "hunt":
            weapon = self.household.active_weapon()
            if not weapon:
                return False
            req_kind = str(params.get("kind", "")).strip().lower()
            req_id = str(params.get("entity_id", "")).strip()
            prey = [
                e for e in self.sim.entities
                if e.get("kind") in HUNTABLE_KINDS
                and (not req_kind or e.get("kind") == req_kind)
                and (not req_id or e.get("id") == req_id)
            ]
            if not prey:
                return False
            prey.sort(key=lambda e: distance(self.position, (e["grid_pos"]["x"], e["grid_pos"]["y"], e["grid_pos"]["z"])))
            reach_hunt = 3 if weapon == "hunting_bow" else 2
            for ent in prey:
                pos = (int(ent["grid_pos"]["x"]), int(ent["grid_pos"]["y"]), int(ent["grid_pos"]["z"]))
                path = self.approach(pos, reach=reach_hunt, avoid_target=False)
                if path is not None:
                    return self.make_job("hunt", pos, path, entity_id=ent["id"], kind=ent["kind"], weapon=weapon)
            return False
        if action == "attack":
            req_id = str(params.get("target_id", "")).strip()
            req_name = str(params.get("target_name", "")).strip().lower()
            target_agent = None
            if req_id and req_id in self.sim.agents and req_id != self.id:
                target_agent = self.sim.agents[req_id]
            elif req_name:
                target_agent = next(
                    (a for a in self.sim.agents.values() if a.id != self.id and req_name in a.name.lower()),
                    None,
                )
            elif len(self.sim.agents) > 1:
                others = [a for a in self.sim.agents.values() if a.id != self.id]
                others.sort(key=lambda a: distance(self.position, a.position))
                target_agent = others[0] if others else None
            if not target_agent:
                return False
            weapon = self.household.active_weapon()
            reach_atk = 3 if weapon == "hunting_bow" else 1
            path = self.approach(target_agent.grid_pos, reach=reach_atk, avoid_target=False)
            if path is None:
                return False
            if params.get("_dry_run"):
                return True
            # Alert target immediately so they interrupt non-combat work and defend themselves
            target_agent.threatened_by = self.id
            target_agent.under_attack_until = self.sim.elapsed + 25.0
            if target_agent.current_action != "attack" or not target_agent.job or target_agent.job["params"].get("target_id") != self.id:
                target_agent.thought = f"{self.name} is coming for me! I will defend myself!"
                target_agent.remember(f"{self.name} threatened me; preparing to fight back.")
                if target_agent.current_action != "attack" or not target_agent.job:
                    target_agent.job = None
                    target_agent.defend_against(self.id)
            return self.make_job("attack", target_agent.grid_pos, path, target_id=target_agent.id, weapon=weapon)
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
            reserved |= {b.pos for b in self.sim.gate_blueprint} | {(10, 10, 14), (10, 10, 15), (10, 10, 16)}
            candidates = [p for p in w.positions(STONE) if p[1] >= 10
                          and p not in reserved
                          and p != (self.grid_pos[0], self.grid_pos[1] - 1, self.grid_pos[2])
                          and any(w.get(p[0]+dx, p[1], p[2]+dz) == AIR for dx, dz in ((1,0),(-1,0),(0,1),(0,-1))) ]
            avoid = True
        elif action == "study_gate":
            if self.sim.world_id != "homestead" or self.sim.gate_discovered:
                return False
            result = self.nearest_reachable([(10, 11, 15)], 2, avoid_target=True)
            if not result:
                return False
            return self.make_job(action, *result)
        elif action == "build_gate":
            if self.sim.world_id != "homestead" or not self.sim.gate_discovered:
                return False
            b = self.sim.next_gate_block()
            if not b or inv.get(b.material, 0) < b.amount:
                return False
            result = self.nearest_reachable([b.pos], 3, avoid_target=True)
            if not result:
                return False
            return self.make_job(action, *result, blueprint=b)
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

    def defend_against(self, attacker_id: str) -> bool:
        attacker = self.sim.agents.get(attacker_id)
        if not attacker or attacker.id == self.id:
            return False
        self.threatened_by = attacker_id
        self.under_attack_until = self.sim.elapsed + 25.0
        weapon = self.household.active_weapon()
        reach_def = 3 if weapon == "hunting_bow" else 1
        path = self.approach(attacker.grid_pos, reach=reach_def, avoid_target=False)
        if path is None:
            return False
        return self.make_job("attack", attacker.grid_pos, path, target_id=attacker.id, weapon=weapon, defensive=True)

    def can_start(self, action: str, params: dict) -> bool:
        saved = (self.job,self.current_action,self.target,self.path,self.progress,self.animation)
        rng_state = self.sim.rng.getstate()
        try:
            test_params = {**params, "_dry_run": True} if action == "attack" else params
            return bool(self.start_action(action, test_params))
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

    def choose_gate_progression(self) -> bool:
        sim = self.sim
        if sim.world_id != "homestead" or sim.gate_unlocked:
            return False
        if not sim.gate_discovered:
            return self.choose(
                "study_gate",
                "I noticed glowing runes carved into the West Clearing stone plinth. I'll examine and decipher them myself!",
                "Decipher Sky Teleport Gate runes",
            )
        nxt = sim.next_gate_block()
        if not nxt:
            return False
        inv = self.inventory
        if inv.get(nxt.material, 0) >= nxt.amount:
            return self.choose(
                "build_gate",
                f"Fitting {nxt.surface_material.replace('_', ' ')} into the Sky Teleport Gate arch.",
                "Build Sky Teleport Gate",
            )
        if nxt.material == "sunstone":
            if inv.get("crystal", 0) >= 1 and inv.get("gold_ore", 0) >= 1:
                return self.choose(
                    "craft",
                    "I solved the keystone schematic—fusing Crystal and Gold Ore into a radiant Sunstone core!",
                    "Craft Sunstone keystone",
                    recipe="sunstone",
                )
            need_res = "gold_ore" if inv.get("gold_ore", 0) < 1 else "crystal"
            return self.choose(
                "gather",
                f"Gathering {need_res.replace('_', ' ')} from island outcrops to craft the Sunstone keystone.",
                f"Gather {need_res.replace('_', ' ')}",
                resource=need_res,
            )
        return self.choose(
            "gather",
            f"Mining {nxt.material.replace('_', ' ')} from island veins for the Sky Teleport Gate.",
            f"Gather {nxt.material.replace('_', ' ')}",
            resource=nxt.material,
        )

    def choose_fallback(self):
        n, inv = self.needs, self.inventory
        sim = self.sim
        # Self-defense and explicit combat orders take priority over chores & queued LLM actions
        if self.threatened_by and self.sim.elapsed < self.under_attack_until:
            attacker = sim.agents.get(self.threatened_by)
            if attacker and attacker.id != self.id:
                if self.defend_against(attacker.id):
                    self.current_goal = f"Defend myself against {attacker.name}"
                    return
            else:
                self.threatened_by = None
        if self.hostile_target:
            target = sim.agents.get(self.hostile_target)
            if target and target.id != self.id and self.start_action("attack", {"target_id": target.id}):
                self.current_goal = f"Attack {target.name}"
                return
            if not target:
                self.hostile_target = None
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
        if sim.biome == "market":
            spots = [(16, 11, 19), (9, 11, 11), (22, 11, 11), (22, 11, 18), (13, 11, 16), (16, 11, 22)]
            target_spot = spots[(sim.tick // 80 + self.variant + (2 if self.id == "aiden" else 0)) % len(spots)]
            if inv["berries"] > 0 and self.needs["hunger"] < 50 and self.choose("eat", "Enjoying a sweet market snack.", "Snack at the bazaar", food="berries"):
                return
            if self.grid_pos != target_spot and self.choose(
                "walk",
                "Trading my weekly crops and goods with the Sky Market merchants." if self.id == "aiden" else "Strolling past the Sky Market stalls and greeting visitors.",
                "Trade at Sky Market" if self.id == "aiden" else "Browse market stalls",
                x=target_spot[0], y=target_spot[1], z=target_spot[2],
            ):
                return
            self.choose(
                "idle",
                "Negotiating prices with Lyra, Milo, Suki, and Bram." if self.id == "aiden" else "Checking prices and rare crafts at the Sky Market.",
                "Market trade" if self.id == "aiden" else "Window shop",
            )
            return
        if self.household.choose_maintenance():
            return

        # Secondary role specializations
        if self.role == "explorer":
            if self.choose_gate_progression():
                return
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

        if inv["raw_meat"] >= 1 and inv["cooked_meat"] < 4:
            if self.choose("craft", "I have raw meat ready to roast into a warm meal.", "Cook meat", recipe="cooked_meat"):
                return
        if self.needs["hunger"] < 65 or (inv["berries"] + inv["bread"] + inv["cooked_meat"]) < 3:
            has_prey = any(e.get("kind") in HUNTABLE_KINDS for e in sim.entities)
            if has_prey:
                weapon = self.household.active_weapon()
                if weapon and self.choose("hunt", f"Using my {weapon.replace('_', ' ')} to hunt wild game.", "Hunt wildlife"):
                    return
                if not weapon and inv["wood_log"] >= 1 and inv["stone"] >= 1:
                    if self.choose("craft", "I will craft a wooden spear so I can hunt wildlife.", "Craft hunting spear", recipe="wooden_spear"):
                        return
        if not self.explored and self.choose("explore", "I will check the clearing and the pond before choosing where to settle.", "Explore the island"):
            return
        if inv["berries"] < 6 and self.choose("forage", "A few berries in my pocket will make building less precarious.", "Stock a little food"):
            return
        if self.choose_gate_progression():
            return
        if sim.dropped_items:
            landed_drops = [d for d in sim.dropped_items if d.get("landed")]
            for drop in sorted(
                landed_drops,
                key=lambda d: distance(self.position, (d["position"]["x"], d["position"]["y"], d["position"]["z"])),
            )[:3]:
                gx, gy, gz = int(drop["grid_pos"]["x"]), int(drop["grid_pos"]["y"]), int(drop["grid_pos"]["z"])
                walk_spot = sim.world.feet_at(gx, gz, gy) or (gx, gy, gz)
                if sim.world.walkable(walk_spot) and self.choose(
                    "walk",
                    f"I see {drop['amount']}x {drop['item'].replace('_', ' ')} landed on the island. I'll go pick it up!",
                    "Collect sky-dropped gift",
                    x=walk_spot[0], y=walk_spot[1], z=walk_spot[2],
                ):
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
            gain = 55 if params["food"] == "cooked_meat" else 38 if params["food"] == "bread" else 18
            self.needs["hunger"] = min(100, self.needs["hunger"] + gain)
            self.needs["mood"] = min(100, self.needs["mood"] + (5 if params["food"] == "cooked_meat" else 2))
        elif action == "hunt":
            eid = params.get("entity_id")
            ent = next((e for e in sim.entities if e.get("id") == eid), None)
            if ent and ent.get("kind") in HUNTABLE_KINDS:
                sim.entities = [e for e in sim.entities if e.get("id") != eid]
                drops = dict(HUNT_LOOT.get(ent["kind"], {"raw_meat": 1}))
                weapon = params.get("weapon")
                if weapon == "iron_sword":
                    drops["raw_meat"] = drops.get("raw_meat", 0) + 1
                for k, amt in drops.items():
                    if k in inv:
                        inv[k] += amt
                self.household.wear_weapon(weapon)
                self.needs["mood"] = min(100, self.needs["mood"] + 5)
                loot_str = ", ".join(f"+{v} {k.replace('_', ' ')}" for k, v in drops.items())
                self.remember(f"Hunted a {ent['kind']} using {(weapon or 'weapon').replace('_', ' ')} ({loot_str}).")
                self.thought = f"Successful hunt! Gathered {loot_str}."
        elif action == "attack":
            tid = params.get("target_id")
            defender = sim.agents.get(tid) if tid else None
            if not defender or defender.id == self.id:
                self.hostile_target = None
                self.threatened_by = None
            else:
                weapon = self.household.active_weapon() or params.get("weapon")
                max_range = 4.5 if weapon == "hunting_bow" else 3.2
                if distance(self.position, defender.position) <= max_range:
                    if weapon in WEAPON_DAMAGE:
                        base_dmg = WEAPON_DAMAGE[weapon]
                    elif inv.get("axe", 0) > 0:
                        base_dmg = 16.0
                    elif inv.get("pickaxe", 0) > 0:
                        base_dmg = 14.0
                    else:
                        base_dmg = 12.0
                    # Defender actively countering mitigates 20% incoming hit damage
                    defending_stance = defender.threatened_by == self.id and defender.current_action == "attack"
                    dmg = round(base_dmg * (0.8 if defending_stance else 1.0), 1)
                    defender.needs["health"] = max(0.0, defender.needs["health"] - dmg)
                    defender.needs["mood"] = max(0.0, defender.needs["mood"] - 4.0)
                    defender.threatened_by = self.id
                    defender.under_attack_until = sim.elapsed + 25.0
                    if weapon in WEAPON_DAMAGE:
                        self.household.wear_weapon(weapon)
                    w_label = (weapon or "fists").replace("_", " ")
                    self.remember(f"Struck {defender.name} with {w_label} ({int(dmg)} dmg).")
                    defender.remember(f"{self.name} hit me for {int(dmg)} dmg! Defending myself.")
                    defender.thought = f"Taking hits from {self.name}! Fighting back!"
                    if defender.current_action != "attack":
                        defender.job = None
                        defender.defend_against(self.id)

                    if defender.needs["health"] <= 0:
                        for item_k, amt in list(defender.inventory.items()):
                            if amt > 0:
                                inv[item_k] = inv.get(item_k, 0) + amt
                                defender.inventory[item_k] = 0
                        self.hostile_target = None
                        self.threatened_by = None
                        defender.hostile_target = None
                        defender.threatened_by = None
                        if defender.id != sim.primary_id:
                            sim.agents.pop(defender.id, None)
                            for peer in sim.agents.values():
                                if peer.hostile_target == defender.id:
                                    peer.hostile_target = None
                                if peer.threatened_by == defender.id:
                                    peer.threatened_by = None
                            self.remember(f"Defeated {defender.name} and claimed their gear.")
                            self.thought = f"{defender.name} is defeated."
                        else:
                            defender.needs["health"] = 25.0
                            defender.position = [16.0, 11.0, 20.0]
                            defender.grid_pos = (16, 11, 20)
                            defender.job, defender.target, defender.path = None, None, []
                            defender.animation, defender.current_action = "idle", "idle"
                            defender.thought = f"I was defeated by {self.name} and barely recovered!"
                            self.remember(f"Knocked out {defender.name} and took their supplies.")
                            self.thought = f"Overpowered {defender.name}!"
                else:
                    self.thought = f"Chasing {defender.name}!"
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
        elif action == "study_gate":
            for rune in ("anchor", "conduit", "core"):
                if not sim.gate_clues.get(rune):
                    sim.gate_clues[rune] = True
                    msg = GATE_RUNE_ANSWERS[rune][1]
                    self.remember(f"Teleport Ruin Study: {msg}")
                    self.thought = msg
                    if sim.gate_discovered:
                        self.write_journal("I deciphered the Ancient Teleport Gate! Frame: Obsidian pillars, Marble columns, Crystal conduits, and a Sunstone keystone.")
                    break
        elif action == "build_gate":
            b = params["blueprint"]
            if not sim.gate_block_matches(b) and inv.get(b.material, 0) >= b.amount:
                inv[b.material] -= b.amount
                sim.change_block(b.pos, b.block, material=b.surface_material)
                self.remember(f"Placed {b.surface_material.replace('_', ' ')} on the Sky Teleport Gate.")
                if sim.gate_unlocked:
                    self.remember("The Sky Teleport Gate hums with blue-gold portal light! Sky Market is open.")
                    self.thought = "The Sky Teleport Gate is awake! We can visit Sky Market!"
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
    def __init__(self, seed: int = 66, biome: str = "homestead", coins: int = 250,
                 world_id: str | None = None, world_name: str | None = None):
        self.seed, self.rng = seed, random.Random(seed + 731)
        self.biome = biome if biome in VALID_BIOMES else "homestead"
        self.world_id = (world_id or self.biome).strip().lower()
        default_name = "Homestead" if self.world_id == "homestead" else "Market" if self.world_id == "market" else WORLD_PRESETS[self.biome]["label"]
        self.world_name = (world_name or default_name).strip()[:40] or default_name
        self.coins = max(0, int(coins))
        self.world = World(seed, biome=self.biome)
        self.tick, self.elapsed = 0, DAY_SECONDS * .26
        self.paused, self.speed, self.weather = False, 1, "clear"
        self.weather_override = False
        self.blueprint = [] if self.biome == "market" else house_blueprint()
        self.gate_blueprint = gate_blueprint() if self.world_id == "homestead" else []
        self.gate_clues: dict[str, bool] = (
            {"anchor": False, "conduit": False, "core": False}
            if self.world_id == "homestead"
            else {"anchor": True, "conduit": True, "core": True}
        )
        self.farm_sites = [] if self.biome == "market" else [(x, 10, z) for x in (19, 20) for z in range(18, 22)]
        self.crop_age: dict[Pos, float] = {}
        self.wet_age: dict[Pos, float] = {}
        self.berry_regrowth: dict[Pos, float] = {}
        self.sapling_age: dict[Pos, float] = {}
        self.blocks_placed, self.blocks_broken = 0, 0
        self.last_weather_period = int(self.elapsed // 90)
        self.entities: list[dict] = []
        self.entity_counter = 0
        self.dropped_items: list[dict] = []
        self.dropped_item_counter = 0
        self.last_market_day = 0
        self._away_stub: NpcAgent | None = None
        self.agent_counter = 1
        self.home = HomeState()
        start = (16, 11, 22) if self.biome == "market" else (self.world.feet_at(16, 20) or (16, 11, 20))
        resident_map = {
            "market": ("lyra", "Lyra", "explorer", 2),
            "alpine_peaks": ("torin", "Torin", "explorer", 1),
            "sakura_grove": ("kaori", "Kaori", "forager", 2),
            "crystal_canyon": ("cyrus", "Cyrus", "builder", 3),
            "obsidian_caldera": ("ember", "Ember", "builder", 4),
            "flat_sandbox": ("rowan", "Rowan", "pioneer", 1),
        }
        if self.world_id == "homestead":
            rid, rname, rrole, rvar = "aiden", "Aiden", "pioneer", 0
        else:
            rid, rname, rrole, rvar = resident_map.get(self.biome, ("sol", "Sol", "pioneer", 1))
        self.agents: dict[str, NpcAgent] = {
            rid: NpcAgent(self, rid, rname, role=rrole, variant=rvar, start_pos=start),
        }
        if self.biome == "market":
            self.primary.current_goal = "Tend the Sky Market stalls and greet traders"
            self.primary.thought = f"I am {self.primary.name}, steward of the Sky Market! Everything runs smoothly here."
            self.primary.remember("Opened the floating Sky Market plaza for trade.")
            self._seed_market_merchants()
        elif self.world_id != "homestead":
            preset_label = WORLD_PRESETS[self.biome]["label"]
            self.primary.current_goal = f"Explore {self.world_name} and gather resources"
            self.primary.thought = f"I live in {self.world_name} ({preset_label}). Time to explore my own island!"
            self.primary.remember(f"Awakened as an independent resident of '{self.world_name}' ({preset_label}).")

    def _seed_market_merchants(self) -> None:
        # Autonomous AI merchants & bazaar regulars living in the Sky Market world
        resident_roster = [
            ("milo", "Milo", "farmer", 0, (10, 11, 10), "Manage bakery & crop trade stall"),
            ("suki", "Suki", "builder", 1, (21, 11, 10), "Appraise gems, marble, and sky ore"),
            ("bram", "Bram", "forager", 3, (21, 11, 20), "Trade timber, berries, and island crafts"),
            ("vesper", "Vesper", "pioneer", 4, (13, 11, 16), "Welcome traders and browse the plaza"),
        ]
        for mid, mname, mrole, mvar, spot, mgoal in resident_roster:
            pos = spot if self.world.walkable(spot) else (self._find_open_spot(spot) or (16, 11, 18))
            npc = NpcAgent(self, mid, mname, role=mrole, variant=mvar, start_pos=pos)
            npc.current_goal = mgoal
            npc.thought = f"I'm {mname}, working at the Sky Market bazaar!"
            npc.remember(f"Set up my trade station at Sky Market as {mrole}.")
            self.agents[mid] = npc
        self.agent_counter = max(self.agent_counter, len(self.agents))

        stalls = [
            ("villager", "Baker Pip", (9, 11, 9), 0, 0.0),
            ("villager", "Jeweler Kai", (22, 11, 9), 1, 0.0),
            ("villager", "Artisan Nora", (22, 11, 21), 2, 0.0),
            ("cat", "Mochi", (14, 11, 14), 0, 0.8),
            ("duck", "Puddle", (15, 11, 16), 3, 2.2),
            ("fox", "Maple", (18, 11, 15), 1, 1.4),
        ]
        for kind, name, pos, variant, yaw in stalls:
            if not self.world.walkable(pos):
                pos = self._find_open_spot(pos) or (16, 11, 18)
            self.entity_counter += 1
            self.entities.append({
                "id": f"ent-{self.entity_counter}",
                "kind": kind,
                "name": name,
                "variant": variant,
                "position": {"x": float(pos[0]), "y": float(pos[1]), "z": float(pos[2])},
                "grid_pos": xyz(pos),
                "yaw": yaw,
                "animation": "idle",
                "target": None,
                "wait": 2.0,
            })

    @property
    def primary_id(self) -> str:
        if self.biome != "market" and "aiden" in self.agents:
            return "aiden"
        if self.agents:
            return next(iter(self.agents.keys()))
        return "aiden"

    @property
    def primary(self) -> NpcAgent:
        if self.agents:
            return self.agents[self.primary_id]
        if self._away_stub is None:
            self._away_stub = NpcAgent(self, "aiden", "Aiden", role="pioneer", variant=0, start_pos=(10, 11, 15))
            self._away_stub.current_action = "visiting_market"
            self._away_stub.current_goal = "Trading weekly crops and products at Sky Market"
            self._away_stub.thought = "Visited Sky Market for my weekly 7-day trade!"
        return self._away_stub

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
        if not self.blueprint:
            return 100.0
        return 100 * sum(self.blueprint_matches(b) for b in self.blueprint) / len(self.blueprint)

    def gate_block_matches(self, b: BlueprintBlock) -> bool:
        if self.world.get(*b.pos) != b.block:
            return False
        if b.surface_material:
            return self.world.materials[self.world.index(*b.pos)] == b.surface_material
        return True

    def next_gate_block(self) -> BlueprintBlock | None:
        return next((b for b in self.gate_blueprint if not self.gate_block_matches(b)), None)

    @property
    def gate_discovered(self) -> bool:
        return self.world_id != "homestead" or all(self.gate_clues.values())

    def gate_progress(self) -> float:
        if not self.gate_blueprint:
            return 100.0
        return 100.0 * sum(self.gate_block_matches(b) for b in self.gate_blueprint) / len(self.gate_blueprint)

    @property
    def gate_unlocked(self) -> bool:
        return self.world_id != "homestead" or self.gate_progress() >= 100.0

    def decipher_gate_rune(self, rune: str, answer: str) -> tuple[bool, str]:
        rune_key = rune.strip().lower()
        if rune_key not in GATE_RUNE_ANSWERS:
            raise ValueError("Unknown gate rune")
        expected, success_msg = GATE_RUNE_ANSWERS[rune_key]
        clean = answer.strip().lower()
        if clean == expected:
            self.gate_clues[rune_key] = True
            self.primary.remember(f"Deciphered Teleport Gate rune ({rune_key}): {expected}.")
            return True, success_msg
        hints = {
            "anchor": "Hint: Look for dark volcanic stone mined from deep rock strata or coastal outcrops.",
            "conduit": "Hint: Combine luminous blue cavern gems (Crystal) paired with pale sculpted stone pillars.",
            "core": "Hint: Look for the warm radiant stone crafted from Crystal + Gold Ore.",
        }
        return False, hints[rune_key]

    def assemble_gate_block(self, agent_id: str | None = None) -> BlueprintBlock:
        if not self.gate_discovered:
            raise ValueError("Decipher all 3 Teleport Gate runes first before building.")
        b = self.next_gate_block()
        if not b:
            raise ValueError("Teleport Gate is already complete!")
        ag = self._resolve_agent(agent_id)
        have = ag.inventory.get(b.material, 0)
        if have < b.amount:
            raise ValueError(f"{ag.name} needs {b.amount} {b.material.replace('_', ' ')} (has {have}). Gather from island outcrops or study clues.")
        ag.inventory[b.material] -= b.amount
        self.change_block(b.pos, b.block, material=b.surface_material)
        ag.remember(f"Assembled {b.surface_material.replace('_', ' ')} onto the Sky Teleport Gate.")
        if self.gate_unlocked:
            ag.thought = "The Sky Teleport Gate is alive! We can travel to the Sky Market!"
        return b

    def gate_snapshot(self) -> dict:
        remaining: dict[str, int] = {}
        for b in self.gate_blueprint:
            if not self.gate_block_matches(b):
                remaining[b.material] = remaining.get(b.material, 0) + b.amount
        nxt = self.next_gate_block()
        return {
            "discovered": self.gate_discovered,
            "unlocked": self.gate_unlocked,
            "progress": round(self.gate_progress(), 1),
            "clues": dict(self.gate_clues),
            "built_count": sum(self.gate_block_matches(b) for b in self.gate_blueprint),
            "total_count": len(self.gate_blueprint),
            "missing_items": remaining,
            "next_material": nxt.material if nxt else None,
            "next_surface": nxt.surface_material if nxt else None,
            "position": xyz((10, 11, 15)),
        }

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
        if agent_id == self.primary_id:
            raise ValueError(f"Cannot remove primary islander {self.primary.name}")
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
            world_id=self.world_id, world_name=self.world_name, world_preset=self.biome,
            coins=self.coins, gate=self.gate_snapshot(),
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
            dropped_items=[dict(d) for d in self.dropped_items],
            llm_status=dict(focus.llm_status),
        )

    def world_init(self):
        return dict(
            type="world_init", dimensions=dict(width=32, height=24, depth=32),
            index_formula="y * width * depth + z * width + x", blocks=list(self.world.blocks),
            block_meta=list(self.world.meta), block_materials=list(self.world.materials),
            materials_catalog=MATERIALS, palette={str(k): v for k, v in PALETTE.items()},
            state=self.snapshot(),
        )

    def change_block(self, p: Pos, block: int, meta: int = 0, material: str = ""):
        old = self.world.get(*p)
        if self.world.set(*p, block, meta):
            if old != block:
                if old != AIR:
                    self.blocks_broken += 1
                if block != AIR:
                    self.blocks_placed += 1
        if material:
            self.world.set_material(p, material)

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
        self.update_dropped_items(dt)
        for agent in list(self.agents.values()):
            if agent.id in self.agents:
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
            low = value.lower()
            stop_fight = any(w in low for w in ("stop fighting", "cease", "peace", "stand down", "calm down"))
            attack_verbs = ("kill", "attack", "fight", "slay", "defeat", "eliminate", "strike")
            verb_positions = [low.find(v) for v in attack_verbs if v in low]
            verb_pos = min(verb_positions) if verb_positions else -1
            attack_intent = verb_pos >= 0

            # If sent to "all" with an explicit attacker before the verb (e.g. "Elena kill Aiden"), scope to Elena
            if attack_intent and agent_id == "all" and verb_pos > 0:
                pre_verb = low[:verb_pos]
                named_attackers = [a for a in self.agents.values() if a.name.lower() in pre_verb or a.id.lower() in pre_verb]
                if named_attackers:
                    targets = named_attackers

            def pick_prey_for(ag: NpcAgent) -> NpcAgent | None:
                peers = [a for a in self.agents.values() if a.id != ag.id]
                if verb_pos >= 0:
                    post = low[verb_pos:]
                    after = [a for a in peers if a.name.lower() in post or a.id.lower() in post]
                    if after:
                        after.sort(key=lambda a: (post.find(a.name.lower()) if a.name.lower() in post else post.find(a.id.lower())))
                        return after[0]
                matches = [a for a in peers if a.name.lower() in low or a.id.lower() in low]
                return matches[0] if matches else (peers[0] if len(peers) == 1 else None)

            for ag in targets:
                ag.remember(f"A whisper from the sky: {value}")
                if stop_fight:
                    ag.hostile_target = None
                    ag.threatened_by = None
                    if ag.current_action == "attack":
                        ag.job, ag.target, ag.path = None, None, []
                        ag.animation, ag.current_action = "idle", "idle"
                    ag.thought = "Standing down as instructed."
                elif attack_intent:
                    prey = pick_prey_for(ag)
                    if prey and prey.id != ag.id:
                        ag.hostile_target = prey.id
                        ag.thought = f"Understood. Moving to attack {prey.name}!"
                        ag.job = None
                        ag.start_action("attack", {"target_id": prey.id})
                    else:
                        ag.thought = f"I heard a whisper: {value[:200]}. I will think about it while caring for myself."
                elif any(w in low for w in ("gate", "portal", "rune", "market")) and ag.sim.world_id == "homestead" and not ag.sim.gate_unlocked:
                    ag.job = None
                    if not ag.choose_gate_progression():
                        ag.thought = "Heading over to work on the Sky Teleport Gate!"
                else:
                    ag.thought = f"I heard a whisper: {value[:200]}. I will think about it while caring for myself."
        elif action == "heal_npc":
            targets = list(self.agents.values()) if agent_id == "all" else [self._resolve_agent(agent_id)]
            for ag in targets:
                ag.needs = dict.fromkeys(ag.needs, 100.0)
        elif action == "drop_gift":
            if not isinstance(value, dict) or not value:
                raise ValueError("drop_gift value must map inventory keys to integer amounts 1..1000")
            drop_from_sky = bool(
                value.get("sky_drop") or value.get("drop_from_sky") or ("x" in value and "z" in value)
            )
            drop_x = value.get("x")
            drop_z = value.get("z")
            if drop_from_sky and ((drop_x is not None and type(drop_x) is not int) or (drop_z is not None and type(drop_z) is not int)):
                raise ValueError("drop_gift x and z coordinates must be integers")
            if "item" in value:
                amt = value.get("amount", 1)
                gift = {value["item"]: amt}
            else:
                gift = {
                    k: v
                    for k, v in value.items()
                    if k not in {"sky_drop", "drop_from_sky", "x", "y", "z"}
                }
            if not isinstance(gift, dict) or not gift or any(
                k not in INVENTORY_KEYS or type(v) is not int or not 1 <= v <= 1000 for k, v in gift.items()
            ):
                raise ValueError("drop_gift value must map inventory keys to integer amounts 1..1000")
            ag = self._resolve_agent(agent_id)
            if drop_from_sky:
                has_explicit_xz = type(drop_x) is int and type(drop_z) is int
                for idx, (key, amount) in enumerate(gift.items()):
                    if has_explicit_xz:
                        lx = max(0, min(self.world.width - 1, drop_x + (idx % 2 if idx else 0)))
                        lz = max(0, min(self.world.depth - 1, drop_z + (idx // 2 if idx else 0)))
                    else:
                        pref = (
                            max(1, min(self.world.width - 2, ag.grid_pos[0] + (idx % 3) - 1)),
                            ag.grid_pos[1],
                            max(1, min(self.world.depth - 2, ag.grid_pos[2] + (idx // 3) + 1)),
                        )
                        spot = self._find_open_spot(pref) or ag.grid_pos
                        lx, lz = spot[0], spot[2]
                    self.spawn_dropped_item(key, amount, lx, lz)
                ag.remember("I saw a supply drop descending from the sky toward the island!")
            else:
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
        mat = str(value.get("material") or "").strip()
        if isinstance(obj, int):
            block_id = obj
        elif isinstance(obj, str) and obj in OBJECT_NAME_TO_BLOCK:
            block_id = OBJECT_NAME_TO_BLOCK[obj]
        elif isinstance(obj, str) and obj in MATERIALS:
            mat = obj
            block_id = MATERIALS[obj]["block"]
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
        self.change_block(p, block_id, meta, material=mat)
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

    def _landing_y_at(self, x: int, z: int) -> int:
        """Return highest solid land/roof surface y + 1 at column (x, z), passing through leaves/plants."""
        cx = max(0, min(self.world.width - 1, int(x)))
        cz = max(0, min(self.world.depth - 1, int(z)))
        for y in range(self.world.height - 1, -1, -1):
            b = self.world.get(cx, y, cz)
            if b not in {AIR, LEAVES, WHEAT, BERRY, SAPLING, TORCH}:
                return min(self.world.height - 1, y + 1)
        return 10

    def spawn_dropped_item(self, item: str, amount: int, x: int, z: int, drop_height: float = 12.5) -> dict:
        """Spawn an item high above column (x, z) so gravity carries it onto the land."""
        if len(self.dropped_items) >= 48:
            landed_idx = next((i for i, d in enumerate(self.dropped_items) if d.get("landed")), 0)
            self.dropped_items.pop(landed_idx)
        lx = max(0, min(self.world.width - 1, int(x)))
        lz = max(0, min(self.world.depth - 1, int(z)))
        ground_y = self._landing_y_at(lx, lz)
        start_y = round(max(float(ground_y) + 8.0, min(26.0, float(ground_y) + drop_height)), 3)
        self.dropped_item_counter += 1
        entry = {
            "id": f"drop-{self.dropped_item_counter}",
            "item": item,
            "amount": int(amount),
            "position": {"x": float(lx), "y": start_y, "z": float(lz)},
            "grid_pos": {"x": lx, "y": ground_y, "z": lz},
            "vy": 0.0,
            "landed": False,
            "bounces": 0,
            "yaw": round(self.rng.uniform(0, math.tau), 3),
            "age": 0.0,
        }
        self.dropped_items.append(entry)
        return entry

    def update_dropped_items(self, dt: float) -> None:
        """Simulate gravity, landing bounce, and NPC ground pickup for sky-dropped items."""
        remaining: list[dict] = []
        for d in self.dropped_items:
            d["age"] = round(float(d.get("age", 0.0)) + dt, 3)
            pos = d["position"]
            gx = max(0, min(self.world.width - 1, int(round(pos["x"]))))
            gz = max(0, min(self.world.depth - 1, int(round(pos["z"]))))
            landing_y = float(self._landing_y_at(gx, gz))
            d["grid_pos"] = {"x": gx, "y": int(landing_y), "z": gz}

            # Re-enable falling if the block beneath a landed item was erased
            if d["landed"] and pos["y"] > landing_y + 0.15:
                d["landed"] = False

            if not d["landed"]:
                vy = max(-14.0, float(d.get("vy", 0.0)) - 16.0 * dt)
                next_y = float(pos["y"]) + vy * dt
                if next_y <= landing_y:
                    bounces = int(d.get("bounces", 0))
                    if vy < -2.4 and bounces < 1:
                        pos["y"] = round(landing_y, 4)
                        d["vy"] = round(min(3.5, -vy * 0.25), 4)
                        d["bounces"] = bounces + 1
                    else:
                        pos["y"] = round(landing_y, 4)
                        d["vy"] = 0.0
                        d["bounces"] = 1
                        d["landed"] = True
                        d["landed_age"] = 0.0
                else:
                    pos["y"] = round(next_y, 4)
                    d["vy"] = round(vy, 4)
                remaining.append(d)
                continue

            d["landed_age"] = float(d.get("landed_age", 0.5)) + dt
            picked_up_by = None
            if d["landed_age"] >= 0.45:
                for ag in self.agents.values():
                    horiz = math.hypot(ag.position[0] - pos["x"], ag.position[2] - pos["z"])
                    if horiz <= 1.45 and abs(ag.position[1] - landing_y) <= 1.8:
                        picked_up_by = ag
                        break
            if picked_up_by is not None:
                key = str(d["item"])
                amt = int(d["amount"])
                if key in picked_up_by.inventory:
                    picked_up_by.inventory[key] += amt
                label = key.replace("_", " ")
                picked_up_by.remember(f"Collected {amt}x {label} that landed on the island.")
                picked_up_by.thought = f"Nice! I picked up {amt}x {label} from the land."
            else:
                remaining.append(d)
        self.dropped_items = remaining

    def update_entities(self, dt: float) -> None:
        if self.biome not in {"market", "flat_sandbox"} and self.tick >= 200 and self.tick % 400 == 0 and len(self.entities) < 4:
            wild_kind = ("deer", "sheep", "fox", "duck")[self.tick // 400 % 4]
            spot = self._find_open_spot()
            if spot:
                self.entity_counter += 1
                names = ENTITY_DEFAULT_NAMES[wild_kind]
                self.entities.append({
                    "id": f"ent-{self.entity_counter}",
                    "kind": wild_kind,
                    "name": names[(self.entity_counter - 1) % len(names)],
                    "variant": self.entity_counter % 4,
                    "position": {"x": float(spot[0]), "y": float(spot[1]), "z": float(spot[2])},
                    "grid_pos": xyz(spot),
                    "yaw": round(self.rng.uniform(0, math.tau), 3),
                    "animation": "idle",
                    "target": None,
                    "wait": 1.2,
                })
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
            "world_id": self.world_id,
            "world_name": self.world_name,
            "biome": self.biome,
            "coins": int(self.coins),
            "gate_clues": dict(self.gate_clues),
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
            "dropped_item_counter": int(self.dropped_item_counter),
            "last_market_day": int(self.last_market_day),
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
            "dropped_items": [
                {
                    **d,
                    "position": dict(d["position"]),
                    "grid_pos": dict(d["grid_pos"]),
                }
                for d in self.dropped_items
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
        raw_biome = str(data.get("biome", sim.world.biome))
        sim.biome = raw_biome if raw_biome in VALID_BIOMES else "homestead"
        raw_wid = str(data.get("world_id", "")).strip().lower()
        sim.world_id = raw_wid or sim.biome
        default_name = "Homestead" if sim.world_id == "homestead" else "Market" if sim.world_id == "market" else WORLD_PRESETS[sim.biome]["label"]
        sim.world_name = str(data.get("world_name", default_name)).strip()[:40] or default_name
        sim.coins = max(0, int(data.get("coins", 250)))
        sim.elapsed = max(0.0, float(data.get("elapsed", DAY_SECONDS * 0.26)))
        sim.paused = bool(data.get("paused", False))
        raw_speed = int(data.get("speed", 1))
        sim.speed = raw_speed if raw_speed in {1, 2, 5} else 1
        raw_weather = str(data.get("weather", "clear"))
        sim.weather = raw_weather if raw_weather in {"clear", "rain", "storm"} else "clear"
        sim.weather_override = bool(data.get("weather_override", False))
        sim.blueprint = [] if sim.biome == "market" else house_blueprint()
        sim.gate_blueprint = gate_blueprint() if sim.world_id == "homestead" else []
        raw_clues = data.get("gate_clues") if isinstance(data.get("gate_clues"), dict) else {}
        sim.gate_clues = (
            {k: bool(raw_clues.get(k, False)) for k in ("anchor", "conduit", "core")}
            if sim.world_id == "homestead"
            else {"anchor": True, "conduit": True, "core": True}
        )
        sim.farm_sites = [] if sim.biome == "market" else [(x, 10, z) for x in (19, 20) for z in range(18, 22)]
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
        sim.dropped_items = []
        for d in data.get("dropped_items", []):
            if not isinstance(d, dict) or not isinstance(d.get("position"), dict) or not isinstance(d.get("grid_pos"), dict):
                continue
            item_key = str(d.get("item", "berries"))
            if item_key not in INVENTORY_KEYS:
                continue
            sim.dropped_items.append({
                "id": str(d.get("id", f"drop-{len(sim.dropped_items) + 1}")),
                "item": item_key,
                "amount": max(1, int(d.get("amount", 1))),
                "position": {k: float(d["position"][k]) for k in ("x", "y", "z")},
                "grid_pos": {k: int(d["grid_pos"][k]) for k in ("x", "y", "z")},
                "vy": float(d.get("vy", 0.0)),
                "landed": bool(d.get("landed", False)),
                "bounces": int(d.get("bounces", 0)),
                "yaw": float(d.get("yaw", 0.0)),
                "age": float(d.get("age", 0.0)),
                "landed_age": float(d.get("landed_age", 0.5)),
            })
        sim.dropped_item_counter = max(
            len(sim.dropped_items), int(data.get("dropped_item_counter", len(sim.dropped_items)))
        )
        sim.last_market_day = max(0, int(data.get("last_market_day", 0)))
        sim._away_stub = None
        sim.agent_counter = max(1, int(data.get("agent_counter", 1)))
        sim.home = HomeState.from_state(data.get("home", {}))
        sim.agents = {}
        for agent_data in data.get("agents", []):
            if not isinstance(agent_data, dict):
                continue
            agent = NpcAgent.from_save(sim, agent_data)
            sim.agents[agent.id] = agent
        if not sim.agents and not data.get("allow_empty_agents"):
            raise ValueError("Invalid save file: at least one NPC agent is required")
        sim.agent_counter = max(sim.agent_counter, len(sim.agents))
        return sim
