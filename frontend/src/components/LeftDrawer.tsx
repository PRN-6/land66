import { useState } from 'react';
import {
  Activity,
  BookOpen,
  Brain,
  Compass,
  Droplets,
  Heart,
  Home,
  Package,
  Smile,
  Sparkles,
  Utensils,
  Zap,
} from 'lucide-react';
import type { MemoryItem, WorldStateSnapshot } from '../types/world';

interface LeftDrawerProps {
  state: WorldStateSnapshot;
  open: boolean;
}

function formatEntry(entry: MemoryItem | string): { tag: string; text: string } {
  if (typeof entry === 'string') {
    return { tag: 'Log', text: entry };
  }
  const dayStr = entry.day !== undefined ? `D${entry.day}` : '';
  const clkStr = entry.clock ?? '';
  const tag = [dayStr, clkStr].filter(Boolean).join(' ') || 'Note';
  return { tag, text: entry.text };
}

function NeedBar({
  label,
  value,
  icon: Icon,
  barColor,
}: {
  label: string;
  value: number;
  icon: typeof Heart;
  barColor: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5 text-slate-300 font-medium">
          <Icon className="w-3.5 h-3.5 text-slate-400" />
          {label}
        </span>
        <span className="font-mono text-slate-200">{clamped}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-800/90 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

const ITEM_LABELS: Record<string, { label: string; emoji: string }> = {
  wood_log: { label: 'Wood Logs', emoji: '🪵' },
  wood_plank: { label: 'Planks', emoji: '🧱' },
  stone: { label: 'Stone', emoji: '🪨' },
  seeds: { label: 'Seeds', emoji: '🌱' },
  wheat: { label: 'Wheat', emoji: '🌾' },
  berries: { label: 'Berries', emoji: '🫐' },
  sapling: { label: 'Saplings', emoji: '🌳' },
  bread: { label: 'Bread', emoji: '🍞' },
};

export function LeftDrawer({ state, open }: LeftDrawerProps) {
  const [tab, setTab] = useState<'mind' | 'vitals'>('mind');
  const [logTab, setLogTab] = useState<'memories' | 'journal'>('memories');

  if (!open) return null;

  const { npc } = state;
  const entries = logTab === 'memories' ? npc.memories : npc.journal;
  const inventoryKeys = Array.from(
    new Set([...Object.keys(ITEM_LABELS), ...Object.keys(npc.inventory ?? {})]),
  );

  return (
    <aside className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] h-full flex flex-col bg-slate-950/75 backdrop-blur-xl border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden">
      {/* Drawer Header */}
      <div className="p-3 border-b border-slate-800/80 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">{npc.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 capitalize">
              {npc.animation}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
            Pos ({npc.grid_pos.x}, {npc.grid_pos.y}, {npc.grid_pos.z})
          </div>
        </div>
        <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-0.5 text-xs">
          <button
            onClick={() => setTab('mind')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
              tab === 'mind' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            Mind
          </button>
          <button
            onClick={() => setTab('vitals')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
              tab === 'vitals' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Vitals
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto hud-scroll p-3 space-y-3">
        {tab === 'mind' ? (
          <>
            {/* Inner Monologue */}
            <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-950/60 to-slate-900/90 border border-indigo-500/30">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-indigo-300 mb-1.5">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Inner Monologue
                </span>
                {state.llm_status.thinking && (
                  <span className="text-amber-300 animate-pulse">Thinking...</span>
                )}
              </div>
              <p className="text-xs text-slate-100 leading-relaxed italic">
                “{npc.thought || 'Observing the island breeze...'}”
              </p>
            </div>

            {/* Goal & Action */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Current Goal</div>
                <div className="text-xs font-medium text-slate-100 mt-0.5">{npc.current_goal}</div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-400">
                    Action:{' '}
                    <span className="text-emerald-300 font-mono">{npc.current_action}</span>
                  </span>
                  <span className="font-mono text-slate-300">
                    {Math.round((npc.action_progress ?? 0) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-150"
                    style={{ width: `${Math.min(100, Math.max(0, (npc.action_progress ?? 0) * 100))}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Spatial Self-Awareness */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
                  <Compass className="w-3.5 h-3.5" />
                  Spatial Awareness
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    npc.perception.sheltered
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  <Home className="w-2.5 h-2.5" />
                  {npc.perception.sheltered ? 'Sheltered' : 'Outdoors'}
                </span>
              </div>

              <div className="text-xs font-semibold text-slate-200">
                {npc.perception.location_label}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {npc.perception.visible_summary}
              </p>

              {npc.perception.nearby_entities?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {npc.perception.nearby_entities.map((ent, idx) => (
                    <span
                      key={`${ent.kind}-${ent.x}-${ent.z}-${idx}`}
                      className="px-2 py-0.5 rounded-md bg-slate-950/90 border border-slate-800 text-[10px] text-slate-300 font-mono"
                    >
                      {ent.label ?? ent.kind} · {ent.distance.toFixed(1)}m
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Memories & Journal */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex gap-1 bg-slate-950 rounded-lg p-0.5 text-[11px]">
                  <button
                    onClick={() => setLogTab('memories')}
                    className={`px-2 py-1 rounded-md transition cursor-pointer ${
                      logTab === 'memories' ? 'bg-slate-800 text-white' : 'text-slate-400'
                    }`}
                  >
                    Memories ({npc.memories.length})
                  </button>
                  <button
                    onClick={() => setLogTab('journal')}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md transition cursor-pointer ${
                      logTab === 'journal' ? 'bg-slate-800 text-white' : 'text-slate-400'
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    Journal ({npc.journal.length})
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-44 overflow-y-auto hud-scroll pr-1">
                {entries.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic">No entries recorded yet.</div>
                ) : (
                  entries.map((item, i) => {
                    const f = formatEntry(item);
                    return (
                      <div key={i} className="text-[11px] leading-snug border-l-2 border-slate-700 pl-2">
                        <span className="font-mono text-[10px] text-cyan-400 mr-1.5">[{f.tag}]</span>
                        <span className="text-slate-300">{f.text}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Human Needs */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Human Needs
              </div>
              <NeedBar label="Health" value={npc.needs.health} icon={Heart} barColor="bg-rose-500" />
              <NeedBar label="Hunger" value={npc.needs.hunger} icon={Utensils} barColor="bg-amber-400" />
              <NeedBar label="Thirst" value={npc.needs.thirst} icon={Droplets} barColor="bg-sky-400" />
              <NeedBar label="Energy" value={npc.needs.energy} icon={Zap} barColor="bg-emerald-400" />
              <NeedBar label="Mood" value={npc.needs.mood} icon={Smile} barColor="bg-violet-400" />
            </div>

            {/* Inventory */}
            <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
                <Package className="w-3.5 h-3.5" />
                Inventory
              </div>
              <div className="grid grid-cols-2 gap-2">
                {inventoryKeys.map((key) => {
                  const meta = ITEM_LABELS[key] ?? { label: key.replace(/_/g, ' '), emoji: '📦' };
                  const qty = npc.inventory[key] ?? 0;
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-xs ${
                        qty > 0
                          ? 'bg-slate-950/90 border-slate-700 text-slate-100'
                          : 'bg-slate-950/40 border-slate-800/60 text-slate-500'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span>{meta.emoji}</span>
                        <span className="truncate capitalize text-[11px]">{meta.label}</span>
                      </span>
                      <span className="font-mono font-bold ml-1">{qty}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
