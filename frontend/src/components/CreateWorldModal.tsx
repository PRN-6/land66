import { useState } from 'react';
import { Dices, Globe, Plus, Trash2, X } from 'lucide-react';
import type { AgentRole, WorldPresetId, WorldSummary } from '../types/world';

interface CreateWorldModalProps {
  open: boolean;
  activeWorldId: string;
  worlds: WorldSummary[];
  onClose: () => void;
  onCreateWorld: (payload: {
    name?: string;
    preset: WorldPresetId;
    seed?: number;
    starter_name?: string;
    starter_role: AgentRole;
    switch: boolean;
  }) => Promise<string | null>;
  onSwitchWorld: (worldId: string) => void;
  onDeleteWorld: (worldId: string) => Promise<string | null>;
}

const WORLD_PRESETS: Array<{
  id: WorldPresetId;
  label: string;
  tagline: string;
  swatch: string;
}> = [
  { id: 'homestead', label: 'Lush Island', tagline: 'Forested island, pond & rich ores', swatch: '#86a951' },
  { id: 'alpine_peaks', label: 'Alpine Peaks', tagline: 'Slate & marble ridges, pine & crystals', swatch: '#626c78' },
  { id: 'sakura_grove', label: 'Sakura Sanctuary', tagline: 'Blossom grove, marble paths & lanterns', swatch: '#f4a8be' },
  { id: 'crystal_canyon', label: 'Crystal Canyon', tagline: 'Sandstone mesas & crystal spires', swatch: '#70dce3' },
  { id: 'obsidian_caldera', label: 'Volcanic Caldera', tagline: 'Obsidian rim, sunstone & copper seams', swatch: '#f7c866' },
  { id: 'flat_sandbox', label: 'Blank Canvas', tagline: 'Wide level grass field for custom builds', swatch: '#a3b18a' },
  { id: 'market', label: 'Sky Market Bazaar', tagline: 'Trading stalls, marble plaza & merchants', swatch: '#e1c78f' },
];

const STARTER_ROLES: Array<{ id: AgentRole; label: string }> = [
  { id: 'pioneer', label: 'Pioneer' },
  { id: 'builder', label: 'Builder' },
  { id: 'farmer', label: 'Farmer' },
  { id: 'forager', label: 'Forager' },
  { id: 'explorer', label: 'Explorer' },
];

export function CreateWorldModal({
  open,
  activeWorldId,
  worlds,
  onClose,
  onCreateWorld,
  onSwitchWorld,
  onDeleteWorld,
}: CreateWorldModalProps) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<WorldPresetId>('alpine_peaks');
  const [seedInput, setSeedInput] = useState(() => String(Math.floor(Math.random() * 9000) + 1000));
  const [starterName, setStarterName] = useState('');
  const [starterRole, setStarterRole] = useState<AgentRole>('pioneer');
  const [enterImmediately, setEnterImmediately] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const visibleWorlds: WorldSummary[] =
    worlds.length > 0
      ? worlds
      : [
          { id: 'homestead', name: 'Homestead', preset: 'homestead', preset_label: 'Lush Island', seed: 66, builtin: true },
          { id: 'market', name: 'Market', preset: 'market', preset_label: 'Sky Market Bazaar', seed: 166, builtin: true },
        ];

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const parsedSeed = Number.parseInt(seedInput, 10);
      const err = await onCreateWorld({
        name: name.trim() || undefined,
        preset,
        seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
        starter_name: starterName.trim() || undefined,
        starter_role: starterRole,
        switch: enterImmediately,
      });
      if (err) {
        setError(err);
      } else {
        setName('');
        setStarterName('');
        setSeedInput(String(Math.floor(Math.random() * 9000) + 1000));
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-neutral-950/95 border border-white/15 shadow-2xl overflow-hidden text-neutral-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-neutral-200" />
            <div>
              <h2 className="text-sm font-semibold text-white">Worlds & Realms Maintainer</h2>
              <p className="text-[11px] text-neutral-400">
                Switch directly to any floating world to maintain it, or conjure a brand-new realm
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto hud-scroll">
          {/* Existing Floating Worlds */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">
              Existing Worlds ({visibleWorlds.length}) · Click to Enter & Maintain
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {visibleWorlds.map((w) => {
                const isActive = w.id === activeWorldId;
                const isBuiltin = Boolean(w.builtin || w.id === 'homestead' || w.id === 'market');
                return (
                  <div
                    key={w.id}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border ${
                      isActive
                        ? 'bg-white text-neutral-950 border-white'
                        : 'bg-neutral-900/75 border-white/10 text-neutral-200 hover:border-white/25'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchWorld(w.id);
                        onClose();
                      }}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="text-xs font-semibold truncate">
                        {w.name}{' '}
                        {isActive && (
                          <span className="text-[10px] font-normal opacity-75">· Active</span>
                        )}
                      </div>
                      <div className={`text-[10px] font-mono truncate ${isActive ? 'text-neutral-700' : 'text-neutral-400'}`}>
                        {w.preset_label ?? w.preset} · Seed {w.seed}
                      </div>
                    </button>
                    {!isBuiltin && (
                      <button
                        type="button"
                        onClick={async () => {
                          const err = await onDeleteWorld(w.id);
                          if (err) setError(err);
                        }}
                        title={`Delete ${w.name}`}
                        className={`p-1 rounded-lg cursor-pointer ${
                          isActive ? 'text-neutral-700 hover:bg-black/10' : 'text-neutral-500 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* World Name & Seed */}
          <div className="pt-2 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">World Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Emerald Peaks (optional)"
                maxLength={40}
                className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Terrain Seed</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  className="w-full min-w-0 px-2.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={() => setSeedInput(String(Math.floor(Math.random() * 9000) + 1000))}
                  title="Randomize seed"
                  className="px-2.5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 hover:text-white cursor-pointer"
                >
                  <Dices className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Preset Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Biome Preset</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {WORLD_PRESETS.map((p) => {
                const selected = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      selected
                        ? 'bg-white text-neutral-950 border-white'
                        : 'bg-neutral-900/75 border-white/10 text-neutral-200 hover:border-white/25 hover:bg-neutral-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/20"
                        style={{ backgroundColor: p.swatch }}
                      />
                      <span className="text-xs font-semibold">{p.label}</span>
                    </div>
                    <p className={`text-[10px] mt-0.5 ${selected ? 'text-neutral-700' : 'text-neutral-400'}`}>
                      {p.tagline}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Starter Inhabitant */}
          <div className="p-3 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">Starter AI Inhabitant</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={starterName}
                onChange={(e) => setStarterName(e.target.value)}
                placeholder="Name (default Aiden)"
                maxLength={32}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/30"
              />
              <select
                value={starterRole}
                onChange={(e) => setStarterRole(e.target.value as AgentRole)}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-xs text-neutral-200"
              >
                {STARTER_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enterImmediately}
              onChange={(e) => setEnterImmediately(e.target.checked)}
              className="rounded border-white/20 bg-neutral-900 text-white"
            />
            <span>Teleport camera into the new world immediately</span>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-xl bg-neutral-900 border border-white/20 text-[11px] text-neutral-200">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/10 bg-neutral-950">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-full text-xs text-neutral-400 hover:text-white cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || worlds.length >= 12}
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-neutral-950 hover:bg-neutral-200 disabled:opacity-40 text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {submitting ? 'Creating...' : 'Create World'}
          </button>
        </div>
      </div>
    </div>
  );
}
