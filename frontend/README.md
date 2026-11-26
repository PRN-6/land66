# land66 — Frontend (3D Floating Island & God Monitor)

Interactive 3D voxel floating-island renderer and God Monitor dashboard built with React, TypeScript, Vite, Tailwind CSS, and Three.js.

## Features

- **3D Voxel Floating Island (`32 × 24 × 32`)**: Procedural pixel-art texture atlas, face-culled chunk meshes, voxel ambient occlusion, shimmering water, framed glass, dynamic doors, cozy bed/chest/crafting bench, flickering torches, dry/watered farmland, 4-stage growing wheat crops, wild berry bushes, saplings, and fences.
- **Dynamic Sky & Weather**: Smooth dawn/day/dusk/night sky shader, orbiting sun & moon with soft shadows, stars, drifting 3D voxel clouds below the island, and rain/storm weather particles.
- **Embodied AI NPC ("Aiden")**: Smooth position/yaw interpolation, procedural animations (`idle`, `walking`, `chopping`, `mining`, `building`, `tilling`, `planting`, `watering`, `harvesting`, `eating`, `drinking`, `sleeping`, `thinking`), held tools, and 3D floating thought bubble.
- **God Camera & Inspection**: `God Orbit`, `Follow NPC`, and `NPC POV` camera modes, quick presets, path breadcrumb toggle, and click-to-inspect blocks/NPC.
- **God Monitor HUD**: Live Mind & Spatial Perception panel, Human Needs & Inventory, House/Farm Progress tracker, God Powers (Time, Weather, Whisper, Spawn Tree, Heal, Drop Gift), and AI Brain / LLM Settings & Trace Inspector (supports Ollama, LM Studio, OpenAI, Gemini, OpenRouter, custom endpoints, and Offline Demo fallback).

## Setup & Run

1. Install dependencies:

```bash
npm install
```

2. (Optional) Configure custom backend URLs in `.env` (defaults to `http://localhost:8000` and `ws://localhost:8000/ws`):

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
```

3. Start the Vite dev server on `http://localhost:5173`:

```bash
npm run dev
```

4. Type-check and build for production:

```bash
npx tsc --noEmit
npm run build
```
