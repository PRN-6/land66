import { Box, User, Users, X } from 'lucide-react';
import { getWorldMaterial } from '../engine/materialCatalog';
import {
  BLOCK_LABELS,
  BlockId,
  type InspectTarget,
  type NpcState,
  type WorldStateSnapshot,
} from '../types/world';

interface InspectToastProps {
  target: InspectTarget | null;
  state: WorldStateSnapshot;
  agents: NpcState[];
  onClose: () => void;
  onOpenShop?: () => void;
  onOpenGate?: () => void;
}

export function InspectToast({ target, state, agents, onClose, onOpenShop, onOpenGate }: InspectToastProps) {
  if (!target) return null;

  const targetNpc =
    target.kind === 'npc'
      ? (agents.find((a, idx) => (a.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`)) === (target.agentId ?? 'aiden')) ??
        state.npc)
      : null;

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
            {target.kind === 'npc' && targetNpc ? (
              <>
                <div className="text-xs font-semibold text-white">
                  {targetNpc.name}{' '}
                  <span className="text-neutral-400 font-normal capitalize">
                    ({targetNpc.role ?? 'pioneer'})
                  </span>
                </div>
                <div className="text-[11px] text-neutral-400 font-mono">{targetNpc.current_action}</div>
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
            ) : target.kind === 'block' ? (
              <>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>
                    {getWorldMaterial(target.material)?.label ?? BLOCK_LABELS[target.block] ?? `Block #${target.block}`}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-400 font-mono">
                  ({target.x}, {target.y}, {target.z})
                  {target.material ? ` · ${BLOCK_LABELS[target.block] ?? 'Block'}` : ''}
                </div>
              </>
            ) : null}
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-neutral-500 hover:text-white cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {target.kind === 'block' && target.material && (() => {
        const m = getWorldMaterial(target.material);
        return m ? (
          <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-neutral-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full border border-white/20 shrink-0"
                style={{ backgroundColor: m.colorCss }}
              />
              <span>{m.group} Material</span>
            </span>
            <span className="font-mono capitalize text-neutral-400">{m.finish}</span>
          </div>
        ) : null;
      })()}

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

      {target.kind === 'npc' && targetNpc && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-neutral-300 line-clamp-2">
          “{targetNpc.thought}”
        </div>
      )}

      {onOpenShop &&
        state.world_id === 'market' &&
        ((target.kind === 'entity' && target.entity.kind === 'villager') ||
          (target.kind === 'block' &&
            (target.block === BlockId.CHEST ||
              target.block === BlockId.CRAFTING_BENCH ||
              target.block === BlockId.COBBLESTONE))) && (
          <button
            type="button"
            onClick={onOpenShop}
            className="mt-2.5 w-full rounded-xl bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-950 transition hover:bg-neutral-200 cursor-pointer"
          >
            Open Market Shop
          </button>
        )}

      {onOpenGate &&
        target.kind === 'block' &&
        ((state.world_id !== 'market' &&
          target.x === 10 &&
          target.z >= 14 &&
          target.z <= 16 &&
          target.y >= 10 &&
          target.y <= 13) ||
          (state.world_id === 'market' &&
            target.z === 25 &&
            target.x >= 15 &&
            target.x <= 17 &&
            target.y >= 10 &&
            target.y <= 13)) && (
          <button
            type="button"
            onClick={onOpenGate}
            className="mt-2.5 w-full rounded-xl bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-950 transition hover:bg-neutral-200 cursor-pointer"
          >
            {state.gate?.unlocked ? 'Open Sky Teleport Gate' : 'Decipher & Build Teleport Gate'}
          </button>
        )}
    </div>
  );
}
