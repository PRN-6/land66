import { useState } from 'react';
import {
  Brain,
  CloudLightning,
  CloudRain,
  Compass,
  Eye,
  Footprints,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RotateCcw,
  Route,
  SkipForward,
  Sun,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { CameraMode, ConnectionMode, SimSpeed, WorldStateSnapshot } from '../types/world';

interface TopBarProps {
  state: WorldStateSnapshot;
  connectionMode: ConnectionMode;
  cameraMode: CameraMode;
  showThoughtBubble: boolean;
  showPath: boolean;
  panelsOpen: boolean;
  onControl: (action: 'pause' | 'resume' | 'step' | 'set_speed' | 'reset', speed?: SimSpeed, seed?: number) => void;
  onCameraMode: (mode: CameraMode) => void;
  onFocusPreset: (preset: 'overview' | 'npc') => void;
  onToggleThoughtBubble: () => void;
  onTogglePath: () => void;
  onTogglePanels: () => void;
  onOpenLlmModal: () => void;
  onToggleOfflineDemo: () => void;
}

export function TopBar({
  state,
  connectionMode,
  cameraMode,
  showThoughtBubble,
  showPath,
  panelsOpen,
  onControl,
  onCameraMode,
  onFocusPreset,
  onToggleThoughtBubble,
  onTogglePath,
  onTogglePanels,
  onOpenLlmModal,
  onToggleOfflineDemo,
}: TopBarProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const [seedInput, setSeedInput] = useState(String(state.seed));

  const weatherIcon =
    state.weather === 'storm' ? (
      <CloudLightning className="w-3.5 h-3.5 text-amber-300" />
    ) : state.weather === 'rain' ? (
      <CloudRain className="w-3.5 h-3.5 text-sky-300" />
    ) : (
      <Sun className="w-3.5 h-3.5 text-amber-300" />
    );

  const connBadge = (() => {
    if (connectionMode === 'live') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live :8000
        </span>
      );
    }
    if (connectionMode === 'offline_demo') {
      return (
        <button
          onClick={onToggleOfflineDemo}
          title="Click to reconnect to live backend at ws://localhost:8000/ws"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition cursor-pointer"
        >
          <WifiOff className="w-3 h-3" />
          Offline Demo (Retry Live)
        </button>
      );
    }
    return (
      <button
        onClick={onToggleOfflineDemo}
        title="Click to preview Offline Demo immediately"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition cursor-pointer"
      >
        <Wifi className="w-3 h-3 animate-pulse" />
        {connectionMode === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
      </button>
    );
  })();

  return (
    <header className="pointer-events-auto relative z-30 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-950/75 backdrop-blur-xl border-b border-slate-800/80 shadow-lg">
      {/* Left: World Identity, Clock, Weather, Connection */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-slate-950 font-black text-xs shadow">
            L66
          </div>
          <div>
            <div className="text-xs font-bold tracking-wide text-slate-100 leading-none">land66</div>
            <div className="text-[10px] text-slate-400 leading-tight">God Monitor</div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
          <span className="font-semibold text-amber-300">Day {state.day}</span>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-slate-100">{state.clock_str}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] uppercase tracking-wider text-slate-300">
            {state.phase}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-xs capitalize text-slate-200">
          {weatherIcon}
          <span>{state.weather}</span>
        </div>

        {connBadge}
      </div>

      {/* Center: Simulation Speed & Reset */}
      <div className="flex items-center gap-1.5 bg-slate-900/85 border border-slate-800 rounded-xl p-1 relative">
        <button
          onClick={() => onControl(state.paused ? 'resume' : 'pause')}
          title={state.paused ? 'Resume Simulation' : 'Pause Simulation'}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
            state.paused
              ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {state.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          <span>{state.paused ? 'Play' : 'Pause'}</span>
        </button>

        <button
          onClick={() => onControl('step')}
          title="Step Forward 1 Tick"
          className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {([1, 2, 5] as SimSpeed[]).map((spd) => (
          <button
            key={spd}
            onClick={() => onControl('set_speed', spd)}
            className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
              state.speed === spd
                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {spd}x
          </button>
        ))}

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        <button
          onClick={() => {
            setSeedInput(String(state.seed));
            setResetOpen((v) => !v);
          }}
          title="Reset Floating Island"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-rose-300 hover:bg-rose-500/20 transition cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Reset</span>
        </button>

        {resetOpen && (
          <div className="absolute top-full right-0 mt-2 w-64 p-3 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-slate-700 shadow-2xl z-50">
            <div className="text-xs font-semibold text-slate-200 mb-2">Generate New Island</div>
            <label className="block text-[11px] text-slate-400 mb-1">World Seed</label>
            <div className="flex gap-1.5 mb-2.5">
              <input
                type="number"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
              <button
                onClick={() => setSeedInput(String(Math.floor(Math.random() * 9000) + 1000))}
                className="px-2 py-1 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Rand
              </button>
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => setResetOpen(false)}
                className="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const parsed = Number.parseInt(seedInput, 10);
                  onControl('reset', undefined, Number.isFinite(parsed) ? parsed : undefined);
                  setResetOpen(false);
                }}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
              >
                Reset World
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: Camera Modes, Presets, View Toggles, AI Brain */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="flex items-center bg-slate-900/85 border border-slate-800 rounded-xl p-1 gap-0.5">
          {(
            [
              { id: 'orbit', label: 'God Orbit', icon: Compass },
              { id: 'follow', label: 'Follow', icon: Video },
              { id: 'pov', label: 'NPC POV', icon: Eye },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onCameraMode(id)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                cameraMode === id
                  ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="hidden xl:flex items-center gap-1 bg-slate-900/85 border border-slate-800 rounded-xl p-1">
          <button
            onClick={() => onFocusPreset('overview')}
            className="px-2 py-1 rounded-lg text-[11px] text-slate-300 hover:bg-slate-800 cursor-pointer"
          >
            Overview
          </button>
          <button
            onClick={() => onFocusPreset('npc')}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-300 hover:bg-slate-800 cursor-pointer"
          >
            <Footprints className="w-3 h-3" />
            {state.npc.name}
          </button>
        </div>

        <button
          onClick={onToggleThoughtBubble}
          title="Toggle 3D Floating Thought Bubble"
          className={`p-2 rounded-xl border text-xs transition cursor-pointer ${
            showThoughtBubble
              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
              : 'bg-slate-900/85 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onTogglePath}
          title="Toggle Planned Path Breadcrumbs"
          className={`p-2 rounded-xl border text-xs transition cursor-pointer ${
            showPath
              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
              : 'bg-slate-900/85 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Route className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onTogglePanels}
          title={panelsOpen ? 'Collapse HUD Panels' : 'Expand HUD Panels'}
          className="p-2 rounded-xl bg-slate-900/85 border border-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
        >
          {panelsOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={onOpenLlmModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600/80 to-indigo-600/80 hover:from-violet-500 hover:to-indigo-500 border border-violet-400/40 text-xs font-semibold text-white shadow cursor-pointer transition"
        >
          <Brain className={`w-3.5 h-3.5 ${state.llm_status.thinking ? 'animate-pulse text-amber-300' : ''}`} />
          <span>AI Brain</span>
          <span className="hidden sm:inline px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono text-violet-100">
            {state.llm_status.provider}
          </span>
        </button>
      </div>
    </header>
  );
}
