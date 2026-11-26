import asyncio
import json
import httpx
import pytest
from app.brain import Brain, parse_decision
from app.models import LLMConfig
from app.simulation import Simulation
from app.main import Runtime

VALID = dict(thought='The pond is close.',goal='Explore',action='explore',params={})


def test_json_and_fenced_json():
    assert parse_decision(json.dumps(VALID)).action == 'explore'
    assert parse_decision('```json\n'+json.dumps(VALID)+'\n```').goal == 'Explore'
    for text in ('not JSON', '{}', '{"action":"teleport"}', json.dumps({**VALID,'action':'destroy'})):
        with pytest.raises(ValueError):
            parse_decision(text)


@pytest.mark.parametrize('provider',['ollama','lmstudio','openai','gemini','openrouter','custom'])
def test_provider_request_formats_and_parsing(provider):
    requests = []
    async def handle(request):
        requests.append(request)
        if provider == 'ollama':
            data = {'message':{'content':json.dumps(VALID)}}
        elif provider == 'gemini':
            data = {'candidates':[{'content':{'parts':[{'text':json.dumps(VALID)}]}}]}
        else:
            data = {'choices':[{'message':{'content':json.dumps(VALID)}}]}
        return httpx.Response(200,json=data)
    b = Brain(LLMConfig(provider=provider,model='test-model',base_url='http://test/v1',api_key='secret',enabled=True),transport=httpx.MockTransport(handle))
    decision,trace = asyncio.run(b.decide(Simulation().snapshot()))
    assert decision.action == 'explore' and not trace['used_fallback']
    assert b.calls_count == 1 and trace['raw_response']
    request = requests[0]
    assert request.method == 'POST'
    assert 'secret' not in json.dumps(trace) and 'secret' not in json.dumps(b.config.public())
    body = json.loads(request.content)
    if provider == 'ollama':
        assert request.url.path.endswith('/api/chat') and body['stream'] is False
    elif provider == 'gemini':
        assert request.url.path.endswith('/models/test-model:generateContent')
        assert request.headers['x-goog-api-key'] == 'secret'
    else:
        assert request.url.path.endswith('/chat/completions') and request.headers['Authorization'] == 'Bearer secret'


@pytest.mark.parametrize('mode',['bad_json','timeout','http_error','null','echo_key'])
def test_failures_fall_back_and_secrets_are_redacted(mode):
    async def handle(request):
        if mode == 'timeout':
            await asyncio.sleep(.2)
        if mode == 'http_error':
            return httpx.Response(401,json={'error':'nope'})
        content = None if mode == 'null' else json.dumps({**VALID,'thought':'secret-key'}) if mode == 'echo_key' else 'secret-key is not JSON'
        return httpx.Response(200,json={'choices':[{'message':{'content':content}}]})
    b = Brain(LLMConfig(provider='custom',model='test',base_url='http://test/v1',api_key='secret-key',enabled=True),timeout=.02,transport=httpx.MockTransport(handle))
    decision,trace = asyncio.run(b.decide(Simulation().snapshot()))
    if mode == 'echo_key':
        assert decision.thought == '[REDACTED]'
    else:
        assert decision is None and trace['used_fallback'] and trace['error']
    assert 'secret-key' not in json.dumps(trace)


def test_unconfigured_and_disabled_fallback_without_http():
    for config in (LLMConfig(),LLMConfig(provider='ollama',enabled=True),LLMConfig(provider='openai',model='test',enabled=True)):
        b = Brain(config)
        decision,trace = asyncio.run(b.decide(Simulation().snapshot()))
        assert decision is None and trace['used_fallback'] and b.calls_count == 0


def test_model_discovery_and_provider_change_clears_secrets():
    async def handle(request):
        return httpx.Response(200,json={'models':[{'name':'local-model'}]})
    b = Brain(LLMConfig(provider='ollama',api_key='private'),transport=httpx.MockTransport(handle))
    assert asyncio.run(b.models())['models'] == ['local-model']
    b.configure({'provider':'openai'})
    assert not b.config.public()['has_api_key']
    assert b.config.base_url == 'https://api.openai.com/v1'


def test_slow_llm_does_not_block_ticks_and_reset_discards_inflight_decision():
    async def scenario():
        requested = asyncio.Event()
        release = asyncio.Event()
        async def handle(request):
            requested.set()
            await release.wait()
            return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(VALID)}}]})
        b = Brain(LLMConfig(provider='custom',model='test',base_url='http://test/v1',enabled=True),transport=httpx.MockTransport(handle))
        rt = Runtime(brain=b)
        rt.loop_task = asyncio.create_task(rt.run())
        try:
            await asyncio.wait_for(requested.wait(),2)
            initial = rt.sim.tick
            await asyncio.sleep(.35)
            assert rt.sim.tick >= initial+2 and rt.sim.llm_status['thinking']
            rt.sim.paused = True
            await rt.reset(7)
            assert rt.sim.seed == 7 and rt.sim.tick == 0 and rt.sim.queued_decision is None
            release.set()
        finally:
            await rt.close()
    asyncio.run(scenario())


def test_impossible_decision_is_traced_as_fallback():
    async def scenario():
        async def handle(request):
            invalid = {**VALID,'action':'walk','params':{'x':999,'y':11,'z':3}}
            return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(invalid)}}]})
        b = Brain(LLMConfig(provider='custom',model='test',base_url='http://test/v1',enabled=True),transport=httpx.MockTransport(handle))
        rt = Runtime(brain=b)
        rt.thinking_task = asyncio.create_task(b.decide(rt.sim.snapshot()))
        await rt.thinking_task
        rt.complete_thinking()
        assert b.traces[-1]['used_fallback'] and 'not executable' in b.traces[-1]['error']
        assert rt.sim.queued_decision is None
    asyncio.run(scenario())


def test_slow_client_overflow_requires_resync():
    rt = Runtime()
    queue = asyncio.Queue(maxsize=1)
    rt.clients.add(queue)
    rt.publish({'type':'tick_update'})
    rt.publish({'type':'tick_update'})
    assert queue.get_nowait() is None and queue not in rt.clients
