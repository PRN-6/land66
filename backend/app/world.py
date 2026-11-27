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

WORLD_PRESETS: dict[str, dict[str, str]] = {
    "homestead": {
        "label": "Lush Island",
        "description": "Forested floating island with pond, berry bushes, mixed trees, and ore veins.",
    },
    "alpine_peaks": {
        "label": "Alpine Peaks",
        "description": "Stepped slate & marble mountain ridges, pine forest, crystal veins, and cold spring.",
    },
    "sakura_grove": {
        "label": "Sakura Sanctuary",
        "description": "Terraced blossom sanctuary with sakura trees, marble walkways, and lantern shrines.",
    },
    "crystal_canyon": {
        "label": "Crystal Canyon",
        "description": "Sandstone & slate canyon cliffs with glowing crystal spires, gold seams, and oasis.",
    },
    "obsidian_caldera": {
        "label": "Volcanic Caldera",
        "description": "Dark obsidian crater rim with radiant sunstone vents and rich mineral deposits.",
    },
    "flat_sandbox": {
        "label": "Blank Canvas",
        "description": "Wide level meadow island ready for custom God sculpting and multi-NPC builds.",
    },
    "market": {
        "label": "Sky Market Bazaar",
        "description": "Festive floating bazaar plaza with merchant stalls, wishing fountain, and lanterns.",
    },
}
VALID_BIOMES = set(WORLD_PRESETS.keys())


class World:
    width, height, depth = WIDTH, HEIGHT, DEPTH

    def __init__(self, seed: int = 66, biome: str = "homestead"):
        self.seed = seed
        self.biome = biome if biome in VALID_BIOMES else "homestead"
        self.rng = random.Random(seed)
        self.blocks = [AIR] * (WIDTH * HEIGHT * DEPTH)
        self.meta = [0] * len(self.blocks)
        self.materials = [""] * len(self.blocks)
        self.decorations: list[dict] = []
        self.resource_nodes: dict[str, dict] = {}
        self.updates: dict[Pos, dict] = {}
        self.locations: dict[int, set[Pos]] = {block: set() for block in PALETTE}
        if self.biome == "market":
            self.generate_market()
        elif self.biome == "homestead":
            self.generate()
            self.generate_details()
        else:
            self.generate_preset(self.biome)
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

    def generate_market(self) -> None:
        """Build the Sky Market floating island with paved plaza, three shop stalls, fountain & sakura trees."""
        # Floating island silhouette with flat y=10 terrace
        for x in range(3, 30):
            for z in range(3, 30):
                r = math.hypot((x - 16) / 13.5, (z - 16) / 12.8)
                ripple = math.sin(x * .41 + self.seed * .11) * math.cos(z * .37 - self.seed * .09)
                if r > 1.0 + 0.05 * ripple:
                    continue
                top = 10
                bottom = max(3, min(top - 1, 3 + int(5.5 * r * r + ripple * .6)))
                for y in range(bottom, top + 1):
                    if y == top:
                        self.set(x, y, z, GRASS)
                        self.set_material((x, y, z), "meadow_grass")
                    elif y >= top - 2:
                        self.set(x, y, z, DIRT)
                    else:
                        self.set(x, y, z, STONE)
                        self.set_material((x, y, z), "obsidian" if y <= 4 else "slate" if y < 7 else "granite")

        # Main Marble & Sandstone Market Plaza Walkway (crossroads + central square)
        for x in range(9, 24):
            for z in range(9, 24):
                if (12 <= x <= 20 and 12 <= z <= 20) or (14 <= x <= 18) or (14 <= z <= 18):
                    self.set(x, 10, z, COBBLE)
                    is_border = x in {9, 12, 20, 23} or z in {9, 12, 20, 23}
                    mat = "marble" if (x + z) % 2 == 0 and not is_border else "sandstone"
                    self.set_material((x, 10, z), mat)

        # Central Wishing Fountain / Reflecting Pool
        for x in range(15, 18):
            for z in range(15, 18):
                if x == 16 and z == 16:
                    self.set(x, 10, z, STONE)
                    self.set_material((x, 10, z), "marble")
                    self.set(x, 11, z, STONE)
                    self.set_material((x, 11, z), "sunstone")
                else:
                    self.set(x, 9, z, STONE)
                    self.set_material((x, 9, z), "marble")
                    self.set(x, 10, z, WATER)

        def build_stall(ox: int, oz: int, counter_mat: str, post_mat: str, roof_mat: str, display: list[tuple[int, int, str]]):
            # Floor platform y=10
            for dx in range(5):
                for dz in range(4):
                    self.set(ox + dx, 10, oz + dz, PLANK)
                    self.set_material((ox + dx, 10, oz + dz), "walnut_boards")
            # Corner posts
            for px in (ox, ox + 4):
                for pz in (oz, oz + 3):
                    for py in (11, 12, 13):
                        self.set(px, py, pz, LOG)
                        self.set_material((px, py, pz), post_mat)
            # Counter in front row (z = oz + 3) + back wall props (z = oz)
            for dx in range(1, 4):
                self.set(ox + dx, 11, oz + 3, PLANK if counter_mat.endswith("boards") or counter_mat.endswith("planks") else COBBLE)
                self.set_material((ox + dx, 11, oz + 3), counter_mat)
            for dx, b_type, mat in display:
                self.set(ox + dx, 11, oz + 1, b_type)
                if mat:
                    self.set_material((ox + dx, 11, oz + 1), mat)
            # Lantern posts on stall front corners
            self.set(ox, 12, oz + 3, TORCH)
            self.set_material((ox, 12, oz + 3), "copper_lantern")
            self.set(ox + 4, 12, oz + 3, TORCH)
            self.set_material((ox + 4, 12, oz + 3), "copper_lantern")
            # Pitched / terraced awning roof at y=14
            for dx in range(5):
                for dz in range(4):
                    self.set(ox + dx, 14, oz + dz, ROOF)
                    self.set_material((ox + dx, 14, oz + dz), roof_mat)

        # Stall 1 (NW): Baker & Fresh Goods
        build_stall(7, 7, "bamboo_planks", "oak_bark", "terracotta_roof", [(1, CHEST, ""), (2, BENCH, ""), (3, CHEST, "")])
        # Stall 2 (NE): Stonemason & Precious Gems
        build_stall(20, 7, "marble", "birch_bark", "slate_roof", [(1, STONE, "gold_vein"), (2, STONE, "crystal_vein"), (3, COBBLE, "copper_block")])
        # Stall 3 (E): Timber & Craft Studio
        build_stall(20, 19, "walnut_boards", "pine_bark", "cedar_shingle", [(1, BENCH, ""), (2, GLASS, "stained_glass"), (3, CHEST, "")])

        # Mini Market Garden Planters (South-West corner)
        for z in (20, 21):
            for x in (8, 9):
                self.set(x, 10, z, FARMLAND, 1)
                self.set(x, 11, z, WHEAT, 3)
        self.set(11, 11, 21, BERRY)
        self.set(7, 11, 22, BERRY)

        # Lanterns lining main South avenue
        for x, z in ((14, 22), (18, 22), (13, 13), (19, 13)):
            if self.get(x, 11, z) == AIR:
                self.set(x, 11, z, TORCH)
                self.set_material((x, 11, z), "copper_lantern")

        # Decorative Sakura & Birch Trees around perimeter
        for tx, tz in ((6, 15), (15, 6), (26, 14), (10, 25), (23, 25)):
            p = self.feet_at(tx, tz)
            if p and self.get(tx, p[1] - 1, tz) == GRASS:
                self.grow_tree(p)
                # Paint all market trees sakura or birch leaves for a festive bazaar feel
                species_leaf = "sakura_foliage" if (tx + tz) % 2 else "autumn_foliage"
                for dy in range(3, 6):
                    for dx in range(-2, 3):
                        for dz in range(-2, 3):
                            lp = (tx + dx, p[1] + dy, tz + dz)
                            if self.get(*lp) == LEAVES:
                                self.set_material(lp, species_leaf)

        # Activated Return Teleport Gate at South Sky Bridge (15..17, 10..13, 25)
        for gx, mat in ((15, "obsidian"), (16, "marble"), (17, "obsidian")):
            self.set(gx, 10, 25, STONE)
            self.set_material((gx, 10, 25), mat)
        for gx in (15, 17):
            for gy, mat in ((11, "obsidian"), (12, "marble"), (13, "crystal_vein")):
                self.set(gx, gy, 25, STONE)
                self.set_material((gx, gy, 25), mat)
        self.set(16, 13, 25, STONE)
        self.set_material((16, 13, 25), "sunstone")

    def generate_preset(self, preset: str) -> None:
        """Build a themed custom floating world preset while keeping a walkable clearing, pond, and ores."""
        cfg = {
            "alpine_peaks": dict(top_block=GRASS, top_mat="meadow_grass", rock_mat="slate", rim_boost=3, species="pine", tree_cap=24, ores=(("iron_ore", "iron_vein", 36), ("crystal", "crystal_vein", 24), ("gold_ore", "gold_vein", 24), ("coal", "coal_vein", 32), ("marble", "marble", 20))),
            "sakura_grove": dict(top_block=GRASS, top_mat="meadow_grass", rock_mat="marble", rim_boost=1, species="sakura", tree_cap=22, ores=(("marble", "marble", 24), ("crystal", "crystal_vein", 20), ("gold_ore", "gold_vein", 20), ("iron_ore", "iron_vein", 28), ("coal", "coal_vein", 28))),
            "crystal_canyon": dict(top_block=COBBLE, top_mat="sandstone", rock_mat="slate", rim_boost=2, species="autumn", tree_cap=12, ores=(("crystal", "crystal_vein", 30), ("gold_ore", "gold_vein", 28), ("copper_ore", "copper_vein", 30), ("marble", "marble", 20), ("obsidian", "obsidian", 18))),
            "obsidian_caldera": dict(top_block=STONE, top_mat="obsidian", rock_mat="slate", rim_boost=3, species="pine", tree_cap=10, ores=(("obsidian", "obsidian", 32), ("gold_ore", "gold_vein", 26), ("copper_ore", "copper_vein", 30), ("iron_ore", "iron_vein", 30), ("coal", "coal_vein", 36))),
            "flat_sandbox": dict(top_block=GRASS, top_mat="meadow_grass", rock_mat="granite", rim_boost=0, species="oak", tree_cap=6, ores=(("iron_ore", "iron_vein", 32), ("coal", "coal_vein", 32), ("gold_ore", "gold_vein", 20), ("crystal", "crystal_vein", 20), ("marble", "marble", 20))),
        }.get(preset, dict(top_block=GRASS, top_mat="meadow_grass", rock_mat="granite", rim_boost=1, species="oak", tree_cap=20, ores=(("iron_ore", "iron_vein", 32), ("coal", "coal_vein", 32))))

        for x in range(2, 31):
            for z in range(2, 31):
                r = math.hypot((x - 16) / 14, (z - 16) / 13)
                ripple = math.sin(x * .44 + self.seed * .13) * math.cos(z * .38 - self.seed * .09)
                if r > 1.0 + 0.05 * ripple:
                    continue
                if preset == "flat_sandbox":
                    top = 10
                else:
                    ridge = max(0, int((r + ripple * 0.14 - 0.55) * cfg["rim_boost"] * 2.2))
                    top = 10 + min(4, ridge)
                if 10 <= x <= 25 and 10 <= z <= 21:
                    top = 10
                bottom = max(3, min(top - 1, 3 + int(5.5 * r * r + ripple * .6)))
                for y in range(bottom, top + 1):
                    if y == top:
                        if preset in {"crystal_canyon", "obsidian_caldera"} and 12 <= x <= 20 and 12 <= z <= 20:
                            self.set(x, y, z, GRASS)
                            self.set_material((x, y, z), "meadow_grass")
                        else:
                            self.set(x, y, z, cfg["top_block"])
                            self.set_material((x, y, z), cfg["top_mat"])
                    elif y >= top - 2:
                        self.set(x, y, z, DIRT)
                    else:
                        mat = "obsidian" if y <= 4 else "sunstone" if (preset == "obsidian_caldera" and y == 5 and (x + z) % 6 == 0) else cfg["rock_mat"]
                        self.set(x, y, z, STONE)
                        self.set_material((x, y, z), mat)

        # Recessed freshwater spring/pond (walkable banks preserved)
        for x, z in [(x, z) for x in range(21, 25) for z in range(13, 18)
                     if ((x - 22.5) / 2.2) ** 2 + ((z - 15) / 2.6) ** 2 < 1]:
            for y in range(10, 13):
                self.set(x, y, z, AIR)
            self.set(x, 9, z, DIRT)
            self.set_material((x, 9, z), "sandy_bank" if preset == "crystal_canyon" else "clay_bank")
            self.set(x, 10, z, WATER)

        # Preset signature accents outside center spawn pad (16, 11, 20)
        if preset == "sakura_grove":
            for x in range(12, 21):
                for z in (14, 18):
                    if self.get(x, 10, z) != WATER:
                        self.set(x, 10, z, COBBLE)
                        self.set_material((x, 10, z), "marble")
            for lx, lz in ((11, 14), (11, 18), (20, 14), (20, 18)):
                if self.get(lx, 11, lz) == AIR:
                    self.set(lx, 11, lz, TORCH)
                    self.set_material((lx, 11, lz), "copper_lantern")
        elif preset in {"crystal_canyon", "obsidian_caldera"}:
            accent = "crystal_vein" if preset == "crystal_canyon" else "sunstone"
            for px, pz, h in ((7, 8, 2), (24, 8, 2), (7, 23, 2), (25, 22, 1)):
                feet = self.feet_at(px, pz)
                if feet:
                    for dy in range(h + 1):
                        self.set(px, feet[1] + dy, pz, STONE)
                        self.set_material((px, feet[1] + dy, pz), accent if dy == h else cfg["rock_mat"])

        candidates = [(x, z) for x in range(4, 29) for z in range(4, 29)]
        self.rng.shuffle(candidates)
        trees: list[tuple[int, int]] = []
        for x, z in candidates:
            if 10 <= x <= 25 and 10 <= z <= 21:
                continue
            p = self.feet_at(x, z)
            if not p or self.get(x, p[1] - 1, z) not in {GRASS, COBBLE, STONE}:
                continue
            if self.get(x, p[1] - 1, z) != GRASS:
                self.set(x, p[1] - 1, z, GRASS)
            if any(abs(x - tx) < 3 and abs(z - tz) < 3 for tx, tz in trees):
                continue
            if len(trees) < cfg["tree_cap"] and self.grow_tree(p, forced_species=cfg["species"]):
                trees.append((x, z))

        placed_boulders = 0
        ore_cycle = cfg["ores"]
        for x, z in candidates:
            if 11 <= x <= 25 and 10 <= z <= 21:
                continue
            p = self.feet_at(x, z)
            if not p or self.get(*p) != AIR or self.get(x, p[1] - 1, z) == WATER:
                continue
            if placed_boulders < (8 if preset == "flat_sandbox" else 16):
                self.set(*p, STONE)
                kind, mat, cap = ore_cycle[placed_boulders % len(ore_cycle)]
                self.set_material(p, mat)
                self.add_resource(kind, p, cap)
                placed_boulders += 1
            elif self.rng.random() < 0.08:
                self.set(*p, BERRY)

        # Shore clay/sand & fiber nodes + guaranteed starter berries
        for kind, pts in {"clay": [(20, 14), (20, 15)], "sand": [(25, 14), (25, 15)]}.items():
            for sx, sz in pts:
                feet = self.feet_at(sx, sz)
                if feet:
                    sp = (sx, feet[1] - 1, sz)
                    self.set(*sp, DIRT)
                    self.set_material(sp, "clay_bank" if kind == "clay" else "sandy_bank")
                    self.add_resource(kind, sp, 60)
        for bx, bz in ((11, 21), (19, 20), (10, 18)):
            bp = self.feet_at(bx, bz)
            if bp and self.get(*bp) == AIR:
                self.set(*bp, BERRY)
        for p in [pt for pt in self.positions(GRASS) if self.get(pt[0], pt[1] + 1, pt[2]) == AIR and not (11 <= pt[0] <= 21 and 11 <= pt[2] <= 21)][:10]:
            self.add_resource("fiber", p, 12)

    def grow_tree(self, p: Pos, forced_species: str | None = None) -> bool:
        x, y, z = p
        if self.get(x, y - 1, z) not in {GRASS, DIRT}:
            return False
        if not all(self.get(x, y + dy, z) in {AIR, SAPLING} for dy in range(5)):
            return False
        if not self.inside(x, y + 5, z):
            return False
        # Stable species selection does not depend on unrelated decoration RNG calls.
        species = forced_species or ("oak", "birch", "pine", "oak", "sakura", "autumn")[(x * 7 + z * 11 + self.seed) % 6]
        bark = "birch_bark" if species == "birch" else "pine_bark" if species == "pine" else "oak_bark"
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
            self.set_material((x, y + dy, z), bark)
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
        for i, p in enumerate(stone[:6]):
            kind = "iron_ore" if i % 2 else "coal"
            self.set_material(p, "iron_vein" if kind == "iron_ore" else "coal_vein")
            self.add_resource(kind, p, 40)
        rare_nodes = (
            ("gold_ore", "gold_vein", 24),
            ("crystal", "crystal_vein", 20),
            ("copper_ore", "copper_vein", 32),
            ("marble", "marble", 16),
            ("obsidian", "obsidian", 16),
        )
        for i, p in enumerate(stone[6:16]):
            kind, mat, cap = rare_nodes[i % len(rare_nodes)]
            self.set_material(p, mat)
            self.add_resource(kind, p, cap)
        # Ancient Teleport Gate Ruin Plinth at West Clearing Edge (stone only -> contract clean)
        for gz, mat in ((14, "obsidian"), (15, "marble"), (16, "obsidian")):
            self.set(10, 10, gz, STONE)
            self.set_material((10, 10, gz), mat)
            if self.get(10, 11, gz) != AIR:
                self.set(10, 11, gz, AIR)
        deep_crust = [p for p in self.positions(STONE) if p[1] <= 5]
        rng.shuffle(deep_crust)
        for p in deep_crust[:18]:
            self.set_material(p, "obsidian" if p[1] <= 4 else "sunstone")
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

    def export_state(self) -> dict:
        """Serialize complete world grid, surface materials, decorations and resource nodes."""
        sparse_materials = {str(idx): mat for idx, mat in enumerate(self.materials) if mat}
        return {
            "seed": self.seed,
            "biome": self.biome,
            "width": WIDTH,
            "height": HEIGHT,
            "depth": DEPTH,
            "blocks": list(self.blocks),
            "meta": list(self.meta),
            "materials": sparse_materials,
            "decorations": [
                {**d, "anchor": list(d["anchor"]) if isinstance(d.get("anchor"), tuple) else d.get("anchor")}
                for d in self.decorations
            ],
            "resource_nodes": {
                k: {**node, "position": dict(node["position"])}
                for k, node in self.resource_nodes.items()
            },
        }

    @classmethod
    def from_state(cls, data: dict) -> World:
        """Restore a World directly from exported save state without re-running procedural generation."""
        expected_len = WIDTH * HEIGHT * DEPTH
        blocks_raw = data.get("blocks")
        if not isinstance(blocks_raw, list) or len(blocks_raw) != expected_len:
            raise ValueError(f"Save world blocks must have length {expected_len}")
        meta_raw = data.get("meta")
        if meta_raw is None:
            meta_raw = [0] * expected_len
        elif not isinstance(meta_raw, list) or len(meta_raw) != expected_len:
            raise ValueError(f"Save world meta must have length {expected_len}")

        w = cls.__new__(cls)
        w.seed = int(data.get("seed", 66))
        biome = str(data.get("biome", "homestead"))
        w.biome = biome if biome in VALID_BIOMES else "homestead"
        w.rng = random.Random(w.seed)
        w.blocks = [int(b) if 0 <= int(b) < len(PALETTE) else AIR for b in blocks_raw]
        w.meta = [int(m) for m in meta_raw]

        w.materials = [""] * expected_len
        raw_mats = data.get("materials")
        if isinstance(raw_mats, dict):
            for idx_str, mat in raw_mats.items():
                idx = int(idx_str)
                if 0 <= idx < expected_len and isinstance(mat, str):
                    w.materials[idx] = mat
        elif isinstance(raw_mats, list) and len(raw_mats) == expected_len:
            w.materials = [str(m) if m else "" for m in raw_mats]

        w.locations = {block: set() for block in PALETTE}
        for y in range(HEIGHT):
            for z in range(DEPTH):
                base = y * WIDTH * DEPTH + z * WIDTH
                for x in range(WIDTH):
                    b = w.blocks[base + x]
                    if b != AIR:
                        w.locations[b].add((x, y, z))

        w.decorations = []
        for d in data.get("decorations", []):
            if not isinstance(d, dict):
                continue
            item = dict(d)
            anchor = item.get("anchor")
            if isinstance(anchor, list) and len(anchor) == 3:
                item["anchor"] = (int(anchor[0]), int(anchor[1]), int(anchor[2]))
            w.decorations.append(item)

        w.resource_nodes = {}
        for k, node in (data.get("resource_nodes") or {}).items():
            if isinstance(node, dict) and isinstance(node.get("position"), dict):
                w.resource_nodes[str(k)] = {
                    **node,
                    "position": {axis: int(node["position"][axis]) for axis in ("x", "y", "z")},
                }

        w.updates = {}
        return w
