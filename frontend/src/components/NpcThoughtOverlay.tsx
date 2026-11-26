import type { WorldStateSnapshot } from '../types/world';

interface NpcThoughtOverlayProps {
  pos: { x: number; y: number; visible: boolean };
  state: WorldStateSnapshot;
  enabled: boolean;
}

export function NpcThoughtOverlay({ pos, state, enabled }: NpcThoughtOverlayProps) {
  if (!enabled || !pos.visible) return null;

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full transition-opacity duration-150"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      <div className="max-w-56 px-2.5 py-1.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-slate-700/80 shadow-xl text-center">
        <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold text-cyan-300">
          <span>{state.npc.name}</span>
          <span className="text-slate-500">·</span>
          <span className="font-mono text-emerald-300">{state.npc.current_action}</span>
        </div>
        <div className="text-[11px] text-slate-100 leading-snug line-clamp-2 mt-0.5">
          {state.npc.thought}
        </div>
      </div>
      <div className="w-2 h-2 bg-slate-950/80 border-r border-b border-slate-700/80 rotate-45 mx-auto -mt-1" />
    </div>
  );
}
