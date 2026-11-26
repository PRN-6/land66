import { useState } from 'react';
import type { MemoryItem, WorldStateSnapshot } from '../types/world';

interface InspectorDrawerProps {
  state: WorldStateSnapshot;
  open: boolean;
}

function formatEntry(entry: MemoryItem | string): { tag: string; text: string } {
  if (typeof entry === 'string') return { tag: 'Note', text: entry };
  const tag = [entry.day !== undefined ? `D${entry.day}` : '', entry.clock ?? '']
    .filter(Boolean)
    .join(' ');
  return { tag: tag || 'Log', text: entry.text };
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-neutral-400">{label}</span>
        <span className="font-mono text-neutral-200">{pct}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-neutral-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-neutral-200 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function InspectorDrawer({ state, open }: InspectorDrawerProps) {
  const [tab, setTab] = useState<'mind' | 'vitals' | 'world'>('mind');
  const [logMode, setLogMode] = useState<'memories' | 'journal'>('memories');

  if (!open) return null;

  const { npc, stats } = state;
  const logs = logMode === 'memories' ? npc.memories : npc.journal;
  const creatures = state.entities ?? [];

  return (
    <aside className="pointer-events-auto fixed top-16 right-3 bottom-16 z-20 w-72 max-w-[calc(100vw-1.5rem)] flex flex-col rounded-2xl bg-neutral-950/75 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
      {/* Header + Minimal Tabs */}
      <div className="px-3 pt-3 pb-2 border-b border-white/10 space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">{npc.name}</div>
            <div className="text-[10px] font-mono text-neutral-400">
              ({npc.grid_pos.x}, {npc.grid_pos.y}, {npc.grid_pos.z}) · {npc.animation}
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-neutral-300">
            {npc.perception.sheltered ? 'Indoors' : 'Outdoors'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-neutral-900/90 border border-white/5 text-[11px]">
          {(['mind', 'vitals', 'world'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-1 rounded-md capitalize transition cursor-pointer ${
                tab === t ? 'bg-white text-neutral-950 font-medium' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto hud-scroll p-3 space-y-3">
        {tab === 'mind' && (
          <>
            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500">
                <span>Thought</span>
                {state.llm_status.thinking && <span className="text-neutral-300 animate-pulse">Thinking</span>}
              </div>
              <p className="text-xs text-neutral-100 leading-relaxed">“{npc.thought}”</p>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Goal</div>
                <div className="text-xs text-neutral-200 mt-0.5">{npc.current_goal}</div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-neutral-400 mb-1">
                  <span className="font-mono">{npc.current_action}</span>
                  <span className="font-mono">{Math.round((npc.action_progress ?? 0) * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-neutral-200 transition-all duration-150"
                    style={{ width: `${Math.min(100, Math.max(0, (npc.action_progress ?? 0) * 100))}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                Perception · {npc.perception.location_label}
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                {npc.perception.visible_summary}
              </p>
              {npc.perception.nearby_entities?.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {npc.perception.nearby_entities.slice(0, 6).map((ent, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded bg-neutral-950 border border-white/5 text-[10px] text-neutral-300 font-mono"
                    >
                      {ent.label ?? ent.kind} · {ent.distance.toFixed(1)}m
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-2">
              <div className="flex gap-1 text-[10px]">
                <button
                  onClick={() => setLogMode('memories')}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    logMode === 'memories' ? 'bg-white text-neutral-950 font-medium' : 'text-neutral-400'
                  }`}
                >
                  Memories ({npc.memories.length})
                </button>
                <button
                  onClick={() => setLogMode('journal')}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    logMode === 'journal' ? 'bg-white text-neutral-950 font-medium' : 'text-neutral-400'
                  }`}
                >
                  Journal ({npc.journal.length})
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto hud-scroll">
                {logs.length === 0 ? (
                  <div className="text-[11px] text-neutral-500">Empty</div>
                ) : (
                  logs.map((entry, idx) => {
                    const f = formatEntry(entry);
                    return (
                      <div key={idx} className="text-[11px] leading-snug border-l border-white/15 pl-2">
                        <span className="font-mono text-[10px] text-neutral-500 mr-1.5">{f.tag}</span>
                        <span className="text-neutral-300">{f.text}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}

        {tab === 'vitals' && (
          <>
            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-2.5">
              <Meter label="Health" value={npc.needs.health} />
              <Meter label="Hunger" value={npc.needs.hunger} />
              <Meter label="Thirst" value={npc.needs.thirst} />
              <Meter label="Energy" value={npc.needs.energy} />
              <Meter label="Mood" value={npc.needs.mood} />
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Inventory</div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(npc.inventory).map(([k, qty]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-neutral-950/70 border border-white/5 text-[11px]"
                  >
                    <span className="text-neutral-400 capitalize truncate">{k.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-neutral-100 ml-1">{qty}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'world' && (
          <>
            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-2">
              <Meter label={`House (${stats.house_stage.replace(/_/g, ' ')})`} value={stats.house_progress} />
              <div className="grid grid-cols-3 gap-1.5 text-center pt-1">
                <div className="p-1.5 rounded-lg bg-neutral-950 border border-white/5">
                  <div className="text-sm font-mono text-white">{stats.farm_plots}</div>
                  <div className="text-[10px] text-neutral-500">Plots</div>
                </div>
                <div className="p-1.5 rounded-lg bg-neutral-950 border border-white/5">
                  <div className="text-sm font-mono text-white">{stats.crops_growing}</div>
                  <div className="text-[10px] text-neutral-500">Growing</div>
                </div>
                <div className="p-1.5 rounded-lg bg-neutral-950 border border-white/5">
                  <div className="text-sm font-mono text-white">{stats.crops_ripe}</div>
                  <div className="text-[10px] text-neutral-500">Ripe</div>
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-neutral-400">Trees</span>
                <span className="font-mono text-neutral-200">{stats.trees_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Blocks Placed</span>
                <span className="font-mono text-neutral-200">{stats.blocks_placed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Blocks Broken</span>
                <span className="font-mono text-neutral-200">{stats.blocks_broken}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Seed / Tick</span>
                <span className="font-mono text-neutral-200">
                  {state.seed} / #{state.tick}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                Characters & Animals ({creatures.length})
              </div>
              {creatures.length === 0 ? (
                <div className="text-[11px] text-neutral-500">None spawned yet.</div>
              ) : (
                <div className="space-y-1 max-h-36 overflow-y-auto hud-scroll">
                  {creatures.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between px-2 py-1 rounded bg-neutral-950 border border-white/5 text-[11px]"
                    >
                      <span className="text-neutral-200">
                        {c.name} <span className="text-neutral-500">({c.kind})</span>
                      </span>
                      <span className="font-mono text-[10px] text-neutral-400">{c.animation}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
