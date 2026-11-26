import React, { useState } from 'react';
import {
  CheckCircle2,
  Compass,
  Hammer,
  HelpCircle,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import type { FloatingWorldId, NpcState, TeleportGateState } from '../types/world';

interface GateModalProps {
  open: boolean;
  onClose: () => void;
  worldId: FloatingWorldId | string;
  gate: TeleportGateState;
  selectedAgent: NpcState;
  onDecipher: (rune: 'anchor' | 'conduit' | 'core', answer: string) => Promise<{ correct: boolean; feedback: string }>;
  onStudyWithNpc: () => Promise<string | null>;
  onBuildGate: (mode: 'place' | 'npc') => Promise<string | null>;
  onEnterPortal: () => Promise<void>;
}

const RUNES: Array<{
  key: 'anchor' | 'conduit' | 'core';
  title: string;
  riddle: string;
  options: Array<{ id: string; label: string }>;
}> = [
  {
    key: 'anchor',
    title: 'Rune I · Pillar Foundation',
    riddle: 'What dense dark volcanic rock from the deepest island crust anchors portal gravity?',
    options: [
      { id: 'granite', label: 'Granite' },
      { id: 'obsidian', label: 'Obsidian' },
      { id: 'sandstone', label: 'Sandstone' },
      { id: 'brick', label: 'Clay Brick' },
    ],
  },
  {
    key: 'conduit',
    title: 'Rune II · Arch Columns & Conduits',
    riddle: 'What glowing sea-blue gem channels portal light atop White Marble columns?',
    options: [
      { id: 'iron_ore', label: 'Iron Ore' },
      { id: 'coal', label: 'Coal' },
      { id: 'crystal', label: 'Crystal' },
      { id: 'clay', label: 'River Clay' },
    ],
  },
  {
    key: 'core',
    title: 'Rune III · Keystone Core',
    riddle: 'What radiant amber stone crafted from Crystal + Gold Ore crowns the arch?',
    options: [
      { id: 'copper_ingot', label: 'Copper' },
      { id: 'wood_plank', label: 'Oak Plank' },
      { id: 'sunstone', label: 'Sunstone' },
      { id: 'glass_pane', label: 'Azure Glass' },
    ],
  },
];

const GATE_COSTS: Array<{ key: string; label: string; total: number; hint: string }> = [
  { key: 'obsidian', label: 'Obsidian', total: 2, hint: 'Gather from dark outcrops' },
  { key: 'marble', label: 'White Marble', total: 2, hint: 'Gather from pale stone outcrops' },
  { key: 'crystal', label: 'Crystal', total: 2, hint: 'Gather from glowing crystal veins' },
  { key: 'sunstone', label: 'Sunstone Core', total: 1, hint: 'Craft: Crystal + Gold Ore' },
];

export const GateModal: React.FC<GateModalProps> = ({
  open,
  onClose,
  worldId,
  gate,
  selectedAgent,
  onDecipher,
  onStudyWithNpc,
  onBuildGate,
  onEnterPortal,
}) => {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!open) return null;

  const solvedCount = (['anchor', 'conduit', 'core'] as const).filter((k) => gate.clues[k]).length;

  const handleGuess = async (rune: 'anchor' | 'conduit' | 'core', answer: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await onDecipher(rune, answer);
      setNotice(res.feedback);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to test rune');
    } finally {
      setBusy(false);
    }
  };

  const handleStudy = async () => {
    setBusy(true);
    setNotice(null);
    const msg = await onStudyWithNpc();
    if (msg) setNotice(msg);
    setBusy(false);
  };

  const handleBuild = async (mode: 'place' | 'npc') => {
    setBusy(true);
    setNotice(null);
    const msg = await onBuildGate(mode);
    if (msg) setNotice(msg);
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-2xl border border-white/12 bg-neutral-950/95 text-neutral-100 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              {gate.unlocked ? (
                <Sparkles className="h-4 w-4 text-white" />
              ) : (
                <Lock className="h-4 w-4 text-neutral-300" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium tracking-tight text-white">Sky Teleport Gate</h2>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-neutral-300">
                  {gate.unlocked ? 'Portal Active' : `${gate.built_count}/${gate.total_count} Built`}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                {gate.unlocked
                  ? 'Rift stabilized between Homestead Island & Sky Market'
                  : 'Decipher the ancient plinth runes at West Clearing (10, 11, 15) to build the portal'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label="Close gate modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto hud-scroll p-5 space-y-4">
          {notice && (
            <div className="rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-xs text-neutral-200">
              {notice}
            </div>
          )}

          {gate.unlocked ? (
            <div className="rounded-2xl border border-white/15 bg-neutral-900/75 p-4 text-center space-y-3">
              <Sparkles className="h-6 w-6 text-white mx-auto" />
              <div>
                <h3 className="text-sm font-medium text-white">Sky Portal Synchronized</h3>
                <p className="mt-1 text-xs text-neutral-400">
                  The Obsidian-Marble arch and Sunstone core now bridge Homestead Island and the Sky Market bazaar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onEnterPortal()}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-neutral-200 cursor-pointer"
              >
                <Compass className="h-4 w-4" />
                {worldId === 'market' ? 'Return to Homestead Island' : 'Enter Portal → Sky Market'}
              </button>
            </div>
          ) : (
            <>
              {/* Step 1: Decipher Runes */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5 text-neutral-300" />
                    <span className="text-xs font-medium text-white">
                      Step 1 · Figure Out the Schematic ({solvedCount}/3 Runes)
                    </span>
                  </div>
                  {!gate.discovered && worldId === 'homestead' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleStudy()}
                      className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-neutral-200 hover:bg-white/10 disabled:opacity-45 cursor-pointer"
                    >
                      Send {selectedAgent.name} to Study Ruins
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {RUNES.map((r) => {
                    const solved = gate.clues[r.key];
                    return (
                      <div
                        key={r.key}
                        className={`rounded-xl border p-3 ${
                          solved
                            ? 'border-white/15 bg-white/[0.04]'
                            : 'border-white/10 bg-neutral-900/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-white">{r.title}</span>
                          {solved ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-neutral-200">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Solved
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-neutral-500">Locked</span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-neutral-400">{r.riddle}</p>
                        {!solved && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {r.options.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={busy}
                                onClick={() => void handleGuess(r.key, opt.id)}
                                className="rounded-lg border border-white/10 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-200 transition hover:border-white/30 hover:bg-white hover:text-neutral-950 disabled:opacity-45 cursor-pointer"
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Assemble 7-block Gate */}
              <div className={`space-y-2.5 pt-2 border-t border-white/10 ${gate.discovered ? '' : 'opacity-50'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Hammer className="h-3.5 w-3.5 text-neutral-300" />
                    <span className="text-xs font-medium text-white">
                      Step 2 · Assemble the Gate Arch ({gate.built_count}/{gate.total_count})
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-neutral-400">{gate.progress}%</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {GATE_COSTS.map((c) => {
                    const remaining = gate.missing_items[c.key] ?? 0;
                    const done = c.total - remaining;
                    const carried = selectedAgent.inventory[c.key] ?? 0;
                    return (
                      <div
                        key={c.key}
                        className="rounded-xl border border-white/10 bg-neutral-900/60 px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{c.label}</div>
                          <div className="text-[10px] text-neutral-500 truncate">{c.hint}</div>
                        </div>
                        <div className="text-right shrink-0 font-mono text-[10px]">
                          <div className="text-neutral-200">
                            {done}/{c.total} built
                          </div>
                          <div className="text-neutral-500">Bag: {carried}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {gate.discovered && worldId === 'homestead' && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleBuild('npc')}
                      className="rounded-xl border border-white/15 bg-neutral-900 px-3.5 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-45 cursor-pointer"
                    >
                      Gather & Build with {selectedAgent.name}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleBuild('place')}
                      className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-45 cursor-pointer"
                    >
                      {gate.next_material
                        ? `Assemble Next (${gate.next_material.replace(/_/g, ' ')})`
                        : 'Assemble Gate Block'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
