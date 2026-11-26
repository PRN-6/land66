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
