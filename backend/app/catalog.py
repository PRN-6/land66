"""Shared gameplay/renderer catalog. Legacy voxel IDs remain unchanged."""
from __future__ import annotations

# Colors are sRGB; roughness/metalness are renderer-ready PBR parameters.
MATERIALS = {
    "granite": dict(block=3, color="#8e9194", roughness=.94, metalness=0, texture="speckled"),
    "slate": dict(block=3, color="#626c78", roughness=.83, metalness=0, texture="stratified"),
    "mossy_stone": dict(block=3, color="#728263", roughness=1, metalness=0, texture="moss"),
    "iron_vein": dict(block=3, color="#a37a5d", roughness=.87, metalness=.18, texture="ore"),
    "coal_vein": dict(block=3, color="#393e43", roughness=.98, metalness=0, texture="ore"),
    "clay_bank": dict(block=2, color="#af785b", roughness=.97, metalness=0, texture="clay"),
    "sandy_bank": dict(block=2, color="#d7bd86", roughness=.96, metalness=0, texture="sand"),
    "meadow_grass": dict(block=1, color="#86a951", roughness=1, metalness=0, texture="grass"),
    "forest_grass": dict(block=1, color="#587c43", roughness=1, metalness=0, texture="grass"),
    "oak_bark": dict(block=5, color="#77513b", roughness=.98, metalness=0, texture="bark"),
    "birch_bark": dict(block=5, color="#d4cbb7", roughness=.9, metalness=0, texture="birch"),
    "pine_bark": dict(block=5, color="#684a36", roughness=.98, metalness=0, texture="bark"),
    "oak_foliage": dict(block=6, color="#5c8b46", roughness=1, metalness=0, texture="foliage"),
    "birch_foliage": dict(block=6, color="#91ad57", roughness=1, metalness=0, texture="foliage"),
    "pine_foliage": dict(block=6, color="#365f4c", roughness=1, metalness=0, texture="needles"),
    "oak_boards": dict(block=7, color="#be9060", roughness=.78, metalness=0, texture="wood_grain"),
    "brick": dict(block=8, color="#ac624c", roughness=.92, metalness=0, texture="brick_bond"),
    "cut_stone": dict(block=8, color="#97928a", roughness=.9, metalness=0, texture="masonry"),
    "terracotta_roof": dict(block=20, color="#a35e4c", roughness=.88, metalness=0, texture="overlapping_tiles"),
    "cedar_shingle": dict(block=20, color="#80543b", roughness=.9, metalness=0, texture="overlapping_shingles"),
    "linen_bedding": dict(block=12, color="#dfd1ae", roughness=1, metalness=0, texture="woven"),
    "clear_glass": dict(block=9, color="#c3e5e7", roughness=.08, metalness=0, transmission=.85, texture="glass"),
    "copper_lantern": dict(block=15, color="#d79b5a", roughness=.5, metalness=.6, emission="#ffc277", texture="metal"),
    "gold_vein": dict(block=3, color="#e0b548", roughness=.40, metalness=.78, texture="ore", label="Gold Vein"),
    "copper_vein": dict(block=3, color="#c6784e", roughness=.46, metalness=.74, texture="ore", label="Copper Vein"),
    "crystal_vein": dict(block=3, color="#70dce3", roughness=.18, metalness=.15, emission="#4dd6e0", texture="crystal", label="Crystal Vein"),
    "marble": dict(block=3, color="#eeeae2", roughness=.32, metalness=.04, texture="marble", label="White Marble"),
    "obsidian": dict(block=3, color="#252430", roughness=.22, metalness=.38, texture="obsidian", label="Obsidian"),
    "sunstone": dict(block=3, color="#f7c866", roughness=.28, metalness=.10, emission="#ffc85c", texture="crystal", label="Sunstone"),
    "sandstone": dict(block=8, color="#e1c78f", roughness=.86, metalness=0, texture="sandstone", label="Sandstone"),
    "mossy_brick": dict(block=8, color="#7d8c6c", roughness=.90, metalness=0, texture="brick_bond", label="Mossy Brick"),
    "copper_block": dict(block=8, color="#cc7b52", roughness=.36, metalness=.85, texture="metal", label="Copper Block"),
    "walnut_boards": dict(block=7, color="#6b4a36", roughness=.72, metalness=0, texture="wood_grain", label="Walnut Planks"),
    "bamboo_planks": dict(block=7, color="#c8cc7e", roughness=.62, metalness=0, texture="bamboo", label="Bamboo Panels"),
    "sakura_foliage": dict(block=6, color="#f4a8be", roughness=.68, metalness=0, texture="blossom", label="Sakura Leaves"),
    "autumn_foliage": dict(block=6, color="#df894c", roughness=.72, metalness=0, texture="foliage", label="Autumn Leaves"),
    "stained_glass": dict(block=9, color="#9bc4e8", roughness=.12, metalness=.05, transmission=.80, texture="glass", label="Azure Glass"),
    "slate_roof": dict(block=20, color="#496572", roughness=.66, metalness=0, texture="overlapping_tiles", label="Slate Roof"),
}

BASE_ITEMS = ("wood_log", "wood_plank", "stone", "seeds", "wheat", "berries", "sapling", "bread")
EXTRA_ITEMS = ("fiber", "clay", "sand", "iron_ore", "coal", "gold_ore", "crystal", "copper_ore",
               "marble", "obsidian", "sandstone", "sunstone", "bamboo",
               "rope", "cloth", "brick", "glass_pane", "iron_ingot", "gold_ingot", "copper_ingot",
               "nails", "shingles", "firewood", "soap", "bedding", "axe", "pickaxe", "hammer",
               "table", "chair", "stove", "rain_barrel", "washbasin", "pantry", "compost_bin", "lantern", "compost")
INVENTORY_KEYS = BASE_ITEMS + EXTRA_ITEMS
ITEMS = {key: {"name": key.replace("_", " ").title(), "category": "raw_material"} for key in INVENTORY_KEYS}
for key in ("berries", "bread", "wheat"):
    ITEMS[key]["category"] = "food"
for key in ("axe", "pickaxe", "hammer"):
    ITEMS[key].update(category="tool", max_durability=100)
for key in ("seeds", "sapling", "compost"):
    ITEMS[key]["category"] = "gardening"
for key in ("table", "chair", "stove", "rain_barrel", "washbasin", "pantry", "compost_bin", "lantern", "bedding"):
    ITEMS[key]["category"] = "household"


def recipe(inputs, outputs, seconds=3, station=None):
    return dict(inputs=inputs, outputs=outputs, duration=seconds, station=station)


RECIPES = {
    "planks": recipe({"wood_log": 1}, {"wood_plank": 4}, 2),
    "bread": recipe({"wheat": 3}, {"bread": 1}, 2),
    "rope": recipe({"fiber": 3}, {"rope": 2}),
    "cloth": recipe({"fiber": 4}, {"cloth": 2}, 4),
    "brick": recipe({"clay": 3, "coal": 1}, {"brick": 4}, 5),
    "glass_pane": recipe({"sand": 3, "coal": 1}, {"glass_pane": 4}, 5),
    "iron_ingot": recipe({"iron_ore": 2, "coal": 1}, {"iron_ingot": 2}, 6),
    "nails": recipe({"iron_ingot": 1}, {"nails": 12}, 3),
    "shingles": recipe({"wood_plank": 2}, {"shingles": 8}, 3),
    "firewood": recipe({"wood_log": 1}, {"firewood": 6}, 2),
    "soap": recipe({"fiber": 2, "coal": 1}, {"soap": 4}, 4),
    "bedding": recipe({"cloth": 3, "fiber": 2}, {"bedding": 1}, 4),
    "axe": recipe({"stone": 2, "wood_plank": 1, "rope": 1}, {"axe": 1}, 4),
    "pickaxe": recipe({"stone": 3, "wood_plank": 1, "rope": 1}, {"pickaxe": 1}, 4),
    "hammer": recipe({"stone": 1, "wood_plank": 1}, {"hammer": 1}, 3),
    "table": recipe({"wood_plank": 4, "nails": 4}, {"table": 1}, 4, "crafting_bench"),
    "chair": recipe({"wood_plank": 2, "nails": 2}, {"chair": 1}, 3, "crafting_bench"),
    "stove": recipe({"brick": 8, "iron_ingot": 2}, {"stove": 1}, 6, "crafting_bench"),
    "rain_barrel": recipe({"wood_plank": 6, "rope": 2, "iron_ingot": 1}, {"rain_barrel": 1}, 5, "crafting_bench"),
    "washbasin": recipe({"clay": 4, "wood_plank": 2}, {"washbasin": 1}, 4, "crafting_bench"),
    "pantry": recipe({"wood_plank": 6, "nails": 4}, {"pantry": 1}, 4, "crafting_bench"),
    "compost_bin": recipe({"wood_plank": 4, "rope": 1}, {"compost_bin": 1}, 3, "crafting_bench"),
    "lantern": recipe({"iron_ingot": 1, "glass_pane": 1, "coal": 1}, {"lantern": 1}, 4, "crafting_bench"),
    "compost": recipe({"fiber": 3}, {"compost": 2}, 4, "compost_bin"),
    "gold_ingot": recipe({"gold_ore": 2, "coal": 1}, {"gold_ingot": 2}, 6),
    "copper_ingot": recipe({"copper_ore": 2, "coal": 1}, {"copper_ingot": 2}, 5),
    "sunstone": recipe({"crystal": 2, "gold_ingot": 1}, {"sunstone": 1}, 5, "crafting_bench"),
}

FIXTURES = {
    "stove": dict(position=(17, 11, 14), block=8, material="brick", purpose="Cooking and indoor warmth", comfort=9),
    "rain_barrel": dict(position=(11, 11, 17), block=13, material=None, purpose="Rain collection and household water", comfort=4),
    "washbasin": dict(position=(13, 11, 17), block=13, material=None, purpose="Washing and hygiene", comfort=7),
    "pantry": dict(position=(17, 11, 17), block=13, material=None, purpose="Stores food with less spoilage", comfort=5),
    "table": dict(position=(15, 11, 13), block=7, material="oak_boards", purpose="Meals and a place to write", comfort=6),
    "chair": dict(position=(15, 11, 14), block=7, material="oak_boards", purpose="Comfortable indoor rest", comfort=4),
    "compost_bin": dict(position=(21, 11, 20), block=13, material=None, purpose="Turns plant fiber into fertilizer", comfort=2),
    "lantern": dict(position=(16, 12, 17), block=15, material="copper_lantern", purpose="Warm interior light", comfort=4),
}
REPAIRS = {
    "roof": {"shingles": 2, "nails": 2},
    "walls": {"wood_plank": 2, "nails": 2},
    "foundation": {"stone": 2},
    "furniture": {"wood_plank": 1, "cloth": 1},
}
RESOURCE_KINDS = ("fiber", "clay", "sand", "iron_ore", "coal", "gold_ore", "crystal", "copper_ore")
TOOL_FOR_ACTION = {"chop": "axe", "mine": "pickaxe", "gather": "pickaxe", "build": "hammer", "repair": "hammer"}


def catalog_snapshot():
    from .world import PALETTE
    return dict(version=2, blocks={str(k): v for k, v in PALETTE.items()}, materials=MATERIALS,
                items=ITEMS, recipes=RECIPES, fixtures=FIXTURES, repairs=REPAIRS,
                resource_kinds=list(RESOURCE_KINDS))
