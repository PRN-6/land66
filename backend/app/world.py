"""Deterministic voxel terrain. Coordinates describe cells, NPC y is feet height."""
from __future__ import annotations

import math
import random
from collections import Counter

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
        self.updates: dict[Pos, dict] = {}
        self.locations: dict[int, set[Pos]] = {block: set() for block in PALETTE}
        self.generate()
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
        self.blocks[i], self.meta[i] = block, meta
        self.updates[(x, y, z)] = dict(x=x, y=y, z=z, block=block, meta=meta)
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
                rim = 1 + .045 * math.sin(x * 1.7 + self.seed) * math.cos(z * .8)
                if r > rim:
                    continue
                top = 10 + int(r > .65) + int(r > .83)
                bottom = 3 + int(6 * r * r)
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
        # Leaves start high enough to preserve two-block pedestrian clearance.
        for dy in (3, 4, 5):
            radius = 1 if dy == 5 else 2
            for dx in range(-radius, radius + 1):
                for dz in range(-radius, radius + 1):
                    if abs(dx) + abs(dz) <= radius + 1 and self.get(x + dx, y + dy, z + dz) == AIR:
                        self.set(x + dx, y + dy, z + dz, LEAVES)
        for dy in range(4):
            self.set(x, y + dy, z, LOG)
        return True

    def counts(self) -> Counter:
        return Counter({block: len(cells) for block, cells in self.locations.items()})
