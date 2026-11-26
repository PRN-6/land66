import type { NpcState } from '../types/world';

interface NpcThoughtOverlayProps {
  pos: { x: number; y: number; visible: boolean };
  agent: NpcState;
  enabled: boolean;
}

export function NpcThoughtOverlay({ pos, agent, enabled }: NpcThoughtOverlayProps) {
  if (!enabled || !pos.visible) return null;

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full transition-opacity duration-150"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      <div className="max-w-52 px-2.5 py-1.5 rounded-xl bg-neutral-950/80 backdrop-blur-md border border-white/10 shadow-xl text-center">
        <div className="text-[10px] font-medium text-neutral-400">
          {agent.name} · <span className="font-mono text-neutral-200">{agent.current_action}</span>
        </div>
        <div className="text-[11px] text-neutral-100 leading-snug line-clamp-2 mt-0.5">
          {agent.thought}
        </div>
      </div>
    </div>
  );
}
