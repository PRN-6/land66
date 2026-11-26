# land66 backend

Deterministic voxel simulation and FastAPI/WebSocket server for Aiden's floating island.

## Run on Windows (Python 3.12)

From `D:\projects\land66\backend` in PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

If script activation is disabled, run the same server with the virtual environment's interpreter:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Health: `http://localhost:8000/api/health`. API explorer: `http://localhost:8000/docs`.
WebSocket: `ws://localhost:8000/ws`. CORS permits all origins as required by the frontend contract.
Run **one worker**: this is one in-memory world shared by all connected clients. Stop with Ctrl+C.
World state and runtime configuration are ephemeral; restart/reset regenerates the island. `.env` supplies startup settings and is ignored by Git.

## Simulation

- Dimensions are 32 × 24 × 32; both arrays have 24,576 elements. The exact index is `y * width * depth + z * width + x`. Block IDs 0–21 follow the contract; `palette` uses string keys in JSON.
- The same seed produces the same island and the same fixed-step autonomous run. The untouched island has rolling grass, a tapered floating underside, 34 trees, surface stone, berries and a recessed pond, with no house or farm.
- Aiden starts with an empty inventory. He explores, forages, gathers stone/timber, builds a single 7 × 7 house block by block, plants eight adjacent wheat plots, harvests, bakes bread and replaces trees. No LLM or key is needed for full progression.
- Coordinates represent cell centers in X/Z and feet height in Y. `grid_pos` is the last reached integer cell; `position` interpolates toward the next. `yaw` is radians (`atan2(dx, dz)`). Paths exclude the current cell. Three-dimensional A* checks support, two-cell clearance, one-block height changes and ceiling clearance. Both halves of a doorway open when entered.
- Each server frame advances one, two or five **0.1-second fixed substeps**, then broadcasts at 10 Hz. `tick` counts substeps. One day is 360 simulation seconds; speed 5 compresses it to 72 wall-clock seconds. Construction requires several simulated days; speed changes pacing without changing action durations in simulation time.
- Needs bars mean full/well at 100. Food, freshwater, sleep, shelter, weather and physical work affect them. A completed home provides indoor shelter and a bed; rain waters crops. The daily routine includes dusk journals and sleeping at night. The brain models a character's spatial and bodily awareness; it is not a claim of machine consciousness.
- Simple crafting rules: one log → four planks; three wheat → one bread. Foundations and glass use stone, while walls, shingles and furniture use planks. This intentionally uses only the eight inventory keys in the contract. Each ripe crop yields two wheat and two seeds. Watered wheat advances a stage every 25 simulation seconds; soil dries after 100 dry-weather seconds. Berries regrow after 100 seconds and saplings grow after 120 seconds.
- Building uses a fixed flat central site and a coherent foundation/walls/roof/furniture blueprint. Aiden works within three horizontal cells of each placement, with vertical reach for the roof. Beds, chest, bench, torch, windows and a two-cell door are included. Tree planting is restricted outside the reserved clearing so interventions cannot trap Aiden in a trunk or destroy the house.

## REST contract

| Endpoint | Request / result |
| --- | --- |
| `GET /api/health` | `{"ok":true}` |
| `GET /api/state` | Full `WorldStateSnapshot` |
| `GET /api/llm/config` | Public configuration plus `has_api_key`; never `api_key` |
| `POST /api/llm/config` | Partial configuration update; returns public configuration |
| `POST /api/llm/test` | `{ok,latency_ms,reply,error}`; tests the selected provider even if automatic thinking is disabled |
| `GET /api/llm/models` | `{provider,models:[string],error}`; local discovery or cloud model suggestions |
| `GET /api/llm/traces?limit=30` | Newest-first array; limit 1–100 |
| `POST /api/sim/control` | `{action,speed?,seed?}`; returns snapshot |
| `POST /api/god/intervene` | `{action,value?}`; returns snapshot |

Control actions: `pause`, `resume`, `step`, `set_speed`, `reset`. Speed must be 1, 2 or 5.
`step` pauses and advances exactly one 0.1-second substep. Reset uses the supplied seed or the current seed, empties inventory, restores speed 1, resumes, and sends `world_init` to all clients. Provider settings and the last 100 diagnostic traces survive a world reset; pending decisions do not.

Intervention examples:

```json
{"action":"set_time","value":0.5}
{"action":"set_weather","value":"rain"}
{"action":"whisper","value":"Remember to plant trees."}
{"action":"spawn_tree","value":{"x":6,"z":16}}
{"action":"drop_gift","value":{"wood_log":8,"seeds":6}}
{"action":"drop_gift","value":{"item":"bread","amount":2}}
{"action":"heal_npc"}
```

Time is a fraction in `[0,1)`, with 0.5 = noon. Weather is `clear`, `rain` or `storm`; an intervention pins the chosen weather until reset. Tree coordinates must identify free natural ground, with optional feet-height `y`. Invalid or occupied locations return 422. A whisper becomes a memory and appears in the next LLM perception; the fallback keeps survival and progression priorities. Gifts accept the eight inventory keys and amounts from 1 to 1000; healing fills all needs.

## WebSocket contract details

The first frame and each reset frame are `world_init`, with `dimensions`, `index_formula`, `blocks`, `block_meta`, `palette` and `state`. Frames then use `tick_update` with `block_updates` and `state`. A delta has integer `x,y,z,block,meta`; the last mutation of a cell within a frame wins. Provider completions send `llm_trace` with `trace`. No inbound WebSocket messages are required; commands use REST.

Each snapshot contains the requested time/weather/control fields, `npc`, `stats` and `llm_status`. Additional structured field details for the frontend:

- `npc.position`, `npc.grid_pos`, `npc.target_block` and each `npc.path` entry use `{x,y,z}`; target may be null.
- `perception.nearby_entities` is an array of `{type,position:{x,y,z},distance}`. Perception also includes `nearest_distances`, `roof_overhead`, `enclosed_walls` and `near_bed`.
- Memories use `{day,tick,text}` (last 18); journal entries use `{day,time,text}` (last 30).
- `stats.house_bounds` is `{min:{x:12,y:10,z:12},max:{x:18,y:14,z:18}}`, inclusive. Stages: `not_started`, `foundation`, `walls`, `roof`, `furnishing`, `complete`. `farm_plots` is an integer count.
- Action animations follow the exact requested enumeration. `current_action` uses semantic action names (`chop`, `mine`, `craft`, etc.); `current_goal` and `thought` are readable prose. Progress ranges from 0 to 1 during work and is 0 while walking.

Socket writes run independently of the simulation. A client that exceeds the bounded queue is disconnected with 1013 and must reconnect for a complete snapshot. Paused worlds send updates for explicit commands, single steps and provider completion, rather than idle frame spam.

## Local / cloud LLM configuration

The default provider is `fallback`, disabled for network thinking. Configure through `.env` or `POST /api/llm/config`:

```json
{"provider":"ollama","model":"YOUR_INSTALLED_MODEL","base_url":"http://localhost:11434","enabled":true,"decision_interval_ticks":100}
```

```json
{"provider":"lmstudio","model":"YOUR_LOADED_MODEL","base_url":"http://localhost:1234/v1","enabled":true}
```

```json
{"provider":"openai","model":"YOUR_MODEL","api_key":"YOUR_KEY","enabled":true}
```

| Provider | Default base URL / protocol |
| --- | --- |
| `ollama` | `http://localhost:11434`, native `/api/chat` and `/api/tags` |
| `lmstudio` | `http://localhost:1234/v1`, OpenAI-compatible |
| `openai` | `https://api.openai.com/v1`, chat completions |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta`, native `models/{model}:generateContent` |
| `openrouter` | `https://openrouter.ai/api/v1`, OpenAI-compatible |
| `custom` | Supply an OpenAI-compatible base URL, usually ending `/v1` |
| `fallback` | Local utility/state-machine brain, no HTTP request |

OpenAI-compatible URLs may also include `/chat/completions`; Ollama may include `/api/chat`. Set the model to one installed locally or available to your account. Cloud model suggestions are static convenience values, not availability guarantees.

Changing providers clears the old model/key and restores that provider's URL unless replacements are supplied in the same request. Omitted keys are preserved for the same provider; an empty key explicitly clears it. Runtime keys stay in memory and are excluded from configuration responses; traces redact the configured secret, including echoed provider content. This development server has no authentication and allows arbitrary custom HTTP endpoints, so bind to loopback when running outside a trusted development network.

Only one background decision request runs at a time, with a default 12-second overall timeout. Movement and work continue while it runs. Valid decisions wait for a safe action boundary; urgent survival takes precedence. Invalid JSON, unknown actions, unreachable coordinates, missing resources, provider failures and timeouts fall back to the autonomous brain. A world reset or configuration change cancels stale requests. Trace records include the actual prompt, response, parsed decision or fallback decision, provider, model, latency and error.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe scripts\smoke.py
```

Tests cover deterministic generation, indexing, safe A*, movement/doors, needs/shelter, crafting and action durations, incremental construction, full autonomous runs across several seeds, farming, reforestation, provider formats, invalid responses, secret redaction, nonblocking thinking, reset cancellation, REST and multiple WebSocket clients. Provider tests use mocked transports and need no API keys or running local model.

The smoke script starts real Uvicorn on port 8000, checks HTTP and WebSocket frames and controls, and always terminates its own child server. It refuses to use an occupied port and writes `smoke-server.log`. Windows asyncio needs local socket access, including for in-process FastAPI tests; a sandbox that blocks loopback socket creation cannot run those tests.

Source layout: `app/world.py` terrain and block storage; `app/pathfinding.py` safe movement routes; `app/simulation.py` human needs/actions/progression; `app/models.py` request validation; `app/brain.py` provider routing and traces; `app/main.py` server lifecycle and transport.
