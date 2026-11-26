import { useState } from 'react';
import {
  Box,
  Eraser,
  MousePointer,
  Send,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { EntityKind, GodTool, WorldStateSnapshot } from '../types/world';

interface GodDockProps {
  state: WorldStateSnapshot;
  activeTool: GodTool;
  onSelectTool: (tool: GodTool) => void;
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
  ) => void;
}

const WORLD_OBJECTS: Array<{ object: string; label: string; group: string }> = [
  { object: 'tree', label: 'Tree', group: 'Nature' },
  { object: 'sapling', label: 'Sapling', group: 'Nature' },
  { object: 'wild_berry', label: 'Berry Bush', group: 'Nature' },
  { object: 'stone', label: 'Boulder', group: 'Nature' },
  { object: 'water', label: 'Water', group: 'Nature' },
  { object: 'grass', label: 'Grass', group: 'Nature' },
  { object: 'dirt', label: 'Dirt', group: 'Nature' },
  { object: 'farmland', label: 'Farmland', group: 'Farm' },
  { object: 'crop_wheat', label: 'Ripe Wheat', group: 'Farm' },
  { object: 'fence', label: 'Fence', group: 'Build' },
  { object: 'wood_log', label: 'Log', group: 'Build' },
  { object: 'wood_plank', label: 'Wood Wall', group: 'Build' },
  { object: 'cobblestone', label: 'Cobble', group: 'Build' },
  { object: 'roof_shingle', label: 'Roof Tile', group: 'Build' },
  { object: 'glass', label: 'Window', group: 'Build' },
  { object: 'door_closed', label: 'Door', group: 'Build' },
  { object: 'torch', label: 'Lantern', group: 'Prop' },
  { object: 'bed', label: 'Bed', group: 'Prop' },
  { object: 'chest', label: 'Chest', group: 'Prop' },
  { object: 'crafting_bench', label: 'Workbench', group: 'Prop' },
];

const CREATURES: Array<{ kind: EntityKind; label: string; tag: string }> = [
  { kind: 'companion', label: 'Companion', tag: 'Person' },
  { kind: 'villager', label: 'Villager', tag: 'Person' },
  { kind: 'cat', label: 'Cat', tag: 'Animal' },
  { kind: 'fox', label: 'Fox', tag: 'Animal' },
  { kind: 'sheep', label: 'Sheep', tag: 'Animal' },
  { kind: 'deer', label: 'Deer', tag: 'Animal' },
  { kind: 'duck', label: 'Duck', tag: 'Animal' },
];

export function GodDock({ state, activeTool, onSelectTool, onGodIntervene }: GodDockProps) {
  const [tray, setTray] = useState<'objects' | 'life' | 'world' | null>(null);
  const [customName, setCustomName] = useState('');
  const [whisperText, setWhisperText] = useState('');
  const [giftItem, setGiftItem] = useState('berries');

  const toggleTray = (next: 'objects' | 'life' | 'world') => {
    setTray((prev) => (prev === next ? null : next));
  };

  const sendWhisper = () => {
    const t = whisperText.trim();
    if (!t) return;
    onGodIntervene('whisper', t);
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
              onClick={() => onGodIntervene('spawn_object', { object: activeTool.object })}
              className="px-2 py-0.5 rounded-full bg-white text-neutral-950 font-medium text-[10px] hover:bg-neutral-200 cursor-pointer"
            >
              Drop Near {state.npc.name}
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
              Spawn Near {state.npc.name}
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

      {/* Expandable Minimal Tray */}
      {tray === 'objects' && (
        <div className="w-[34rem] max-w-[calc(100vw-1.5rem)] p-3 rounded-2xl bg-neutral-950/88 backdrop-blur-2xl border border-white/10 shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-neutral-300">
              World Objects — select & click island to place
            </span>
            <button onClick={() => setTray(null)} className="text-neutral-500 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
            {WORLD_OBJECTS.map((obj) => {
              const selected = activeTool.mode === 'object' && activeTool.object === obj.object;
              return (
                <button
                  key={obj.object}
                  onClick={() => {
                    onSelectTool({ mode: 'object', object: obj.object, label: obj.label });
                    setTray(null);
                  }}
                  className={`px-2 py-1.5 rounded-xl border text-left transition cursor-pointer ${
                    selected
                      ? 'bg-white text-neutral-950 border-white font-medium'
                      : 'bg-neutral-900/80 border-white/5 text-neutral-200 hover:border-white/25 hover:bg-neutral-800/80'
                  }`}
                >
                  <div className="text-[11px] truncate">{obj.label}</div>
                  <div className={`text-[9px] ${selected ? 'text-neutral-600' : 'text-neutral-500'}`}>
                    {obj.group}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tray === 'life' && (
        <div className="w-[26rem] max-w-[calc(100vw-1.5rem)] p-3 rounded-2xl bg-neutral-950/88 backdrop-blur-2xl border border-white/10 shadow-2xl space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-neutral-300">
              Characters & Animals ({entityCount}/24)
            </span>
            <div className="flex items-center gap-2">
              {entityCount > 0 && (
                <button
                  onClick={() => onGodIntervene('clear_entities')}
                  className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              )}
              <button onClick={() => setTray(null)} className="text-neutral-500 hover:text-white cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Optional name (e.g. Mochi, Maya)..."
            className="w-full px-2.5 py-1.5 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
          />

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {CREATURES.map((c) => {
              const selected = activeTool.mode === 'entity' && activeTool.kind === c.kind;
              return (
                <button
                  key={c.kind}
                  onClick={() => {
                    onSelectTool({
                      mode: 'entity',
                      kind: c.kind,
                      label: c.label,
                      customName: customName.trim() || undefined,
                    });
                    setTray(null);
                  }}
                  className={`px-2.5 py-2 rounded-xl border text-left transition cursor-pointer ${
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
      )}

      {tray === 'world' && (
        <div className="w-[24rem] max-w-[calc(100vw-1.5rem)] p-3 rounded-2xl bg-neutral-950/88 backdrop-blur-2xl border border-white/10 shadow-2xl space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-neutral-300">World & Influence</span>
            <button onClick={() => setTray(null)} className="text-neutral-500 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
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

          <div className="flex gap-1.5">
            <input
              type="text"
              value={whisperText}
              onChange={(e) => setWhisperText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendWhisper()}
              placeholder={`Whisper to ${state.npc.name}...`}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
            />
            <button
              onClick={sendWhisper}
              className="px-2.5 py-1.5 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
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
            </select>
            <button
              onClick={() => onGodIntervene('drop_gift', { [giftItem]: 3 })}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-[11px] text-white cursor-pointer"
            >
              Gift
            </button>
            <button
              onClick={() => onGodIntervene('heal_npc')}
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
            setTray(null);
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
            tray === 'life' || activeTool.mode === 'entity'
              ? 'bg-white text-neutral-950 font-medium'
              : 'text-neutral-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Characters & Animals</span>
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
            setTray(null);
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
