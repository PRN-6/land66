"""Floating Sky Market catalog, pricing, and trade execution."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .simulation import Simulation


SHOP_ITEMS: list[dict] = [
    # Materials & Gems
    {"id": "marble", "name": "White Marble", "category": "Materials", "price": 18, "grant_item": "marble", "grant_qty": 4, "description": "Polished ivory architectural stone (x4)."},
    {"id": "obsidian", "name": "Obsidian", "category": "Materials", "price": 24, "grant_item": "obsidian", "grant_qty": 4, "description": "Dark volcanic glass stone (x4)."},
    {"id": "sandstone", "name": "Sandstone", "category": "Materials", "price": 12, "grant_item": "sandstone", "grant_qty": 4, "description": "Warm desert building stone (x4)."},
    {"id": "brick", "name": "Clay Brick", "category": "Materials", "price": 14, "grant_item": "brick", "grant_qty": 4, "description": "Kiln-fired red masonry brick (x4)."},
    {"id": "glass_pane", "name": "Glass Pane", "category": "Materials", "price": 16, "grant_item": "glass_pane", "grant_qty": 4, "description": "Clear skylight glazing (x4)."},
    {"id": "bamboo", "name": "Bamboo Bundle", "category": "Materials", "price": 14, "grant_item": "bamboo", "grant_qty": 6, "description": "Lightweight sunlit carpentry stalks (x6)."},
    {"id": "crystal", "name": "Crystal Cluster", "category": "Materials", "price": 32, "grant_item": "crystal", "grant_qty": 2, "description": "Luminous aquamarine cavern crystal (x2)."},
    {"id": "sunstone", "name": "Sunstone", "category": "Materials", "price": 45, "grant_item": "sunstone", "grant_qty": 1, "description": "Warm radiant crystal light stone."},
    {"id": "gold_ingot", "name": "Gold Ingot", "category": "Materials", "price": 38, "grant_item": "gold_ingot", "grant_qty": 2, "description": "Refined gilded bar (x2)."},
    {"id": "copper_ingot", "name": "Copper Ingot", "category": "Materials", "price": 22, "grant_item": "copper_ingot", "grant_qty": 3, "description": "Warm architectural copper bar (x3)."},
    {"id": "iron_ingot", "name": "Iron Ingot", "category": "Materials", "price": 20, "grant_item": "iron_ingot", "grant_qty": 3, "description": "Forged iron hardware bar (x3)."},
    # Tools & Home
    {"id": "axe", "name": "Artisan Axe", "category": "Tools & Home", "price": 35, "grant_item": "axe", "grant_qty": 1, "description": "Sturdy woodcutting axe (100% durability)."},
    {"id": "pickaxe", "name": "Miner Pickaxe", "category": "Tools & Home", "price": 38, "grant_item": "pickaxe", "grant_qty": 1, "description": "Steel-tipped ore pickaxe (100% durability)."},
    {"id": "hammer", "name": "Builder Hammer", "category": "Tools & Home", "price": 30, "grant_item": "hammer", "grant_qty": 1, "description": "Precision carpentry hammer (100% durability)."},
    {"id": "stove", "name": "Brick Stove Kit", "category": "Tools & Home", "price": 55, "grant_item": "stove", "grant_qty": 1, "description": "Warmth and indoor cooking fixture."},
    {"id": "rain_barrel", "name": "Rain Barrel", "category": "Tools & Home", "price": 40, "grant_item": "rain_barrel", "grant_qty": 1, "description": "Collects freshwater from rain showers."},
    {"id": "lantern", "name": "Copper Lantern", "category": "Tools & Home", "price": 25, "grant_item": "lantern", "grant_qty": 1, "description": "Cozy warm home lantern."},
    # Food & Farm
    {"id": "bread", "name": "Warm Bakery Loaf", "category": "Food & Farm", "price": 12, "grant_item": "bread", "grant_qty": 2, "description": "Fresh market loaves (x2)."},
    {"id": "berries", "name": "Wild Berry Basket", "category": "Food & Farm", "price": 10, "grant_item": "berries", "grant_qty": 4, "description": "Sweet island berries (x4)."},
    {"id": "seeds", "name": "Wheat Seeds", "category": "Food & Farm", "price": 8, "grant_item": "seeds", "grant_qty": 6, "description": "Heirloom wheat seeds (x6)."},
    {"id": "sapling", "name": "Tree Sapling", "category": "Food & Farm", "price": 10, "grant_item": "sapling", "grant_qty": 2, "description": "Young saplings to grow trees (x2)."},
    {"id": "compost", "name": "Rich Compost", "category": "Food & Farm", "price": 12, "grant_item": "compost", "grant_qty": 3, "description": "Boosts farmland crop fertility (x3)."},
    # Companions
    {"id": "pet_cat", "name": "Market Cat", "category": "Companions", "price": 60, "spawn_entity": "cat", "description": "Adopts a playful cat onto your island."},
    {"id": "pet_fox", "name": "Red Fox", "category": "Companions", "price": 70, "spawn_entity": "fox", "description": "Adopts a curious fox onto your island."},
    {"id": "pet_duck", "name": "Pond Duck", "category": "Companions", "price": 50, "spawn_entity": "duck", "description": "Adopts a friendly duck near water."},
    {"id": "pet_sheep", "name": "Wool Sheep", "category": "Companions", "price": 65, "spawn_entity": "sheep", "description": "Adopts a fluffy sheep onto your island."},
    {"id": "pet_deer", "name": "Forest Deer", "category": "Companions", "price": 85, "spawn_entity": "deer", "description": "Adopts a gentle deer onto your island."},
]

SHOP_BY_ID: dict[str, dict] = {item["id"]: item for item in SHOP_ITEMS}

SELL_PRICES: dict[str, int] = {
    "berries": 2,
    "wheat": 3,
    "bread": 7,
    "wood_log": 4,
    "wood_plank": 2,
    "stone": 3,
    "fiber": 2,
    "clay": 4,
    "sand": 3,
    "iron_ore": 7,
    "coal": 5,
    "copper_ore": 8,
    "gold_ore": 16,
    "crystal": 20,
    "marble": 6,
    "obsidian": 8,
    "sandstone": 4,
    "sunstone": 30,
    "bamboo": 3,
    "brick": 4,
    "glass_pane": 5,
    "iron_ingot": 9,
    "copper_ingot": 10,
    "gold_ingot": 22,
}


def market_catalog_payload(sim: Simulation, world_id: str) -> dict:
    return {
        "coins": int(sim.coins),
        "world": world_id,
        "shop_items": SHOP_ITEMS,
        "sell_prices": SELL_PRICES,
    }


def execute_buy(sim: Simulation, item_id: str, quantity: int = 1, agent_id: str | None = None) -> tuple[str, dict]:
    if quantity < 1 or quantity > 50:
        raise ValueError("Quantity must be between 1 and 50")
    item = SHOP_BY_ID.get(item_id)
    if not item:
        raise ValueError(f"Unknown shop item '{item_id}'")
    total_cost = int(item["price"]) * quantity
    if sim.coins < total_cost:
        raise ValueError(f"Not enough coins ({sim.coins} available, need {total_cost})")

    ag = sim._resolve_agent(agent_id)
    if "spawn_entity" in item:
        if quantity != 1:
            raise ValueError("Companions can only be adopted one at a time")
        sim._intervene_spawn_entity({"kind": item["spawn_entity"]})
        sim.coins -= total_cost
        msg = f"Adopted {item['name']} for {total_cost} coins."
    else:
        grant_item = str(item["grant_item"])
        grant_total = int(item.get("grant_qty", 1)) * quantity
        if grant_item not in ag.inventory:
            raise ValueError(f"Unsupported inventory key '{grant_item}'")
        sim.coins -= total_cost
        ag.inventory[grant_item] += grant_total
        if grant_item in ag.household.tools:
            ag.household.tools[grant_item] = 100.0
        msg = f"Purchased {item['name']} ({grant_total} {grant_item.replace('_', ' ')}) for {total_cost} coins."

    ag.remember(f"Sky Market: {msg}")
    ag.thought = f"I bought {item['name']} at the market."
    return msg, {
        "item_id": item_id,
        "quantity": quantity,
        "cost": total_cost,
        "coins": sim.coins,
    }


def execute_sell(sim: Simulation, item: str, quantity: int = 1, agent_id: str | None = None) -> tuple[str, dict]:
    if quantity < 1 or quantity > 999:
        raise ValueError("Quantity must be between 1 and 999")
    unit_price = SELL_PRICES.get(item)
    if not unit_price:
        raise ValueError(f"Merchants are not buying '{item}'")
    ag = sim._resolve_agent(agent_id)
    have = int(ag.inventory.get(item, 0))
    if have < quantity:
        raise ValueError(f"Not enough {item.replace('_', ' ')} ({have} owned, tried to sell {quantity})")
    earned = unit_price * quantity
    ag.inventory[item] = have - quantity
    sim.coins += earned
    msg = f"Sold {quantity} {item.replace('_', ' ')} for {earned} coins."
    ag.remember(f"Sky Market: {msg}")
    ag.thought = f"Made {earned} coins trading {item.replace('_', ' ')}!"
    return msg, {
        "item": item,
        "quantity": quantity,
        "earned": earned,
        "coins": sim.coins,
    }
