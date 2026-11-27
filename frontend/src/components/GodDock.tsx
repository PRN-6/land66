import { useState } from 'react';
import {
  Box,
  Brain,
  Eraser,
  Globe,
  MousePointer,
  Plus,
  Send,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  PLACEABLE_MATERIALS,
} from '../engine/materialCatalog';
import type {
  AgentRole,
  EntityKind,
  GodTool,
  NpcState,
  WorldStateSnapshot,
} from '../types/world';

interface GodDockProps {
  state: WorldStateSnapshot;
  agents: NpcState[];
  selectedAgentId: string;
  activeTool: GodTool;
  tray: 'objects' | 'life' | 'world' | null;
  onSetTray: (tray: 'objects' | 'life' | 'world' | null) => void;
  onSelectTool: (tool: GodTool) => void;
  onSelectAgent: (agentId: string) => void;
  onOpenBrainForAgent: (agentId: string) => void;
  onCreateAgent: (payload: { name?: string; role: AgentRole }) => void;
  onDeleteAgent: (agentId: string) => void;
  onSwitchWorld: (worldId: string) => void;
  onOpenCreateWorldModal: () => void;
  onGodIntervene: (
    action:
      | 'set_time'
      | 'set_weather'
      | 'whisper'
      | 'drop_gift'
      | 'heal_npc'
      | 'spawn_object'
      | 'spawn_entity'
      | 'clear_entities',
    value?: unknown,
    agentId?: string,
  ) => void;
}

const WORLD_OBJECTS: Array<{ object: string; label: string; group: string; swatch?: string; material?: string }> = [
  { object: 'tree', label: 'Tree', group: 'Nature', swatch: '#76aa64' },
  { object: 'sapling', label: 'Sapling', group: 'Nature', swatch: '#8bc072' },
  { object: 'wild_berry', label: 'Berry Bush', group: 'Nature', swatch: '#e11d48' },
  { object: 'stone', label: 'Boulder', group: 'Nature', swatch: '#9099a1' },
  { object: 'water', label: 'Water', group: 'Nature', swatch: '#5cc4d8' },
  { object: 'grass', label: 'Grass', group: 'Nature', swatch: '#90be65' },
  { object: 'dirt', label: 'Dirt', group: 'Nature', swatch: '#8e6c53' },
  { object: 'farmland', label: 'Farmland', group: 'Nature', swatch: '#7d5b3e' },
  { object: 'crop_wheat', label: 'Ripe Wheat', group: 'Nature', swatch: '#f2c249' },
  { object: 'fence', label: 'Fence', group: 'Build', swatch: '#c89d6c' },
  { object: 'wood_log', label: 'Log', group: 'Build', swatch: '#704d37' },
  { object: 'wood_plank', label: 'Wood Wall', group: 'Build', swatch: '#d1a574' },
  { object: 'cobblestone', label: 'Cobble', group: 'Build', swatch: '#a4abb2' },
  { object: 'roof_shingle', label: 'Roof Tile', group: 'Build', swatch: '#4b6a75' },
  { object: 'glass', label: 'Window', group: 'Build', swatch: '#c6eef9' },
  { object: 'door_closed', label: 'Door', group: 'Build', swatch: '#b68150' },
  { object: 'torch', label: 'Lantern', group: 'Prop', swatch: '#ffdf9a' },
  { object: 'bed', label: 'Bed', group: 'Prop', swatch: '#d65b59' },
  { object: 'chest', label: 'Chest', group: 'Prop', swatch: '#b37b48' },
  { object: 'crafting_bench', label: 'Workbench', group: 'Prop', swatch: '#cf9b63' },
  ...PLACEABLE_MATERIALS.map((m) => ({
    object: m.id,
    label: m.label,
    group: 'Materials',
    swatch: m.colorCss,
    material: m.id,
  })),
];

const AI_ROLES: Array<{ role: AgentRole; label: string }> = [
  { role: 'pioneer', label: 'Pioneer' },
  { role: 'builder', label: 'Builder' },
  { role: 'farmer', label: 'Farmer' },
  { role: 'forager', label: 'Forager' },
  { role: 'explorer', label: 'Explorer' },
];

const WILDLIFE: Array<{ kind: EntityKind; label: string; tag: string }> = [
  { kind: 'cat', label: 'Cat', tag: 'Animal' },
  { kind: 'fox', label: 'Fox', tag: 'Animal' },
  { kind: 'sheep', label: 'Sheep', tag: 'Animal' },
  { kind: 'deer', label: 'Deer', tag: 'Animal' },
  { kind: 'duck', label: 'Duck', tag: 'Animal' },
  { kind: 'villager', label: 'Villager', tag: 'Ambient' },
];

export function GodDock({
  state,
  agents,
  selectedAgentId,
  activeTool,
  tray,
  onSetTray,
  onSelectTool,
  onSelectAgent,
  onOpenBrainForAgent,
  onCreateAgent,
  onDeleteAgent,
  onSwitchWorld,
  onOpenCreateWorldModal,
  onGodIntervene,
}: GodDockProps) {
  const [npcName, setNpcName] = useState('');
  const [npcRole, setNpcRole] = useState<AgentRole>('builder');
  const [customAnimalName, setCustomAnimalName] = useState('');
  const [objectCategory, setObjectCategory] = useState<'All' | 'Materials' | 'Nature' | 'Build' | 'Prop'>('All');
  const [whisperText, setWhisperText] = useState('');
  const [whisperTarget, setWhisperTarget] = useState<'selected' | 'all'>('selected');
  const [giftItem, setGiftItem] = useState('berries');

  const toggleTray = (next: 'objects' | 'life' | 'world') => {
    onSetTray(tray === next ? null : next);
  };

  const selectedNpc =
    agents.find((a, i) => (a.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`)) === selectedAgentId) ??
    agents[0] ??
    state.npc;

  const sendWhisper = () => {
    const t = whisperText.trim();
    if (!t) return;
    onGodIntervene('whisper', t, whisperTarget === 'all' ? 'all' : selectedAgentId);
    setWhisperText('');
  };

  const entityCount = state.entities?.length ?? state.stats.entities_count ?? 0;

  return (
    <div className="pointer-events-auto fixed bottom-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 max-w-[calc(100vw-1.5rem)]">
      {/* Active Placement Hint */}
      {activeTool.mode !== 'inspect' && (
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-950/90 backdrop-blur-xl border border-white/15 text-[11px] text-neutral-200 shadow-lg">
          <span>
            {activeTool.mode === 'erase'
              ? 'Click any block on the island to remove'
              : `Click island to place ${activeTool.label}`}
          </span>
          {activeTool.mode === 'object' && (
            <button
              onClick={() =>
                onGodIntervene('spawn_object', {
                  object: activeTool.object,
                  ...(activeTool.material ? { material: activeTool.material } : {}),
                })
              }
              className="px-2 py-0.5 rounded-full bg-white text-neutral-950 font-medium text-[10px] hover:bg-neutral-200 cursor-pointer"
            >
              Drop Near {selectedNpc.name}
            </button>
          )}
          {activeTool.mode === 'entity' && (
            <button
              onClick={() =>
                onGodIntervene('spawn_entity', {
                  kind: activeTool.kind,
                  name: activeTool.customName || undefined,
                })
              }
              className="px-2 py-0.5 rounded-full bg-white text-neutral-950 font-medium text-[10px] hover:bg-neutral-200 cursor-pointer"
            >
              Spawn Near {selectedNpc.name}
            </button>
          )}
          {activeTool.mode === 'agent' && (
            <button
              onClick={() => {
                onCreateAgent({ name: activeTool.customName, role: activeTool.role });
                onSelectTool({ mode: 'inspect' });
              }}
              className="px-2 py-0.5 rounded-full bg-white text-neutral-950 font-medium text-[10px] hover:bg-neutral-200 cursor-pointer"
            >
              Spawn Now
            </button>
          )}
          <button
            onClick={() => onSelectTool({ mode: 'inspect' })}
            title="Cancel (Esc)"
            className="text-neutral-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Objects & Materials Tray */}
      {tray === 'objects' && (
        <div className="w-[36rem] max-w-[calc(100vw-1.5rem)] p-3 rounded-2xl bg-neutral-950/90 backdrop-blur-2xl border border-white/10 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1">
              {(['All', 'Materials', 'Nature', 'Build', 'Prop'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setObjectCategory(cat)}
                  className={`px-2 py-0.5 rounded-full text-[10px] transition cursor-pointer ${
                    objectCategory === cat
                      ? 'bg-white text-neutral-950 font-medium'
                      : 'text-neutral-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <button onClick={() => onSetTray(null)} className="text-neutral-500 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 max-h-60 overflow-y-auto hud-scroll pr-0.5">
            {WORLD_OBJECTS.filter((obj) => objectCategory === 'All' || obj.group === objectCategory).map((obj) => {
              const selected = activeTool.mode === 'object' && activeTool.object === obj.object;
              return (
                <button
                  key={obj.object}
                  onClick={() => {
                    onSelectTool({ mode: 'object', object: obj.object, label: obj.label, material: obj.material });
                    onSetTray(null);
                  }}
                  className={`px-2 py-1.5 rounded-xl border text-left transition cursor-pointer ${
                    selected
                      ? 'bg-white text-neutral-950 border-white font-medium'
                      : 'bg-neutral-900/80 border-white/5 text-neutral-200 hover:border-white/25 hover:bg-neutral-800/80'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {obj.swatch && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0 border border-white/20"
                        style={{ backgroundColor: obj.swatch }}
                      />
                    )}
                    <span className="text-[11px] truncate">{obj.label}</span>
                  </div>
                  <div className={`text-[9px] mt-0.5 ${selected ? 'text-neutral-600' : 'text-neutral-500'}`}>
                    {obj.group}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* AI NPCs & Animals Tray */}
      {tray === 'life' && (
        <div className="w-[30rem] max-w-[calc(100vw-1.5rem)] p-3 rounded-2xl bg-neutral-950/90 backdrop-blur-2xl border border-white/10 shadow-2xl space-y-3 max-h-[65vh] overflow-y-auto hud-scroll">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-neutral-200">
              Autonomous AI NPCs ({agents.length}/8)
            </span>
            <button onClick={() => onSetTray(null)} className="text-neutral-500 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Active AI NPC Roster */}
          <div className="space-y-1.5">
            {agents.map((ag, idx) => {
              const aid = ag.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`);
              const isSel = aid === selectedAgentId;
              const brainName = ag.llm_status?.model || ag.llm_status?.provider || 'fallback';
              return (
                <div
                  key={aid}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border ${
                    isSel ? 'bg-white/10 border-white/30' : 'bg-neutral-900/70 border-white/5'
                  }`}
                >
                  <button
                    onClick={() => onSelectAgent(aid)}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div className="text-xs font-medium text-white truncate">
                      {ag.name}{' '}
                      <span className="text-[10px] text-neutral-400 font-normal capitalize">
                        · {ag.role ?? 'pioneer'}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-neutral-400 truncate">
                      Brain: {brainName} · {ag.current_action}
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onOpenBrainForAgent(aid)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white hover:text-neutral-950 text-[10px] text-neutral-200 transition cursor-pointer"
                    >
                      <Brain className="w-3 h-3" />
                      Brain
                    </button>
                    {aid !== 'aiden' && (
                      <button
                        onClick={() => onDeleteAgent(aid)}
                        title={`Remove ${ag.name}`}
                        className="p-1 rounded-lg text-neutral-500 hover:text-white hover:bg-white/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add New AI NPC */}
          <div className="p-2.5 rounded-xl bg-neutral-900/60 border border-white/5 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">
              Add New AI NPC (With Own Brain)
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={npcName}
                onChange={(e) => setNpcName(e.target.value)}
                placeholder="Name (optional, e.g. Elena)"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
              />
              <select
                value={npcRole}
                onChange={(e) => setNpcRole(e.target.value as AgentRole)}
                className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-xs text-neutral-200"
              >
                {AI_ROLES.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  onCreateAgent({ name: npcName.trim() || undefined, role: npcRole });
                  setNpcName('');
                }}
                disabled={agents.length >= 8}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white hover:bg-neutral-200 disabled:opacity-40 text-[11px] font-semibold text-neutral-950 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Spawn AI NPC
              </button>
              <button
                onClick={() => {
                  onSelectTool({
                    mode: 'agent',
                    role: npcRole,
                    label: `${npcName.trim() || npcRole} (AI)`,
                    customName: npcName.trim() || undefined,
                  });
                  onSetTray(null);
                }}
                disabled={agents.length >= 8}
                className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-[11px] text-neutral-200 cursor-pointer"
              >
                Place on Click
              </button>
            </div>
          </div>

          {/* Animals & Ambient Villagers */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-neutral-300">
                Animals & Villagers ({entityCount}/24)
              </span>
              {entityCount > 0 && (
                <button
                  onClick={() => onGodIntervene('clear_entities')}
                  className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Animals
                </button>
              )}
            </div>

            <input
              type="text"
              value={customAnimalName}
              onChange={(e) => setCustomAnimalName(e.target.value)}
              placeholder="Optional animal name (e.g. Mochi)..."
              className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
            />

            <div className="grid grid-cols-3 gap-1.5">
              {WILDLIFE.map((c) => {
                const selected = activeTool.mode === 'entity' && activeTool.kind === c.kind;
                return (
                  <button
                    key={c.kind}
                    onClick={() => {
                      onSelectTool({
                        mode: 'entity',
                        kind: c.kind,
                        label: c.label,
                        customName: customAnimalName.trim() || undefined,
                      });
                      onSetTray(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl border text-left transition cursor-pointer ${
                      selected
                        ? 'bg-white text-neutral-950 border-white font-medium'
                        : 'bg-neutral-900/80 border-white/5 text-neutral-200 hover:border-white/25 hover:bg-neutral-800/80'
                    }`}
                  >
                    <div className="text-[11px]">{c.label}</div>
                    <div className={`text-[9px] ${selected ? 'text-neutral-600' : 'text-neutral-500'}`}>
                      {c.tag}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* World Controls Tray */}
      {tray === 'world' && (
        <div className="w-[24rem] max-w-[calc(100vw-1.5rem)] p-3 rounded-2xl bg-neutral-950/88 backdrop-blur-2xl border border-white/10 shadow-2xl space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-neutral-300">
              World · {state.world_name ?? state.world_id ?? 'Homestead'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  onSetTray(null);
                  onOpenCreateWorldModal();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-neutral-950 hover:bg-neutral-200 text-[10px] font-semibold cursor-pointer"
              >
                <Globe className="w-3 h-3" />
                Create World
              </button>
              <button onClick={() => onSetTray(null)} className="text-neutral-500 hover:text-white cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {(
              state.worlds && state.worlds.length > 0
                ? state.worlds
                : [
                    { id: 'homestead', name: 'Homestead', preset: 'homestead' },
                    { id: 'market', name: 'Market', preset: 'market' },
                  ]
            ).map((w) => {
              const isActive = (state.world_id ?? 'homestead') === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => onSwitchWorld(w.id)}
                  className={`px-2.5 py-1 rounded-full border text-[10px] transition cursor-pointer ${
                    isActive
                      ? 'bg-white text-neutral-950 border-white font-semibold'
                      : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white hover:border-white/25'
                  }`}
                >
                  {w.name}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-4 gap-1">
            {[
              { label: 'Dawn', val: 0.25 },
              { label: 'Noon', val: 0.5 },
              { label: 'Dusk', val: 0.76 },
              { label: 'Night', val: 0.92 },
            ].map((t) => (
              <button
                key={t.label}
                onClick={() => onGodIntervene('set_time', t.val)}
                className="py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-white/5 text-[11px] text-neutral-200 cursor-pointer"
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-1">
            {(['clear', 'rain', 'storm'] as const).map((w) => (
              <button
                key={w}
                onClick={() => onGodIntervene('set_weather', w)}
                className={`py-1.5 rounded-lg border text-[11px] capitalize cursor-pointer ${
                  state.weather === w
                    ? 'bg-white text-neutral-950 border-white font-medium'
                    : 'bg-neutral-900 border-white/5 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-neutral-400">
              <span>Whisper Target</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setWhisperTarget('selected')}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    whisperTarget === 'selected' ? 'bg-white text-neutral-950 font-medium' : 'bg-neutral-900 text-neutral-400'
                  }`}
                >
                  {selectedNpc.name}
                </button>
                <button
                  onClick={() => setWhisperTarget('all')}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    whisperTarget === 'all' ? 'bg-white text-neutral-950 font-medium' : 'bg-neutral-900 text-neutral-400'
                  }`}
                >
                  All NPCs
                </button>
              </div>
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={whisperText}
                onChange={(e) => setWhisperText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendWhisper()}
                placeholder={`Whisper to ${whisperTarget === 'all' ? 'everyone' : selectedNpc.name}...`}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
              />
              <button
                onClick={sendWhisper}
                className="px-2.5 py-1.5 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <select
              value={giftItem}
              onChange={(e) => setGiftItem(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded-lg bg-neutral-900 border border-white/10 text-[11px] text-neutral-200"
            >
              <option value="berries">Berries (+3)</option>
              <option value="seeds">Seeds (+3)</option>
              <option value="wood_log">Wood Logs (+3)</option>
              <option value="wood_plank">Planks (+3)</option>
              <option value="stone">Stone (+3)</option>
              <option value="bread">Bread (+3)</option>
              <option value="cooked_meat">Cooked Meat (+3)</option>
              <option value="wooden_spear">Wooden Spear (+1)</option>
              <option value="hunting_bow">Hunting Bow (+1)</option>
              <option value="iron_sword">Iron Sword (+1)</option>
            </select>
            <button
              onClick={() =>
                onGodIntervene(
                  'drop_gift',
                  { [giftItem]: ['wooden_spear', 'hunting_bow', 'iron_sword'].includes(giftItem) ? 1 : 3 },
                  selectedAgentId,
                )
              }
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-[11px] text-white cursor-pointer"
            >
              Gift {selectedNpc.name}
            </button>
            <button
              onClick={() => onGodIntervene('heal_npc', undefined, whisperTarget === 'all' ? 'all' : selectedAgentId)}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-[11px] text-white cursor-pointer"
            >
              Heal
            </button>
          </div>
        </div>
      )}

      {/* Main Minimalist Floating Dock */}
      <div className="flex items-center gap-1 p-1.5 rounded-full bg-neutral-950/75 backdrop-blur-xl border border-white/10 shadow-2xl">
        <button
          onClick={() => {
            onSelectTool({ mode: 'inspect' });
            onSetTray(null);
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition cursor-pointer ${
            activeTool.mode === 'inspect' && !tray
              ? 'bg-white text-neutral-950 font-medium'
              : 'text-neutral-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <MousePointer className="w-3.5 h-3.5" />
          <span>Inspect</span>
        </button>

        <button
          onClick={() => toggleTray('objects')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition cursor-pointer ${
            tray === 'objects' || activeTool.mode === 'object'
              ? 'bg-white text-neutral-950 font-medium'
              : 'text-neutral-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>Objects</span>
        </button>

        <button
          onClick={() => toggleTray('life')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition cursor-pointer ${
            tray === 'life' || activeTool.mode === 'entity' || activeTool.mode === 'agent'
              ? 'bg-white text-neutral-950 font-medium'
              : 'text-neutral-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>NPCs & Animals</span>
        </button>

        <button
          onClick={() => toggleTray('world')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition cursor-pointer ${
            tray === 'world'
              ? 'bg-white text-neutral-950 font-medium'
              : 'text-neutral-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Sun className="w-3.5 h-3.5" />
          <span>World</span>
        </button>

        <button
          onClick={() => {
            onSelectTool(activeTool.mode === 'erase' ? { mode: 'inspect' } : { mode: 'erase' });
            onSetTray(null);
          }}
          title="Erase Block"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition cursor-pointer ${
            activeTool.mode === 'erase'
              ? 'bg-white text-neutral-950 font-medium'
              : 'text-neutral-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Eraser className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Erase</span>
        </button>
      </div>
    </div>
  );
}
