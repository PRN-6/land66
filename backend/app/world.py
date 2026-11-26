"""Deterministic voxel terrain. Coordinates describe cells, NPC y is feet height."""
from __future__ import annotations

import math
import random
from collections import Counter
from .catalog import MATERIALS

WIDTH, HEIGHT, DEPTH = 32, 24, 32
PALETTE = dict(enumerate((
    "air", "grass", "dirt", "stone", "water", "wood_log", "leaves",
    "wood_plank", "cobblestone", "glass", "door_closed", "door_open", "bed",
    "chest", "crafting_bench", "torch", "farmland", "crop_wheat", "wild_berry",
    "sapling", "roof_shingle", "fence",
)))
AIR, GRASS, DIRT, STONE, WATER, LOG, LEAVES, PLANK, COBBLE, GLASS, DOOR, OPEN_DOOR, BED, CHEST, BENCH, TORCH, FARMLAND, WHEAT, BERRY, SAPLING, ROOF, FENCE = range(22)
PASSABLE = {AIR, DOOR, OPEN_DOOR, TORCH, WHEAT, BERRY, SAPLING}
SUPPORT = {GRASS, DIRT, STONE, LOG, PLANK, COBBLE, FARMLAND, ROOF}
Pos = tuple[int, int, int]


class World:
    width, height, depth = WIDTH, HEIGHT, DEPTH

    def __init__(self, seed: int = 66):
        self.seed = seed
        self.rng = random.Random(seed)
        self.blocks = [AIR] * (WIDTH * HEIGHT * DEPTH)
        self.meta = [0] * len(self.blocks)
        self.materials = [""] * len(self.blocks)
        self.decorations: list[dict] = []
        self.resource_nodes: dict[str, dict] = {}
        self.updates: dict[Pos, dict] = {}
        self.locations: dict[int, set[Pos]] = {block: set() for block in PALETTE}
        self.generate()
        self.generate_details()
        self.updates.clear()

    @staticmethod
    def index(x: int, y: int, z: int) -> int:
        return y * WIDTH * DEPTH + z * WIDTH + x

    @staticmethod
    def inside(x: int, y: int, z: int) -> bool:
        return 0 <= x < WIDTH and 0 <= y < HEIGHT and 0 <= z < DEPTH

    def get(self, x: int, y: int, z: int) -> int:
        return self.blocks[self.index(x, y, z)] if self.inside(x, y, z) else AIR

    def get_meta(self, x: int, y: int, z: int) -> int:
        return self.meta[self.index(x, y, z)] if self.inside(x, y, z) else 0

    def set(self, x: int, y: int, z: int, block: int, meta: int = 0) -> bool:
        if not self.inside(x, y, z) or block not in PALETTE:
            return False
        if block == FARMLAND:
            meta = max(0, min(1, meta))
        elif block == WHEAT:
            meta = max(0, min(3, meta))
        else:
            meta = 0
        i = self.index(x, y, z)
        old = self.blocks[i]
        if old == block and self.meta[i] == meta:
            return False
        self.locations[old].discard((x, y, z))
        if block != AIR:
            self.locations[block].add((x, y, z))
        old_material = self.materials[i]
        if old != block:
            self.materials[i] = ""
        self.blocks[i], self.meta[i] = block, meta
        self.updates[(x, y, z)] = dict(x=x, y=y, z=z, block=block, meta=meta)
        if self.materials[i] or old_material:
            self.updates[(x, y, z)]["material"] = self.materials[i]
        return True

    def set_material(self, p: Pos, material: str) -> bool:
        definition = MATERIALS.get(material)
        if not definition or not self.inside(*p) or self.get(*p) != definition["block"]:
            return False
        i = self.index(*p)
        if self.materials[i] == material:
            return False
        self.materials[i] = material
        self.updates[p] = dict(x=p[0], y=p[1], z=p[2], block=self.get(*p), meta=self.get_meta(*p), material=material)
        return True

    def drain_updates(self) -> list[dict]:
        result = list(self.updates.values())
        self.updates.clear()
        return result

    def positions(self, block: int) -> list[Pos]:
        return sorted(self.locations[block])

    def walkable(self, p: Pos) -> bool:
        x, y, z = p
        return (self.inside(x, y + 1, z) and y > 0
                and self.get(x, y - 1, z) in SUPPORT
                and self.get(x, y, z) in PASSABLE
                and self.get(x, y + 1, z) in PASSABLE)

    def feet_at(self, x: int, z: int, near_y: int = 11) -> Pos | None:
        for y in sorted(range(1, HEIGHT - 1), key=lambda y: (abs(y - near_y), y)):
            if self.walkable((x, y, z)):
                return x, y, z
        return None

    def generate(self) -> None:
        # A broad flat clearing joins rolling outer terrain without disconnected ledges.
        for x in range(2, 31):
            for z in range(2, 31):
                r = math.hypot((x - 16) / 14, (z - 16) / 13)
                ripple = math.sin(x * .47 + self.seed * .13) * math.cos(z * .39 - self.seed * .07)
                rim = 1 + .06 * ripple + .025 * math.sin(z * 1.4 + x)
                if r > rim:
                    continue
                rolling = r + ripple * .09
                top = 10 + int(rolling > .65) + int(rolling > .85)
                if 10 <= x <= 25 and 10 <= z <= 21:
                    top = 10
                bottom = max(3, min(top - 1, 3 + int(6 * r * r + ripple * .65)))
                for y in range(bottom, top + 1):
                    self.set(x, y, z, GRASS if y == top else DIRT if y >= top - 2 else STONE)
        # Recessed freshwater pond; banks are solid and reachable.
        for x, z in [(x, z) for x in range(21, 25) for z in range(13, 18)
                     if ((x - 22.5) / 2.2) ** 2 + ((z - 15) / 2.6) ** 2 < 1]:
            for y in range(10, 13):
                self.set(x, y, z, AIR)
            self.set(x, 9, z, DIRT)
            self.set(x, 10, z, WATER)
        candidates = [(x, z) for x in range(4, 29) for z in range(4, 29)]
        self.rng.shuffle(candidates)
        trees: list[tuple[int, int]] = []
        for x, z in candidates:
            p = self.feet_at(x, z)
            if not p or self.get(x, p[1] - 1, z) != GRASS:
                continue
            if 10 <= x <= 25 and 10 <= z <= 21:
                continue
            if any(abs(x - tx) < 3 and abs(z - tz) < 3 for tx, tz in trees):
                continue
            if len(trees) < 34 and self.grow_tree(p):
                trees.append((x, z))
        placed_boulders = 0
        for x, z in candidates:
            if 11 <= x <= 25 and 10 <= z <= 21:
                continue
            p = self.feet_at(x, z)
            if p and self.get(*p) == AIR and self.get(x, p[1] - 1, z) == GRASS:
                if placed_boulders < 22:
                    # Each outcrop contains four safely mineable surface stones.
                    for dx, dz in ((0, 0), (1, 0), (0, 1), (1, 1)):
                        q = self.feet_at(x + dx, z + dz, p[1])
                        if q and self.get(*q) == AIR:
                            self.set(*q, STONE)
                    placed_boulders += 1
                elif self.rng.random() < .13:
                    self.set(*p, BERRY)
        # Guaranteed food close to spawn, independent of randomized forest density.
        for x, z in ((10, 18), (11, 21), (19, 20), (20, 11), (9, 13)):
            p = self.feet_at(x, z)
            if p:
                self.set(*p, BERRY)

    def grow_tree(self, p: Pos) -> bool:
        x, y, z = p
        if self.get(x, y - 1, z) not in {GRASS, DIRT}:
            return False
        if not all(self.get(x, y + dy, z) in {AIR, SAPLING} for dy in range(5)):
            return False
        if not self.inside(x, y + 5, z):
            return False
        # Stable species selection does not depend on unrelated decoration RNG calls.
        species = ("oak", "birch", "pine")[(x * 7 + z * 11 + self.seed) % 3]
        # Leaves start high enough to preserve two-block pedestrian clearance.
        for dy in (3, 4, 5):
            radius = 1 if dy == 5 or (species == "birch" and dy == 3) else 2
            for dx in range(-radius, radius + 1):
                for dz in range(-radius, radius + 1):
                    if abs(dx) + abs(dz) <= radius + 1 and self.get(x + dx, y + dy, z + dz) == AIR:
                        self.set(x + dx, y + dy, z + dz, LEAVES)
                        self.set_material((x + dx, y + dy, z + dz), species + "_foliage")
        for dy in range(4):
            self.set(x, y + dy, z, LOG)
            self.set_material((x, y + dy, z), species + "_bark")
        return True

    def generate_details(self):
        """Decoration is non-colliding; gameplay resources remain tied to real cells."""
        rng = random.Random(self.seed + 19081)
        for p in self.positions(STONE):
            # Exterior strata are useful even to a renderer that ignores small props.
            if any(self.get(p[0]+dx,p[1]+dy,p[2]+dz) == AIR for dx,dy,dz in ((1,0,0),(-1,0,0),(0,-1,0),(0,0,1),(0,0,-1))):
                self.set_material(p, "slate" if p[1] < 7 else "mossy_stone" if p[1] >= 10 and rng.random() < .25 else "granite")
        grass = self.positions(GRASS)
        for x,y,z in grass:
            self.set_material((x,y,z), "forest_grass" if not (10<=x<=25 and 10<=z<=21) else "meadow_grass")
            if self.get(x,y+1,z) != AIR or (11<=x<=21 and 11<=z<=21):
                continue
            if rng.random() < .48:
                kind = rng.choice(["grass_tuft", "fern", "wildflower", "pebbles", "mushroom"])
                self.decorations.append(dict(id=f"detail-{len(self.decorations)}", kind=kind,
                    position=dict(x=x+rng.uniform(-.3,.3), y=y+1, z=z+rng.uniform(-.3,.3)),
                    anchor=(x,y,z), support=GRASS, scale=round(rng.uniform(.3,.8),3),
                    yaw=round(rng.uniform(0,math.tau),3), color=rng.choice(["#dbb9df", "#f2d073", "#e7e0c5"]) if kind=="wildflower" else None))
        # Shore deposits occupy existing banks, preserving the freshwater surface.
        for kind, points in {
            "clay": [(20,13),(20,14),(20,15)], "sand": [(25,13),(25,14),(25,15)]
        }.items():
            for x,z in points:
                feet = self.feet_at(x,z)
                if feet:
                    p = (x,feet[1]-1,z)
                    self.set(*p, DIRT)
                    self.set_material(p, "clay_bank" if kind=="clay" else "sandy_bank")
                    self.add_resource(kind, p, 60)
        stone = [p for p in self.positions(STONE) if p[1]>=10 and self.get(p[0],p[1]+1,p[2])==AIR]
        stone.sort(key=lambda p: (abs(p[0]-16)+abs(p[2]-20),p))
        for i,p in enumerate(stone[:16]):
            kind = "iron_ore" if i % 2 else "coal"
            self.set_material(p, "iron_vein" if kind=="iron_ore" else "coal_vein")
            self.add_resource(kind,p,40)
        fiber_sites = [p for p in grass if self.get(*p)==GRASS and self.get(p[0],p[1]+1,p[2]) in {AIR,BERRY}
                       and not (11<=p[0]<=21 and 11<=p[2]<=21)]
        rng.shuffle(fiber_sites)
        for p in fiber_sites[:16]:
            self.add_resource("fiber",p,12)
            self.decorations.append(dict(id=f"reeds-{len(self.decorations)}", kind="reeds", position=dict(x=p[0],y=p[1]+1,z=p[2]),
                anchor=p, support=GRASS, scale=.7, yaw=0, color=None))

    def add_resource(self, kind: str, p: Pos, capacity: int):
        key = f"{kind}-{len(self.resource_nodes)}"
        self.resource_nodes[key] = dict(id=key, kind=kind, position=dict(x=p[0],y=p[1],z=p[2]),
            remaining=capacity, capacity=capacity, support=self.get(*p), regrowth=0.0)

    def details_snapshot(self):
        props = []
        for detail in self.decorations:
            x,y,z = detail["anchor"]
            if self.get(x,y,z)==detail["support"] and self.get(x,y+1,z) in {AIR,BERRY}:
                props.append({k:v for k,v in detail.items() if k not in {"anchor","support"}})
        return dict(decorations=props, resource_nodes=[{k:v for k,v in node.items() if k not in {"support","regrowth"}} for node in self.resource_nodes.values()])

    def update_resources(self, dt: float):
        for node in self.resource_nodes.values():
            p = tuple(node["position"][k] for k in ("x","y","z"))
            if self.get(*p) != node["support"]:
                node["remaining"] = 0
            elif node["kind"] == "fiber" and node["remaining"] < node["capacity"]:
                node["regrowth"] += dt
                if node["regrowth"] >= 180:
                    node["remaining"] = node["capacity"]
                    node["regrowth"] = 0

    def counts(self) -> Counter:
        return Counter({block: len(cells) for block, cells in self.locations.items()})
