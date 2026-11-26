import math
import pytest
from app.simulation import Simulation, DAY_SECONDS
from app.models import Decision
from app.world import AIR, LOG, DOOR, OPEN_DOOR, FARMLAND, WHEAT, SAPLING


def finish(s, limit=2000):
    for _ in range(limit):
        s.step(.1)
        if not s.job:
            return
    pytest.fail(f"Action did not finish: {s.current_action}, {s.grid_pos}, {s.target}")


def completed_house():
    s = Simulation()
    for b in s.blueprint:
        s.world.set(*b.pos,b.block)
    return s


def test_needs_eating_drinking_and_sleeping():
    s = Simulation()
    before = dict(s.needs)
    s.update_needs(10)
    assert s.needs['hunger'] < before['hunger'] and s.needs['thirst'] < before['thirst']
    s.inventory['berries'] = 1
    s.needs['hunger'] = 30
    assert s.start_action('eat')
    finish(s)
    assert s.needs['hunger'] > 47 and not s.inventory['berries']
    s.needs['thirst'] = 20
    assert s.start_action('drink')
    finish(s)
    assert s.needs['thirst'] > 75
    s = completed_house()
    s.needs['energy'] = 30
    assert s.start_action('sleep')
    finish(s)
    assert s.needs['energy'] > 60
    assert s.shelter()['sheltered'] and s.shelter()['near_bed']


def test_exposure_protection_and_bounds():
    outside = Simulation()
    inside = completed_house()
    inside.grid_pos, inside.position = (15,11,15), [15.,11.,15.]
    for s in (outside,inside):
        s.weather = 'storm'
        s.update_needs(10)
    assert outside.needs['health'] < inside.needs['health']
    assert outside.needs['mood'] < inside.needs['mood']
    outside.needs['hunger'] = .01
    outside.update_needs(100)
    assert all(0 <= n <= 100 for n in outside.needs.values())


def test_movement_is_smooth_and_opens_doors():
    s = completed_house()
    assert s.start_action('walk',dict(x=15,y=11,z=15))
    while s.job:
        before = list(s.position)
        s.step(.1)
        assert math.dist(before,s.position) <= .24001
        assert s.world.walkable(s.grid_pos)
    assert s.grid_pos == (15,11,15)
    assert s.world.get(15,11,18) == OPEN_DOOR
    assert s.world.get(15,12,18) == OPEN_DOOR
    assert s.house_progress() == 100


def test_block_by_block_building_consumes_materials():
    s = Simulation()
    assert not s.start_action('build')
    s.inventory['stone'] = 1
    first = s.next_build()
    assert s.start_action('build')
    assert s.world.get(*first.pos) != first.block
    finish(s)
    assert s.world.get(*first.pos) == first.block
    assert s.inventory['stone'] == 0
    assert 0 < s.house_progress() < 1
    assert s.blocks_placed == 1


def test_chopping_takes_time_and_crafting_conserves_resources():
    s = Simulation()
    assert s.start_action('chop')
    target = s.target
    while s.path:
        s.step(.1)
    s.step(.1)
    assert s.world.get(*target) == LOG and s.inventory['wood_log'] == 0
    finish(s)
    assert s.world.get(*target) == AIR
    assert s.inventory['wood_log'] == 4 and s.inventory['sapling'] and s.inventory['seeds']
    assert s.start_action('craft',{'recipe':'planks'})
    finish(s)
    assert s.inventory['wood_log'] == 3 and s.inventory['wood_plank'] == 4
    assert not s.start_action('craft',{'recipe':'bread'})


def test_farm_rain_growth_harvest_and_bread():
    s = Simulation()
    s.inventory['seeds'] = 2
    for action in ('till','plant'):
        assert s.start_action(action)
        finish(s)
    crop = s.world.positions(WHEAT)[0]
    soil = (crop[0],crop[1]-1,crop[2])
    s.update_ecology(100)
    assert s.world.get_meta(*crop) == 0  # Dry soil does not grow crops.
    s.weather = 'rain'
    s.update_ecology(25)
    assert s.world.get_meta(*soil) == 1 and s.world.get_meta(*crop) == 1
    s.update_ecology(50)
    assert s.world.get_meta(*crop) == 3
    assert s.start_action('harvest')
    finish(s)
    assert s.inventory['wheat'] == 2 and s.inventory['seeds'] == 3
    assert s.world.get(*crop) == AIR
    s.inventory['wheat'] += 1
    assert s.start_action('craft',{'recipe':'bread'})
    finish(s)
    assert s.inventory['wheat'] == 0 and s.inventory['bread'] == 1
    s.needs['hunger'] = 30
    assert s.start_action('eat')
    finish(s)
    assert s.needs['hunger'] > 67 and not s.inventory['bread']


def test_sapling_grows_and_pause_step_semantics():
    s = Simulation()
    # A dense untouched forest has no vacant planting site; first make a clearing.
    assert s.start_action('chop')
    finish(s)
    assert s.start_action('plant_sapling')
    target = s.target
    finish(s)
    assert s.world.get(*target) == SAPLING
    s.update_ecology(121)
    assert s.world.get(*target) == LOG
    tick = s.tick
    s.paused = True
    s.step()
    assert s.tick == tick
    s.step(force=True)
    assert s.tick == tick+1 and s.paused


@pytest.mark.parametrize('seed',[1,66,928])
def test_autonomous_progression_from_empty_inventory(seed):
    s = Simulation(seed)
    assert not any(s.inventory.values())
    actions, stages = set(), set()
    for i in range(4000):
        s.step(1)
        actions.add(s.current_action)
        if i % 100 == 0:
            stages.add(s.snapshot()['stats']['house_stage'])
            assert s.world.walkable(s.grid_pos)
    assert s.house_progress() == 100
    assert len(s.world.locations[FARMLAND]) == 8
    assert {'explore','forage','chop','mine','build','till','plant','water','harvest','craft','sleep','plant_sapling'} <= actions
    assert {'foundation','walls','roof','complete'} <= stages
    assert s.inventory['bread'] > 0 and s.inventory['wheat'] > 0
    assert min(s.needs.values()) > 0
    assert s.journal and s.memories
    assert all(v >= 0 for v in s.inventory.values())
    assert len(s.world.locations[12]) == 1  # Exactly one bed, one coherent house.


@pytest.mark.parametrize('params',[{'x':-1,'y':11,'z':15},{'x':15.5,'y':11,'z':15},{'x':True,'y':11,'z':15},{'x':15,'y':99,'z':15},{}])
def test_invalid_llm_coordinates_rejected(params):
    s = Simulation()
    assert not s.apply_decision(Decision(thought='Go there',goal='Explore',action='walk',params=params))
    assert s.job is None


def test_interventions_validate_atomically():
    s = Simulation()
    with pytest.raises(ValueError):
        s.intervene('drop_gift',{'berries':2,'unknown':3})
    assert s.inventory['berries'] == 0
    s.intervene('drop_gift',{'item':'berries','amount':3})
    assert s.inventory['berries'] == 3
    s.intervene('set_time',.5)
    assert s.clock_str == '12:00' and s.phase == 'afternoon'
    s.intervene('whisper','Please grow wheat')
    assert 'Please grow wheat' in s.memories[-1]['text']
    s.intervene('heal_npc',None)
    assert all(n == 100 for n in s.needs.values())
    for action,value in [('set_time',1),('set_time',float('nan')),('set_weather','snow'),('spawn_tree',{'x':15,'z':15})]:
        with pytest.raises(ValueError):
            s.intervene(action,value)


def test_simulation_save_load_roundtrip():
    s = Simulation(seed=77)
    s.step(0.5, force=True)
    s.intervene('set_weather', 'storm')
    s.intervene('spawn_object', {'object': 'wheat', 'x': 19, 'z': 19})
    s.intervene('spawn_entity', {'kind': 'cat', 'name': 'Milo'})
    s.world.set(17, 11, 14, 8)
    s.home.water = 42.5
    s.home.fuel = 18.0
    s.home.installed.add('stove')
    s.home.storage['bread'] = 4
    s.home.fertilized_plots.add((19, 10, 19))

    elena = s.add_agent(name='Elena', role='builder')
    elena.inventory['wood_log'] = 9
    elena.household.tools['axe'] = 0.75
    elena.thought = 'Finish the roof shingles today.'

    exported = s.export_save()
    restored = Simulation.from_save(exported)

    assert restored.seed == 77
    assert restored.tick == s.tick
    assert restored.weather == 'storm' and restored.weather_override is True
    assert restored.world.blocks == s.world.blocks
    assert restored.world.meta == s.world.meta
    assert restored.world.materials == s.world.materials
    assert restored.world.locations == s.world.locations
    assert restored.home.water == 42.5 and restored.home.fuel == 18.0
    assert 'stove' in restored.home.installed and restored.home.storage['bread'] == 4
    assert (19, 10, 19) in restored.home.fertilized_plots
    assert restored.crop_age == s.crop_age
    assert len(restored.entities) == 1 and restored.entities[0]['name'] == 'Milo'
    assert elena.id in restored.agents
    assert restored.agents[elena.id].name == 'Elena'
    assert restored.agents[elena.id].inventory['wood_log'] == 9
    assert restored.agents[elena.id].household.tools['axe'] == 0.75
    assert restored.agents[elena.id].thought == 'Finish the roof shingles today.'
    restored.step(0.2, force=True)
    assert restored.tick == s.tick + 1


def test_world_new_materials_and_spawn():
    s = Simulation(seed=66)
    mats = set(s.world.materials)
    assert {'gold_vein', 'crystal_vein', 'marble', 'obsidian', 'sunstone'} <= mats
    kinds = {n['kind'] for n in s.world.resource_nodes.values()}
    assert {'gold_ore', 'crystal', 'copper_ore'} <= kinds

    s.intervene('spawn_object', {'object': 'crystal_vein', 'x': 15, 'y': 11, 'z': 15})
    assert s.world.get(15, 11, 15) == 3
    assert s.world.materials[s.world.index(15, 11, 15)] == 'crystal_vein'
    updates = s.world.drain_updates()
    assert any(u['x'] == 15 and u['z'] == 15 and u.get('material') == 'crystal_vein' for u in updates)


def test_market_world_generation_and_save_roundtrip():
    m = Simulation(seed=166, biome='market', coins=320)
    assert m.biome == 'market'
    assert m.coins == 320
    assert m.house_progress() == 100.0
    assert any(e['name'] == 'Baker Pip' for e in m.entities)
    assert 'marble' in m.world.materials and 'terracotta_roof' in m.world.materials
    m.step(0.5, force=True)
    exported = m.export_save()
    restored = Simulation.from_save(exported)
    assert restored.biome == 'market' and restored.coins == 320
    assert restored.world.biome == 'market'


def test_teleport_gate_riddles_study_and_assembly():
    s = Simulation(seed=66)
    assert not s.gate_discovered and not s.gate_unlocked
    assert s.gate_progress() == 0.0

    ok_wrong, hint = s.decipher_gate_rune('anchor', 'granite')
    assert not ok_wrong and 'volcanic' in hint.lower()

    assert s.decipher_gate_rune('anchor', 'obsidian')[0]
    assert s.decipher_gate_rune('conduit', 'crystal')[0]
    assert s.decipher_gate_rune('core', 'sunstone')[0]
    assert s.gate_discovered and not s.gate_unlocked

    # Give required gate materials and assemble all 7 blocks
    s.inventory['obsidian'] = 2
    s.inventory['marble'] = 2
    s.inventory['crystal'] = 2
    s.inventory['sunstone'] = 1
    for _ in range(7):
        s.assemble_gate_block()
    assert s.gate_progress() == 100.0
    assert s.gate_unlocked

    exported = s.export_save()
    restored = Simulation.from_save(exported)
    assert restored.gate_discovered and restored.gate_unlocked
