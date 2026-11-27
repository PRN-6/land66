# land66 — 3D Floating Island AI World

Autonomous 3D voxel floating islands, multi-world God Monitor, local/cloud LLM AI brains (Ollama, LM Studio, OpenAI, Gemini, OpenRouter), physical sky drops, and autonomous weekly Sky Market trading.

## Universal One-Command Run

From the project root (`d:\projects\land66`):

```bash
python run.py
```

Or use any equivalent shortcut for your OS / shell:

- **Cross-platform (`npm`)**: `npm start` or `npm run dev`
- **Windows PowerShell**: `.\run.ps1`
- **Windows CMD**: `run.bat`
- **macOS / Linux / Git Bash**: `./run.sh`

This starts both servers together and links them automatically:
- **Frontend UI (3D World)**: `http://localhost:5173`
- **Backend API & WebSocket**: `http://localhost:8000` (`ws://localhost:8000/ws`)

Press **Ctrl+C** once to cleanly stop both backend and frontend.

### Helpful Flags

```bash
python run.py --open      # Launch both servers and open the browser automatically
python run.py --reload    # Enable backend hot-reload during Python development
python run.py --test      # Run backend pytest suite + frontend TypeScript/Vite build
```
