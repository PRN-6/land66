import { useState } from 'react';
import {
  Brain,
  CloudLightning,
  CloudRain,
  Compass,
  Eye,
  MessageSquare,
  PanelRight,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  Save,
  SkipForward,
  Sparkles,
  Store,
  Sun,
  Video,
} from 'lucide-react';
import type { CameraMode, ConnectionMode, FloatingWorldId, SimSpeed, WorldStateSnapshot } from '../types/world';

interface TopBarProps {
  state: WorldStateSnapshot;
  connectionMode: ConnectionMode;
  cameraMode: CameraMode;
  showThoughtBubble: boolean;
  showPath: boolean;
  inspectorOpen: boolean;
  onControl: (action: 'pause' | 'resume' | 'step' | 'set_speed' | 'reset', speed?: SimSpeed, seed?: number) => void;
  onSwitchWorld: (world: FloatingWorldId) => void;
  onOpenCreateWorldModal: () => void;
  onCameraMode: (mode: CameraMode) => void;
  onToggleThoughtBubble: () => void;
  onTogglePath: () => void;
  onToggleInspector: () => void;
  onOpenGateModal: () => void;
  onOpenShopModal: () => void;
  onOpenSavesModal: () => void;
  onOpenLlmModal: () => void;
  onToggleOfflineDemo: () => void;
}

export function TopBar({
  state,
  connectionMode,
  cameraMode,
  showThoughtBubble,
  showPath,
  inspectorOpen,
  onControl,
  onSwitchWorld,
  onOpenCreateWorldModal,
  onCameraMode,
  onToggleThoughtBubble,
  onTogglePath,
  onToggleInspector,
  onOpenGateModal,
  onOpenShopModal,
  onOpenSavesModal,
  onOpenLlmModal,
  onToggleOfflineDemo,
}: TopBarProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const [seedInput, setSeedInput] = useState(String(state.seed));

  const weatherIcon =
    state.weather === 'storm' ? (
      <CloudLightning className="w-3.5 h-3.5 text-neutral-300" />
    ) : state.weather === 'rain' ? (
      <CloudRain className="w-3.5 h-3.5 text-neutral-300" />
    ) : (
      <Sun className="w-3.5 h-3.5 text-neutral-300" />
    );

  const dotClass =
    connectionMode === 'live'
      ? 'bg-neutral-100'
      : connectionMode === 'offline_demo'
        ? 'bg-neutral-500'
        : 'bg-neutral-400 animate-pulse';

  const statusText =
    connectionMode === 'live'
      ? 'Live'
      : connectionMode === 'offline_demo'
        ? 'Demo'
        : 'Sync';

  return (
    <header className="pointer-events-auto relative z-30 mx-auto mt-3 flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-neutral-950/75 backdrop-blur-xl border border-white/10 shadow-2xl max-w-[calc(100vw-1.5rem)]">
      {/* Brand & Clock */}
      <div className="flex items-center gap-2 pl-1.5 pr-2 border-r border-white/10">
        <span className="text-xs font-semibold tracking-tight text-white">land66</span>
        <span className="text-[11px] font-mono text-neutral-400">
          D{state.day} {state.clock_str}
        </span>
        {weatherIcon}
        <button
          onClick={onToggleOfflineDemo}
          title={
            connectionMode === 'live'
              ? 'Connected to localhost:8000'
              : 'Offline Demo — click to retry localhost:8000'
          }
          className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-white/5 hover:bg-white/10 text-[10px] text-neutral-300 transition cursor-pointer"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          <span>{statusText}</span>
        </button>
      </div>

      {/* Floating World Switcher */}
      <div className="flex items-center gap-0.5 pr-1.5 border-r border-white/10">
        {(
          state.worlds && state.worlds.length > 0
            ? state.worlds
            : [
                { id: 'homestead', name: 'Homestead', preset: 'homestead', seed: state.seed, locked: false },
                { id: 'market', name: 'Market', preset: 'market', seed: state.seed + 100, locked: false },
              ]
        ).map((w) => {
          const active = (state.world_id ?? 'homestead') === w.id;
          return (
            <button
              key={w.id}
              onClick={() => onSwitchWorld(w.id)}
              title={`Visit & maintain ${w.name} (${w.preset})`}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] transition cursor-pointer max-w-[7.5rem] truncate ${
                active
                  ? 'bg-white text-neutral-950 font-medium'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="truncate">{w.name}</span>
            </button>
          );
        })}

        <button
          onClick={onOpenCreateWorldModal}
          title="View All Worlds & Create New Floating World"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-neutral-200 bg-white/10 hover:bg-white hover:text-neutral-950 transition cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          <span className="hidden lg:inline">Worlds</span>
        </button>

        <button
          onClick={onOpenGateModal}
          title="Sky Teleport Gate Blueprint"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-neutral-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <Sparkles className="w-3 h-3" />
          <span className="hidden md:inline">
            {state.gate?.unlocked ? 'Gate' : `Gate ${state.gate?.built_count ?? 0}/${state.gate?.total_count ?? 7}`}
          </span>
        </button>
      </div>

      {/* Simulation Controls */}
      <div className="flex items-center gap-0.5 pr-1.5 border-r border-white/10 relative">
        <button
          onClick={() => onControl(state.paused ? 'resume' : 'pause')}
          title={state.paused ? 'Play' : 'Pause'}
          className={`p-1.5 rounded-full transition cursor-pointer ${
            state.paused
              ? 'bg-white text-neutral-950'
              : 'text-neutral-300 hover:text-white hover:bg-white/10'
          }`}
        >
          {state.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => onControl('step')}
          title="Step 1 tick"
          className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        {([1, 2, 5] as SimSpeed[]).map((spd) => (
          <button
            key={spd}
            onClick={() => onControl('set_speed', spd)}
            className={`px-2 py-0.5 rounded-full text-[11px] font-mono transition cursor-pointer ${
              state.speed === spd
                ? 'bg-white text-neutral-950 font-semibold'
                : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {spd}x
          </button>
        ))}

        <button
          onClick={() => {
            setSeedInput(String(state.seed));
            setResetOpen((v) => !v);
          }}
          title="Reset Island"
          className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {resetOpen && (
          <div className="absolute top-full left-0 mt-2 w-56 p-3 rounded-2xl bg-neutral-950/95 backdrop-blur-xl border border-white/15 shadow-2xl z-50">
            <div className="text-[11px] font-medium text-neutral-200 mb-2">New Island Seed</div>
            <div className="flex gap-1.5 mb-2.5">
              <input
                type="number"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-white/30"
              />
              <button
                onClick={() => setSeedInput(String(Math.floor(Math.random() * 9000) + 1000))}
                className="px-2 py-1 rounded-lg bg-neutral-800 text-[11px] text-neutral-300 hover:text-white cursor-pointer"
              >
                Rand
              </button>
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => setResetOpen(false)}
                className="px-2.5 py-1 rounded-lg text-[11px] text-neutral-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const parsed = Number.parseInt(seedInput, 10);
                  onControl('reset', undefined, Number.isFinite(parsed) ? parsed : undefined);
                  setResetOpen(false);
                }}
                className="px-3 py-1 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 text-[11px] font-semibold cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Camera Modes */}
      <div className="flex items-center gap-0.5 pr-1.5 border-r border-white/10">
        {(
          [
            { id: 'orbit', label: 'Orbit', icon: Compass },
            { id: 'follow', label: 'Follow', icon: Video },
            { id: 'pov', label: 'POV', icon: Eye },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onCameraMode(id)}
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] transition cursor-pointer ${
              cameraMode === id
                ? 'bg-white text-neutral-950 font-medium'
                : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Icon className="w-3 h-3" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* View & Modals */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onToggleThoughtBubble}
          title="Toggle Thought Bubble"
          className={`p-1.5 rounded-full transition cursor-pointer ${
            showThoughtBubble ? 'text-white bg-white/15' : 'text-neutral-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onTogglePath}
          title="Toggle Path"
          className={`p-1.5 rounded-full transition cursor-pointer ${
            showPath ? 'text-white bg-white/15' : 'text-neutral-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Route className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onToggleInspector}
          title="Toggle Inspector"
          className={`p-1.5 rounded-full transition cursor-pointer ${
            inspectorOpen ? 'bg-white text-neutral-950' : 'text-neutral-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onOpenShopModal}
          title="Open Sky Market Shop"
          className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium text-neutral-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <Store className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Shop</span>
          <span className="font-mono text-[10px] text-neutral-400">{state.coins ?? 250}c</span>
        </button>

        <button
          onClick={onOpenSavesModal}
          title="Save & Load World"
          className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium text-neutral-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Save</span>
        </button>

        <button
          onClick={onOpenLlmModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-[11px] font-medium text-white transition cursor-pointer ml-0.5"
        >
          <Brain className={`w-3.5 h-3.5 ${state.llm_status.thinking ? 'animate-pulse' : ''}`} />
          <span>AI</span>
          <span className="hidden md:inline text-[10px] font-mono text-neutral-400">
            {state.llm_status.model || state.llm_status.provider}
          </span>
        </button>
      </div>
    </header>
  );
}
