import { useState } from 'react';
import { Brain, Trash2 } from 'lucide-react';
import type { MemoryItem, NpcState, WorldStateSnapshot } from '../types/world';

interface InspectorDrawerProps {
  state: WorldStateSnapshot;
  agents: NpcState[];
  selectedAgentId: string;
  open: boolean;
  onSelectAgent: (agentId: string) => void;
  onOpenBrainForAgent: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
  onNpcAction?: (action: string, params?: Record<string, unknown>, agentId?: string) => void;
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

export function InspectorDrawer({
  state,
  agents,
  selectedAgentId,
  open,
  onSelectAgent,
  onOpenBrainForAgent,
  onDeleteAgent,
  onNpcAction,
}: InspectorDrawerProps) {
  const [tab, setTab] = useState<'mind' | 'vitals' | 'world'>('mind');
  const [logMode, setLogMode] = useState<'memories' | 'journal'>('memories');
  const [combatTargetId, setCombatTargetId] = useState('');

  if (!open) return null;

  const npc =
    agents.find((a, idx) => (a.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`)) === selectedAgentId) ??
    agents[0] ??
    state.npc;
  const activeId = npc.id ?? selectedAgentId;
  const llm = npc.llm_status ?? state.llm_status;
  const logs = logMode === 'memories' ? npc.memories : npc.journal;
  const creatures = state.entities ?? [];
  const { stats } = state;
  const otherNpcs = agents.filter((a, i) => (a.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`)) !== activeId);
  const resolvedTargetId =
    otherNpcs.find((a, i) => (a.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`)) === combatTargetId)?.id ??
    otherNpcs[0]?.id ??
    '';

  return (
    <aside className="pointer-events-auto fixed top-16 right-3 bottom-16 z-20 w-72 max-w-[calc(100vw-1.5rem)] flex flex-col rounded-2xl bg-neutral-950/75 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
      {/* Header + Agent Switcher */}
      <div className="px-3 pt-3 pb-2 border-b border-white/10 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {agents.length > 1 ? (
              <select
                value={activeId}
                onChange={(e) => onSelectAgent(e.target.value)}
                className="w-full px-2 py-1 rounded-lg bg-neutral-900 border border-white/10 text-xs font-semibold text-white"
              >
                {agents.map((a, i) => {
                  const id = a.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`);
                  return (
                    <option key={id} value={id}>
                      {a.name} ({a.role ?? 'pioneer'})
                    </option>
                  );
                })}
              </select>
            ) : (
              <div className="text-xs font-semibold text-white truncate">
                {npc.name}{' '}
                <span className="font-normal text-neutral-400 capitalize">({npc.role ?? 'pioneer'})</span>
              </div>
            )}
            <div className="text-[10px] font-mono text-neutral-400 mt-1">
              ({npc.grid_pos.x}, {npc.grid_pos.y}, {npc.grid_pos.z}) · {npc.animation}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onOpenBrainForAgent(activeId)}
              title={`Manage ${npc.name}'s Brain`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white hover:text-neutral-950 text-[10px] text-neutral-200 transition cursor-pointer"
            >
              <Brain className="w-3 h-3" />
              <span>Brain</span>
            </button>
            {activeId !== 'aiden' && (
              <button
                onClick={() => onDeleteAgent(activeId)}
                title={`Remove ${npc.name}`}
                className="p-1 rounded-lg text-neutral-500 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-neutral-400 font-mono">
          <span className="truncate">
            Brain: {llm.provider}
            {llm.model ? `/${llm.model}` : ''}
          </span>
          <span>{npc.perception.sheltered ? 'Indoors' : 'Outdoors'}</span>
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
                {llm.thinking && <span className="text-neutral-300 animate-pulse">Thinking</span>}
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
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500">
                <span>Weapons & Hunting</span>
                <span className="font-mono text-neutral-400">
                  {npc.weapons &&
                  Object.entries(npc.weapons).find(([, v]) => v.owned > 0 && v.durability > 0)?.[0]?.replace(/_/g, ' ')
                    ? 'Armed'
                    : 'Unarmed'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { key: 'wooden_spear', label: 'Spear', cost: '1 log, 1 stone' },
                    { key: 'hunting_bow', label: 'Bow', cost: '2 plank, 2 rope' },
                    { key: 'iron_sword', label: 'Sword', cost: '2 iron, 1 plank' },
                  ] as const
                ).map((w) => {
                  const info = npc.weapons?.[w.key];
                  const owned = info?.owned ?? npc.inventory[w.key] ?? 0;
                  return (
                    <div
                      key={w.key}
                      title={w.cost}
                      className="rounded-lg bg-neutral-950/70 border border-white/5 px-1.5 py-1 text-center"
                    >
                      <div className="text-[10px] text-neutral-300 truncate">{w.label}</div>
                      <div className="text-[10px] font-mono text-neutral-400">
                        {owned > 0 ? `${Math.round(info?.durability ?? 100)}%` : 'None'}
                      </div>
                    </div>
                  );
                })}
              </div>
              {onNpcAction && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onNpcAction('craft', { recipe: 'wooden_spear' }, activeId)}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] text-neutral-200 cursor-pointer"
                  >
                    Craft Spear
                  </button>
                  <button
                    type="button"
                    onClick={() => onNpcAction('craft', { recipe: 'hunting_bow' }, activeId)}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] text-neutral-200 cursor-pointer"
                  >
                    Craft Bow
                  </button>
                  <button
                    type="button"
                    onClick={() => onNpcAction('hunt', {}, activeId)}
                    className="px-2 py-1 rounded-lg bg-white text-neutral-950 font-medium hover:bg-neutral-200 text-[10px] cursor-pointer"
                  >
                    Hunt Animal
                  </button>
                  {(npc.inventory.raw_meat ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => onNpcAction('craft', { recipe: 'cooked_meat' }, activeId)}
                      className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] text-neutral-200 cursor-pointer"
                    >
                      Cook Meat
                    </button>
                  )}
                </div>
              )}

              {onNpcAction && otherNpcs.length > 0 && (
                <div className="pt-2 border-t border-white/10 space-y-1.5">
                  <div className="text-[10px] text-neutral-400 flex justify-between">
                    <span>Instruct Combat / Self-Defense</span>
                    {(npc.threatened_by || npc.hostile_target) && (
                      <span className="font-mono text-neutral-200">
                        {npc.threatened_by ? 'Defending' : 'Attacking'}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <select
                      value={resolvedTargetId}
                      onChange={(e) => setCombatTargetId(e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-neutral-950 border border-white/10 text-[10px] text-neutral-200"
                    >
                      {otherNpcs.map((peer, idx) => {
                        const pid = peer.id ?? `npc-${idx + 1}`;
                        return (
                          <option key={pid} value={pid}>
                            {peer.name} ({Math.round(peer.needs.health)}% HP)
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      disabled={!resolvedTargetId}
                      onClick={() => onNpcAction('attack', { target_id: resolvedTargetId }, activeId)}
                      className="px-2.5 py-1 rounded-lg bg-white text-neutral-950 font-medium hover:bg-neutral-200 disabled:opacity-40 text-[10px] cursor-pointer shrink-0"
                    >
                      Attack
                    </button>
                    {(npc.hostile_target || npc.threatened_by || npc.current_action === 'attack') && (
                      <button
                        type="button"
                        onClick={() => onNpcAction('idle', {}, activeId)}
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] text-neutral-200 cursor-pointer shrink-0"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-white/5 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Inventory</div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(npc.inventory)
                  .filter(([k, qty]) => qty > 0 || ['wood_log', 'wood_plank', 'stone', 'berries', 'bread', 'cooked_meat'].includes(k))
                  .map(([k, qty]) => (
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
                <span className="text-neutral-400">AI NPCs</span>
                <span className="font-mono text-neutral-200">{agents.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Trees</span>
                <span className="font-mono text-neutral-200">{stats.trees_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Placed / Broken</span>
                <span className="font-mono text-neutral-200">
                  {stats.blocks_placed} / {stats.blocks_broken}
                </span>
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
                Animals & Villagers ({creatures.length})
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
