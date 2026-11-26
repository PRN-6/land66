import { Box, User, X } from 'lucide-react';
import { BLOCK_LABELS, BlockId, type InspectTarget, type WorldStateSnapshot } from '../types/world';

interface InspectToastProps {
  target: InspectTarget | null;
  state: WorldStateSnapshot;
  onClose: () => void;
}

export function InspectToast({ target, state, onClose }: InspectToastProps) {
  if (!target) return null;

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-80 max-w-[calc(100vw-2rem)] p-3 rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-slate-700/80 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
            {target.kind === 'npc' ? <User className="w-4 h-4" /> : <Box className="w-4 h-4" />}
          </div>
          <div>
            {target.kind === 'npc' ? (
              <>
                <div className="text-xs font-bold text-white">{state.npc.name} (AI Resident)</div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Action: {state.npc.current_action}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-bold text-white">
                  {BLOCK_LABELS[target.block] ?? `Block #${target.block}`}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Coords ({target.x}, {target.y}, {target.z}) · ID {target.block}
                </div>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {target.kind === 'block' && target.block === BlockId.CROP_WHEAT && (
        <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-emerald-300 flex justify-between">
          <span>Growth Stage:</span>
          <span className="font-mono font-semibold">
            {target.meta + 1} / 4 {target.meta >= 3 ? '(Ripe!)' : '(Growing)'}
          </span>
        </div>
      )}

      {target.kind === 'block' && target.block === BlockId.FARMLAND && (
        <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-sky-300 flex justify-between">
          <span>Soil Moisture:</span>
          <span className="font-mono font-semibold">
            {target.meta > 0 ? 'Watered (Moist)' : 'Dry Soil'}
          </span>
        </div>
      )}

      {target.kind === 'npc' && (
        <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-300 italic line-clamp-2">
          “{state.npc.thought}”
        </div>
      )}
    </div>
  );
}
