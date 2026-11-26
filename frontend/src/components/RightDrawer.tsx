import { useState } from 'react';
import {
  CloudLightning,
  CloudRain,
  Gift,
  HeartPulse,
  Home,
  Send,
  Sparkles,
  Sprout,
  Sun,
  TreePine,
  Wand2,
} from 'lucide-react';
import type { WorldStateSnapshot } from '../types/world';

interface RightDrawerProps {
  state: WorldStateSnapshot;
  open: boolean;
  onGodIntervene: (
    action: 'set_time' | 'set_weather' | 'whisper' | 'spawn_tree' | 'drop_gift' | 'heal_npc',
    value?: unknown,
  ) => void;
}

export function RightDrawer({ state, open, onGodIntervene }: RightDrawerProps) {
  const [tab, setTab] = useState<'world' | 'god'>('world');
  const [whisperText, setWhisperText] = useState('');
  const [giftItem, setGiftItem] = useState('berries');
  const [giftAmount, setGiftAmount] = useState(3);

  if (!open) return null;

  const { stats } = state;

  const submitWhisper = () => {
    const msg = whisperText.trim();
    if (!msg) return;
    onGodIntervene('whisper', msg);
    setWhisperText('');
  };

  return (
    <aside className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] h-full flex flex-col bg-slate-950/75 backdrop-blur-xl border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-slate-800/80 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Island & Dominion
        </div>
        <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-0.5 text-xs">
          <button
            onClick={() => setTab('world')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
              tab === 'world' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            World
          </button>
          <button
            onClick={() => setTab('god')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
              tab === 'god' ? 'bg-amber-500/20 text-amber-200' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            God
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto hud-scroll p-3 space-y-3">
        {tab === 'world' ? (
          <>
            {/* House Completion */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                  <Home className="w-3.5 h-3.5" />
                  Single House Build
                </span>
                <span className="font-mono text-xs font-bold text-amber-300">
                  {Math.round(stats.house_progress)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, stats.house_progress))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Stage:</span>
                <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-slate-200 capitalize">
                  {stats.house_stage.replace(/_/g, ' ')}
                </span>
              </div>
              {stats.house_bounds && (
                <div className="text-[10px] font-mono text-slate-500">
                  Plot X:{stats.house_bounds.min_x}..{stats.house_bounds.max_x}, Z:
                  {stats.house_bounds.min_z}..{stats.house_bounds.max_z}
                </div>
              )}
            </div>

            {/* Farm Tracker */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                <Sprout className="w-3.5 h-3.5" />
                Small Farm Tracker
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-slate-950/90 border border-slate-800">
                  <div className="text-base font-bold font-mono text-amber-200">{stats.farm_plots}</div>
                  <div className="text-[10px] text-slate-400">Tilled</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/90 border border-slate-800">
                  <div className="text-base font-bold font-mono text-emerald-300">{stats.crops_growing}</div>
                  <div className="text-[10px] text-slate-400">Growing</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/90 border border-slate-800">
                  <div className="text-base font-bold font-mono text-yellow-300">{stats.crops_ripe}</div>
                  <div className="text-[10px] text-slate-400">Ripe</div>
                </div>
              </div>
            </div>

            {/* Island Ecology */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <TreePine className="w-3.5 h-3.5 text-emerald-400" />
                Island Metrics
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-400">Trees</span>
                  <span className="font-mono font-bold text-emerald-300">{stats.trees_count}</span>
                </div>
                <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-400">Placed</span>
                  <span className="font-mono font-bold text-cyan-300">{stats.blocks_placed}</span>
                </div>
                <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-400">Broken</span>
                  <span className="font-mono font-bold text-rose-300">{stats.blocks_broken}</span>
                </div>
                <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-400">Seed</span>
                  <span className="font-mono font-bold text-slate-200">{state.seed}</span>
                </div>
              </div>
              <div className="text-[10px] text-slate-500 font-mono flex justify-between pt-1">
                <span>Tick #{state.tick}</span>
                <span>LLM Calls: {state.llm_status.calls_count}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Time of Day */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                Time Manipulation
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['dawn', 'noon', 'dusk', 'night'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => onGodIntervene('set_time', t)}
                    className="py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs capitalize text-slate-200 transition cursor-pointer"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Weather */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                Weather Dominion
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => onGodIntervene('set_weather', 'clear')}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs cursor-pointer transition ${
                    state.weather === 'clear'
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  Clear
                </button>
                <button
                  onClick={() => onGodIntervene('set_weather', 'rain')}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs cursor-pointer transition ${
                    state.weather === 'rain'
                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <CloudRain className="w-3.5 h-3.5" />
                  Rain
                </button>
                <button
                  onClick={() => onGodIntervene('set_weather', 'storm')}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs cursor-pointer transition ${
                    state.weather === 'storm'
                      ? 'bg-indigo-500/25 border-indigo-400/50 text-indigo-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <CloudLightning className="w-3.5 h-3.5" />
                  Storm
                </button>
              </div>
            </div>

            {/* God Whisper */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                <Sparkles className="w-3.5 h-3.5" />
                God Whisper (Inspire {state.npc.name})
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={whisperText}
                  onChange={(e) => setWhisperText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitWhisper()}
                  placeholder="Plant wheat near the pond..."
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={submitWhisper}
                  className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white cursor-pointer transition"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {['Build a cozy cabin', 'Start a small farm', 'Rest by the fire'].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => onGodIntervene('whisper', preset)}
                    className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Miracles & Gifts */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                Miracles & Blessings
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onGodIntervene('spawn_tree')}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-xs font-medium text-emerald-200 cursor-pointer transition"
                >
                  <TreePine className="w-3.5 h-3.5" />
                  Spawn Tree
                </button>
                <button
                  onClick={() => onGodIntervene('heal_npc')}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-xs font-medium text-rose-200 cursor-pointer transition"
                >
                  <HeartPulse className="w-3.5 h-3.5" />
                  Heal {state.npc.name}
                </button>
              </div>

              <div className="pt-1 border-t border-slate-800 space-y-1.5">
                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Gift className="w-3 h-3 text-amber-300" />
                  Drop Supply Gift
                </div>
                <div className="flex gap-1.5">
                  <select
                    value={giftItem}
                    onChange={(e) => setGiftItem(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                  >
                    <option value="berries">Berries</option>
                    <option value="seeds">Seeds</option>
                    <option value="wood_log">Wood Logs</option>
                    <option value="wood_plank">Planks</option>
                    <option value="stone">Stone</option>
                    <option value="bread">Bread</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={giftAmount}
                    onChange={(e) => setGiftAmount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-14 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                  />
                  <button
                    onClick={() => onGodIntervene('drop_gift', { item: giftItem, amount: giftAmount })}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    Drop
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
