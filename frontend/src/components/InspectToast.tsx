import { Box, User, Users, X } from 'lucide-react';
import { BLOCK_LABELS, BlockId, type InspectTarget, type WorldStateSnapshot } from '../types/world';

interface InspectToastProps {
  target: InspectTarget | null;
  state: WorldStateSnapshot;
  onClose: () => void;
}

export function InspectToast({ target, state, onClose }: InspectToastProps) {
  if (!target) return null;

  return (
    <div className="pointer-events-auto fixed bottom-16 left-1/2 -translate-x-1/2 z-30 w-72 max-w-[calc(100vw-2rem)] p-3 rounded-2xl bg-neutral-950/88 backdrop-blur-xl border border-white/10 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-white/10 text-neutral-200">
            {target.kind === 'npc' ? (
              <User className="w-4 h-4" />
            ) : target.kind === 'entity' ? (
              <Users className="w-4 h-4" />
            ) : (
              <Box className="w-4 h-4" />
            )}
          </div>
          <div>
            {target.kind === 'npc' ? (
              <>
                <div className="text-xs font-semibold text-white">{state.npc.name}</div>
                <div className="text-[11px] text-neutral-400 font-mono">{state.npc.current_action}</div>
              </>
            ) : target.kind === 'entity' ? (
              <>
                <div className="text-xs font-semibold text-white">
                  {target.entity.name}{' '}
                  <span className="text-neutral-400 font-normal capitalize">({target.entity.kind})</span>
                </div>
                <div className="text-[11px] text-neutral-400 font-mono">
                  ({target.entity.grid_pos.x}, {target.entity.grid_pos.y}, {target.entity.grid_pos.z}) ·{' '}
                  {target.entity.animation}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-semibold text-white">
                  {BLOCK_LABELS[target.block] ?? `Block #${target.block}`}
                </div>
                <div className="text-[11px] text-neutral-400 font-mono">
                  ({target.x}, {target.y}, {target.z})
                </div>
              </>
            )}
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-neutral-500 hover:text-white cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {target.kind === 'block' && target.block === BlockId.CROP_WHEAT && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-neutral-300 flex justify-between">
          <span>Growth</span>
          <span className="font-mono">
            {target.meta + 1}/4 {target.meta >= 3 ? '(Ripe)' : ''}
          </span>
        </div>
      )}

      {target.kind === 'block' && target.block === BlockId.FARMLAND && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-neutral-300 flex justify-between">
          <span>Soil</span>
          <span className="font-mono">{target.meta > 0 ? 'Watered' : 'Dry'}</span>
        </div>
      )}

      {target.kind === 'npc' && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-neutral-300 line-clamp-2">
          “{state.npc.thought}”
        </div>
      )}
    </div>
  );
}
