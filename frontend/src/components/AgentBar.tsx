import { Brain, Plus } from 'lucide-react';
import type { NpcState } from '../types/world';

interface AgentBarProps {
  agents: NpcState[];
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  onOpenBrainForAgent: (agentId: string) => void;
  onQuickAddAgent: () => void;
}

export function AgentBar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onOpenBrainForAgent,
  onQuickAddAgent,
}: AgentBarProps) {
  return (
    <div className="pointer-events-auto fixed top-16 left-3 z-20 flex flex-col gap-1 max-w-60">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-neutral-400">
        <span>NPCs ({agents.length})</span>
        <button
          onClick={onQuickAddAgent}
          title="Add AI NPC"
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-neutral-950/75 hover:bg-white hover:text-neutral-950 border border-white/10 text-[10px] text-neutral-300 transition cursor-pointer"
        >
          <Plus className="w-2.5 h-2.5" />
          <span>Add</span>
        </button>
      </div>

      {agents.map((ag, idx) => {
        const aid = ag.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`);
        const selected = aid === selectedAgentId;
        const brainLabel = ag.llm_status?.model || ag.llm_status?.provider || 'fallback';
        const thinking = Boolean(ag.llm_status?.thinking);

        return (
          <div
            key={aid}
            className={`flex items-center justify-between gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-xl backdrop-blur-xl border transition ${
              selected
                ? 'bg-white text-neutral-950 border-white shadow-lg'
                : 'bg-neutral-950/75 text-neutral-200 border-white/10 hover:border-white/25'
            }`}
          >
            <button
              onClick={() => onSelectAgent(aid)}
              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  thinking
                    ? selected
                      ? 'bg-neutral-950 animate-ping'
                      : 'bg-white animate-ping'
                    : selected
                      ? 'bg-neutral-950'
                      : 'bg-neutral-400'
                }`}
              />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold truncate leading-tight">
                  {ag.name}{' '}
                  <span className={`font-normal text-[10px] capitalize ${selected ? 'text-neutral-600' : 'text-neutral-500'}`}>
                    {ag.role ?? 'pioneer'}
                  </span>
                </div>
                <div className={`text-[10px] font-mono truncate ${selected ? 'text-neutral-600' : 'text-neutral-400'}`}>
                  {ag.current_action}
                </div>
              </div>
            </button>

            <button
              onClick={() => onOpenBrainForAgent(aid)}
              title={`Manage ${ag.name}'s Brain (${brainLabel})`}
              className={`p-1 rounded-lg transition cursor-pointer shrink-0 ${
                selected
                  ? 'hover:bg-neutral-200 text-neutral-800'
                  : 'hover:bg-white/10 text-neutral-400 hover:text-white'
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
