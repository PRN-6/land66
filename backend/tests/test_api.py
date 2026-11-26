import time
from fastapi.testclient import TestClient
from app.main import create_app
from app.brain import Brain
from app.models import LLMConfig


def client_app():
    return create_app(seed=66,brain=Brain(LLMConfig()))


def next_type(ws, kind):
    for _ in range(40):
        msg = ws.receive_json()
        if msg['type'] == kind:
            return msg
    raise AssertionError(f'No {kind} frame received')


def test_health_state_cors_and_control():
    with TestClient(client_app()) as client:
        assert client.get('/api/health').json() == {'ok':True}
        assert client.get('/api/health',headers={'Origin':'http://localhost:5173'}).headers['access-control-allow-origin'] == '*'
        state = client.post('/api/sim/control',json={'action':'pause'}).json()
        tick = state['tick']
        time.sleep(.15)
        assert client.get('/api/state').json()['tick'] == tick
        state = client.post('/api/sim/control',json={'action':'step'}).json()
        assert state['tick'] == tick+1 and state['paused']
        assert client.post('/api/sim/control',json={'action':'set_speed','speed':5}).json()['speed'] == 5
        assert client.post('/api/sim/control',json={'action':'set_speed','speed':3}).status_code == 422
        assert client.post('/api/sim/control',json={'action':'set_speed'}).status_code == 422
        state = client.post('/api/sim/control',json={'action':'reset','seed':19}).json()
        assert state['tick'] == 0 and state['seed'] == 19
        state = client.post('/api/sim/control',json={'action':'resume'}).json()
        assert not state['paused']
        assert {'name','position','grid_pos','yaw','animation','action_progress','current_action','current_goal','thought','needs','inventory','target_block','path','perception','memories','journal'} <= state['npc'].keys()


def test_configuration_secret_masking_models_and_traces():
    with TestClient(client_app()) as client:
        assert client.get('/api/llm/config').json()['has_api_key'] is False
        reply = client.post('/api/llm/config',json={'provider':'custom','base_url':'http://localhost:1234/v1','model':'local','api_key':'do-not-return-me','enabled':False})
        assert reply.status_code == 200
        assert reply.json()['has_api_key'] and 'api_key' not in reply.json()
        assert 'do-not-return-me' not in client.get('/api/llm/config').text
        assert client.post('/api/llm/config',json={'temperature':99}).status_code == 422
        assert client.post('/api/llm/config',json={'base_url':'file:///etc/passwd'}).status_code == 422
        client.post('/api/llm/config',json={'provider':'fallback'})
        assert client.post('/api/llm/test').json()['ok']
        assert client.post('/api/llm/test',json={'provider':'openai','model':'gpt-4o-mini'}).json()['ok'] is False
        assert client.get('/api/llm/models').json()['models'] == []
        assert client.get('/api/llm/models?provider=openai').json()['models'] == ['gpt-4o-mini','gpt-4o']
        assert isinstance(client.get('/api/llm/detect').json()['detected'],list)
        traces = client.get('/api/llm/traces?limit=30')
        assert traces.status_code == 200 and isinstance(traces.json(),list)
        assert client.get('/api/llm/traces?limit=1000').status_code == 422


def test_god_endpoints_and_invalid_values():
    with TestClient(client_app()) as client:
        client.post('/api/sim/control',json={'action':'pause'})
        for action,value in [('set_time',.25),('set_weather','rain'),('whisper','Build a home'),('drop_gift',{'bread':3}),('heal_npc',None)]:
            assert client.post('/api/god/intervene',json={'action':action,'value':value}).status_code == 200
        state = client.get('/api/state').json()
        assert state['clock_str'] == '06:00' and state['weather'] == 'rain'
        assert state['npc']['inventory']['bread'] == 3
        assert client.post('/api/god/intervene',json={'action':'spawn_object','value':{'object':'torch'}}).status_code == 200
        assert client.post('/api/god/intervene',json={'action':'spawn_entity','value':{'kind':'cat','name':'Mochi'}}).status_code == 200
        assert client.post('/api/god/intervene',json={'action':'spawn_entity','value':{'kind':'companion','name':'Maya'}}).status_code == 200
        state2 = client.get('/api/state').json()
        assert len(state2['entities']) == 2
        assert state2['entities'][0]['name'] == 'Mochi'
        assert client.post('/api/god/intervene',json={'action':'clear_entities'}).status_code == 200
        assert client.get('/api/state').json()['entities'] == []
        assert client.post('/api/god/intervene',json={'action':'drop_gift','value':{'stone':-1}}).status_code == 422
        assert client.post('/api/god/intervene',json={'action':'set_time','value':'noon'}).status_code == 422


def test_multi_agent_brains_and_management():
    with TestClient(client_app()) as client:
        agents = client.get('/api/agents').json()
        assert len(agents) == 1 and agents[0]['id'] == 'aiden'
        created = client.post('/api/agents',json={'name':'Elena','role':'farmer','llm_config':{'provider':'custom','base_url':'http://localhost:1234/v1','model':'qwen-farm','enabled':True}})
        assert created.status_code == 200
        elena = created.json()
        assert elena['name'] == 'Elena' and elena['role'] == 'farmer'
        assert elena['llm_config']['model'] == 'qwen-farm'
        # Independent per-NPC brain configuration
        assert client.get('/api/llm/config').json()['provider'] == 'fallback'
        assert client.get(f"/api/llm/config?agent_id={elena['id']}").json()['model'] == 'qwen-farm'
        # Targeted whisper & heal
        assert client.post('/api/god/intervene',json={'action':'whisper','value':'Tend the wheat','agent_id':elena['id']}).status_code == 200
        state = client.get('/api/state').json()
        assert len(state['agents']) == 2
        assert 'Tend the wheat' in state['agents'][1]['thought']
        # Cannot delete primary NPC Aiden, can delete Elena
        assert client.delete('/api/agents/aiden').status_code == 422
        assert client.delete(f"/api/agents/{elena['id']}").status_code == 200
        assert len(client.get('/api/agents').json()) == 1


def test_websocket_initial_ticks_trace_and_reset():
    with TestClient(client_app()) as client:
        with client.websocket_connect('/ws') as ws:
            initial = ws.receive_json()
            assert initial['type'] == 'world_init'
            assert initial['dimensions'] == {'width':32,'height':24,'depth':32}
            assert initial['index_formula'] == 'y * width * depth + z * width + x'
            assert len(initial['blocks']) == len(initial['block_meta']) == 24576
            assert initial['palette']['21'] == 'fence'
            update = next_type(ws,'tick_update')
            assert isinstance(update['block_updates'],list) and update['state']['tick'] > 0
            client.post('/api/llm/config',json={'provider':'fallback','decision_interval_ticks':10})
            trace = next_type(ws,'llm_trace')['trace']
            assert {'id','timestamp','provider','model','latency_ms','prompt_summary','raw_prompt','raw_response','parsed_decision','used_fallback','error'} <= trace.keys()
            assert trace['used_fallback']
            client.post('/api/sim/control',json={'action':'reset','seed':100})
            reset = next_type(ws,'world_init')
            assert reset['state']['seed'] == 100 and reset['state']['tick'] == 0
            assert reset['blocks'] != initial['blocks']
        assert not client.app.state.runtime.clients


def test_two_clients_receive_identical_block_deltas():
    app = client_app()
    with TestClient(app) as client:
        client.post('/api/sim/control',json={'action':'pause'})
        with client.websocket_connect('/ws') as a, client.websocket_connect('/ws') as b:
            assert a.receive_json()['type'] == b.receive_json()['type'] == 'world_init'
            # A natural-ground coordinate verified against this generated world.
            world = app.state.runtime.sim.world
            target = next(p for p in world.positions(1) if not (10<=p[0]<=25 and 10<=p[2]<=23)
                          and all(world.get(p[0],p[1]+dy,p[2]) == 0 for dy in range(1,7)))
            response = client.post('/api/god/intervene',json={'action':'spawn_tree','value':{'x':target[0],'y':target[1]+1,'z':target[2]}})
            assert response.status_code == 200
            delta_a,delta_b = next_type(a,'tick_update'),next_type(b,'tick_update')
            assert delta_a['block_updates'] == delta_b['block_updates']
            assert any(p['block'] == 5 for p in delta_a['block_updates'])


def test_save_load_download_upload_and_slots(tmp_path, monkeypatch):
    import app.save_store as save_store
    monkeypatch.setattr(save_store, 'SAVES_DIR', tmp_path / 'saves')

    with TestClient(client_app()) as client:
        with client.websocket_connect('/ws') as ws:
            assert ws.receive_json()['type'] == 'world_init'
            client.post('/api/sim/control', json={'action': 'pause'})
            client.post('/api/llm/config', json={'provider': 'openai', 'api_key': 'sk-secret-do-not-save', 'enabled': False})
            mira = client.post('/api/agents', json={'name': 'Mira', 'role': 'farmer'}).json()
            client.post(f"/api/llm/config?agent_id={mira['id']}", json={'provider': 'ollama', 'model': 'qwen2.5-coder:7b', 'enabled': False})
            client.post('/api/god/intervene', json={'action': 'spawn_entity', 'value': {'kind': 'cat', 'name': 'Luna'}})

            save_res = client.post('/api/sim/saves', json={'name': 'My Island Checkpoint'})
            assert save_res.status_code == 200
            slot = save_res.json()['save']['slot']
            assert slot == 'my-island-checkpoint'

            listed = client.get('/api/sim/saves').json()['saves']
            assert len(listed) == 1 and listed[0]['agents_count'] == 2 and listed[0]['entities_count'] == 1

            dl = client.get('/api/sim/save')
            assert dl.status_code == 200
            assert 'sk-secret-do-not-save' not in dl.text
            exported = dl.json()
            assert exported['format'] == 'land66-save-v1'

            client.post('/api/sim/control', json={'action': 'reset', 'seed': 99})
            reset_init = next_type(ws, 'world_init')
            assert reset_init['state']['seed'] == 99 and len(reset_init['state']['agents']) == 1

            load_slot = client.post(f'/api/sim/saves/{slot}/load')
            assert load_slot.status_code == 200
            restored_init = next_type(ws, 'world_init')
            assert restored_init['state']['stats']['agents_count'] == 2
            assert restored_init['state']['entities'][0]['name'] == 'Luna'
            mira_cfg = client.get(f"/api/llm/config?agent_id={mira['id']}").json()
            assert mira_cfg['model'] == 'qwen2.5-coder:7b'

            client.post('/api/sim/control', json={'action': 'reset', 'seed': 123})
            next_type(ws, 'world_init')
            upload_res = client.post('/api/sim/load', json=exported)
            assert upload_res.status_code == 200
            assert next_type(ws, 'world_init')['state']['stats']['agents_count'] == 2

            assert client.post('/api/sim/saves', json={'name': '!!!'}).status_code == 422
            assert client.delete(f'/api/sim/saves/{slot}').status_code == 200
            assert client.get('/api/sim/saves').json()['saves'] == []


def test_module_exposes_asgi_app():
    from app.main import app as asgi_app
    assert asgi_app is not None
    with TestClient(asgi_app) as client:
        assert client.get('/api/health').json()['ok'] is True


def test_world_init_includes_materials_and_spawn_material_delta():
    with TestClient(client_app()) as client:
        client.post('/api/sim/control', json={'action': 'pause'})
        with client.websocket_connect('/ws') as ws:
            initial = ws.receive_json()
            assert len(initial['block_materials']) == 24576
            assert 'crystal_vein' in initial['materials_catalog']
            res = client.post('/api/god/intervene', json={
                'action': 'spawn_object',
                'value': {'object': 'marble', 'x': 14, 'y': 11, 'z': 14},
            })
            assert res.status_code == 200
            delta = next_type(ws, 'tick_update')
            assert any(
                u['x'] == 14 and u['y'] == 11 and u['z'] == 14 and u.get('material') == 'marble'
                for u in delta['block_updates']
            )


def test_switch_to_market_world_and_buy_sell():
    with TestClient(client_app()) as client:
        with client.websocket_connect('/ws') as ws:
            init_home = ws.receive_json()
            assert init_home['state']['world_id'] == 'homestead'
            assert init_home['state']['coins'] == 250
            assert init_home['state']['gate']['unlocked'] is False

            # Cannot travel to Sky Market until the Teleport Gate is deciphered and built
            locked_res = client.post('/api/world/switch', json={'world': 'market'})
            assert locked_res.status_code == 403

            # Solve the 3 gate blueprint clues
            assert not client.post('/api/gate/decipher', json={'rune': 'anchor', 'answer': 'granite'}).json()['correct']
            assert client.post('/api/gate/decipher', json={'rune': 'anchor', 'answer': 'obsidian'}).json()['correct']
            assert client.post('/api/gate/decipher', json={'rune': 'conduit', 'answer': 'crystal'}).json()['correct']
            core = client.post('/api/gate/decipher', json={'rune': 'core', 'answer': 'sunstone'}).json()
            assert core['correct'] and core['gate']['discovered'] is True

            # Provide gate materials + berries and assemble the 7-block gate
            client.post('/api/god/intervene', json={
                'action': 'drop_gift',
                'value': {'obsidian': 2, 'marble': 2, 'crystal': 2, 'sunstone': 1, 'berries': 5},
            })
            for _ in range(7):
                built = client.post('/api/gate/build', json={'mode': 'place'})
                assert built.status_code == 200
            assert built.json()['gate']['unlocked'] is True

            sw = client.post('/api/world/switch', json={'world': 'market'})
            assert sw.status_code == 200
            init_market = next_type(ws, 'world_init')
            assert init_market['state']['world_id'] == 'market'
            assert init_market['state']['npc']['inventory']['berries'] == 5

            cat = client.get('/api/market/catalog').json()
            assert cat['coins'] == 250 and len(cat['shop_items']) >= 15

            buy_marble = client.post('/api/market/buy', json={'item_id': 'marble', 'quantity': 2})
            assert buy_marble.status_code == 200
            assert buy_marble.json()['coins'] == 214
            assert buy_marble.json()['state']['npc']['inventory']['marble'] == 8

            buy_cat = client.post('/api/market/buy', json={'item_id': 'pet_cat', 'quantity': 1})
            assert buy_cat.status_code == 200
            assert buy_cat.json()['coins'] == 154

            sell = client.post('/api/market/sell', json={'item': 'berries', 'quantity': 3})
            assert sell.status_code == 200
            assert sell.json()['earned'] == 6 and sell.json()['coins'] == 160

            # Return home: keep bought marble and updated coins
            back = client.post('/api/world/switch', json={'world': 'homestead'})
            assert back.status_code == 200
            init_back = next_type(ws, 'world_init')
            assert init_back['state']['world_id'] == 'homestead'
            assert init_back['state']['coins'] == 160
            assert init_back['state']['npc']['inventory']['marble'] == 8
