import pytest
from app.world import World, WORLD_PRESETS, PALETTE, GRASS, STONE, WATER, LOG, LEAVES, DOOR, AIR
from app.pathfinding import astar


def empty_world():
    w = World()
    w.blocks = [0] * len(w.blocks)
    w.meta = [0] * len(w.meta)
    w.locations = {k: set() for k in PALETTE}
    w.updates.clear()
    return w


@pytest.mark.parametrize("seed", [0, 1, 66, 928])
def test_seeded_floating_island(seed):
    w = World(seed)
    assert w.blocks == World(seed).blocks
    assert len(w.blocks) == len(w.meta) == 24576
    assert all(0 <= b <= 21 for b in w.blocks)
    assert not any(w.blocks[:3*1024])
    assert not any(w.get(0,y,z) for y in range(24) for z in range(32))
    assert not any(w.get(x,y,0) for y in range(24) for x in range(32))
    assert w.locations[WATER] and len(w.locations[LOG]) >= 80 and w.locations[LEAVES]
    assert w.locations[18]
    assert all(not w.locations[b] for b in (7,8,9,10,11,12,13,14,15,16,17,19,20,21))
    assert all(10 <= y <= 12 for _,y,_ in w.positions(GRASS))
    assert min(y for _,y,_ in w.positions(STONE)) in (3,4)
    assert w.walkable((16,11,20))


def test_seed_changes_world_and_index_and_deltas():
    w = World(1)
    assert w.blocks != World(2).blocks
    assert World.index(31,23,31) == 24575
    assert World.index(5,8,9) == 8*32*32+9*32+5
    assert w.set(0,0,0,16,8)
    assert w.get_meta(0,0,0) == 1
    w.set(0,0,0,17,9)
    assert w.drain_updates() == [dict(x=0,y=0,z=0,block=17,meta=3)]
    assert w.drain_updates() == []
    assert not w.set(-1,0,0,STONE)


def test_astar_steps_up_and_down_and_never_crosses_void():
    w = empty_world()
    for x,y in ((1,0),(2,1),(3,1),(4,0)):
        w.set(x,y,2,STONE)
    path = astar(w, (1,1,2), (4,1,2))
    assert path == [(2,2,2),(3,2,2),(4,1,2)]
    assert all(w.walkable(p) for p in path)
    assert astar(w, (1,1,2), (5,1,2)) is None
    w.set(3,1,2,AIR)
    assert astar(w, (1,1,2), (4,1,2)) is None


def test_astar_two_block_clearance_and_closed_door():
    w = empty_world()
    for x in range(1,5):
        w.set(x,0,2,STONE)
    w.set(2,1,2,DOOR)
    w.set(2,2,2,DOOR)
    assert astar(w,(1,1,2),(4,1,2))
    w.set(3,2,2,STONE)
    assert astar(w,(1,1,2),(4,1,2)) is None


def test_cannot_step_two_blocks_or_bump_head():
    w = empty_world()
    w.set(1,0,1,STONE)
    w.set(2,2,1,STONE)
    assert astar(w,(1,1,1),(2,3,1)) is None
    w.set(2,2,1,AIR)
    w.set(2,1,1,STONE)
    w.set(1,3,1,STONE)
    assert astar(w,(1,1,1),(2,2,1)) is None


@pytest.mark.parametrize("preset", sorted(WORLD_PRESETS.keys()))
def test_all_world_presets_have_valid_spawn_and_water(preset):
    w = World(seed=321, biome=preset)
    assert w.biome == preset
    assert len(w.blocks) == len(w.meta) == 24576
    assert w.locations[WATER]
    spawn = (16, 11, 22) if preset == "market" else w.feet_at(16, 20)
    assert spawn is not None and w.walkable(spawn)
