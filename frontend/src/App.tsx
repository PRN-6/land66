import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VoxelWorldScene } from './engine/VoxelWorldScene';
import { backendApi } from './services/api';
import { OfflineDemoSimulator } from './services/offlineDemo';
import { WorldWsClient } from './services/wsClient';
import type {
  AgentRole,
  CameraMode,
  ConnectionMode,
  GodTool,
  InspectTarget,
  LlmTrace,
  NpcState,
  SimSpeed,
  WorldStateSnapshot,
} from './types/world';
import { TopBar } from './components/TopBar';
import { AgentBar } from './components/AgentBar';
import { GodDock } from './components/GodDock';
import { InspectorDrawer } from './components/InspectorDrawer';
import { LlmModal } from './components/LlmModal';
import { InspectToast } from './components/InspectToast';
import { NpcThoughtOverlay } from './components/NpcThoughtOverlay';

const demoSim = new OfflineDemoSimulator(6601);

export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<VoxelWorldScene | null>(null);
  const wsClientRef = useRef<WorldWsClient | null>(null);

  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('connecting');
  const connectionModeRef = useRef<ConnectionMode>('connecting');
  const setConnMode = useCallback((mode: ConnectionMode) => {
    connectionModeRef.current = mode;
    setConnectionMode(mode);
  }, []);

  const [worldState, setWorldState] = useState<WorldStateSnapshot>(() => demoSim.getState());
  const [selectedAgentId, setSelectedAgentId] = useState('aiden');
  const [traces, setTraces] = useState<LlmTrace[]>([]);
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [showThoughtBubble, setShowThoughtBubble] = useState(true);
  const [showPath, setShowPath] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [dockTray, setDockTray] = useState<'objects' | 'life' | 'world' | null>(null);
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const [llmAgentId, setLlmAgentId] = useState('aiden');
  const [activeTool, setActiveTool] = useState<GodTool>({ mode: 'inspect' });
  const activeToolRef = useRef<GodTool>({ mode: 'inspect' });
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const [npcScreenPos, setNpcScreenPos] = useState({ x: 0, y: 0, visible: false });
  const [bannerError, setBannerError] = useState<string | null>(null);

  const agents = useMemo<NpcState[]>(() => {
    if (worldState.agents && worldState.agents.length > 0) {
      return worldState.agents;
    }
    return [
      {
        ...worldState.npc,
        id: worldState.npc.id ?? 'aiden',
        role: worldState.npc.role ?? 'pioneer',
        llm_status: worldState.npc.llm_status ?? worldState.llm_status,
      },
    ];
  }, [worldState]);

  const selectedAgent = useMemo<NpcState>(() => {
    return (
      agents.find((a, i) => (a.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`)) === selectedAgentId) ??
      agents[0]
    );
  }, [agents, selectedAgentId]);

  const notifyError = useCallback((msg: string) => {
    setBannerError(msg);
    window.setTimeout(() => {
      setBannerError((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  const handleSelectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    sceneRef.current?.setSelectedAgent(agentId);
  }, []);

  const handleOpenBrainForAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setLlmAgentId(agentId);
    sceneRef.current?.setSelectedAgent(agentId);
    setLlmModalOpen(true);
  }, []);

  const handleSelectTool = useCallback((tool: GodTool) => {
    activeToolRef.current = tool;
    setActiveTool(tool);
    sceneRef.current?.setGodTool(tool);
    if (tool.mode !== 'inspect') {
      setInspectTarget(null);
    }
  }, []);

  const handleCreateAgent = useCallback(
    async (payload: { name?: string; role?: AgentRole; x?: number; y?: number; z?: number }) => {
      if (connectionModeRef.current === 'live') {
        try {
          const created = await backendApi.createAgent(payload);
          const newId = created.id ?? 'aiden';
          setSelectedAgentId(newId);
          sceneRef.current?.setSelectedAgent(newId);
        } catch (err) {
          notifyError(err instanceof Error ? err.message : 'Failed to create NPC');
        }
      } else {
        const created = demoSim.addAgent(payload);
        const next = demoSim.getState();
        sceneRef.current?.applyTickUpdate([], next);
        setWorldState(next);
        if (created.id) {
          setSelectedAgentId(created.id);
          sceneRef.current?.setSelectedAgent(created.id);
        }
      }
    },
    [notifyError],
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      if (agentId === 'aiden') return;
      if (connectionModeRef.current === 'live') {
        try {
          await backendApi.deleteAgent(agentId);
        } catch (err) {
          notifyError(err instanceof Error ? err.message : 'Failed to remove NPC');
          return;
        }
      } else {
        demoSim.removeAgent(agentId);
        const next = demoSim.getState();
        sceneRef.current?.applyTickUpdate([], next);
        setWorldState(next);
      }
      if (selectedAgentId === agentId) {
        setSelectedAgentId('aiden');
        sceneRef.current?.setSelectedAgent('aiden');
      }
      if (llmAgentId === agentId) {
        setLlmAgentId('aiden');
      }
    },
    [llmAgentId, notifyError, selectedAgentId],
  );

  const handleGodIntervene = useCallback(
    async (
      action:
        | 'set_time'
        | 'set_weather'
        | 'whisper'
        | 'spawn_tree'
        | 'drop_gift'
        | 'heal_npc'
        | 'spawn_object'
        | 'remove_block'
        | 'spawn_entity'
        | 'clear_entities',
      value?: unknown,
      agentId?: string,
    ) => {
      if (connectionModeRef.current === 'live') {
        try {
          await backendApi.godIntervene({ action, value, agent_id: agentId });
        } catch (err) {
          notifyError(err instanceof Error ? err.message : 'Action failed');
        }
      } else {
        const updates = demoSim.handleGodIntervene(action, value, agentId);
        const next = demoSim.getState();
        sceneRef.current?.applyTickUpdate(updates, next);
        setWorldState(next);
      }
    },
    [notifyError],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeToolRef.current.mode !== 'inspect') {
        handleSelectTool({ mode: 'inspect' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSelectTool]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const scene = new VoxelWorldScene(el, {
      onSelectTarget: (t) => {
        setInspectTarget(t);
        if (t?.kind === 'npc' && t.agentId) {
          setSelectedAgentId(t.agentId);
          scene.setSelectedAgent(t.agentId);
        }
      },
      onPlaceAt: (placeCoord, hitCoord) => {
        const tool = activeToolRef.current;
        if (tool.mode === 'erase') {
          void handleGodIntervene('remove_block', hitCoord);
        } else if (tool.mode === 'object') {
          void handleGodIntervene('spawn_object', {
            object: tool.object,
            x: placeCoord.x,
            y: placeCoord.y,
            z: placeCoord.z,
          });
        } else if (tool.mode === 'entity') {
          void handleGodIntervene('spawn_entity', {
            kind: tool.kind,
            name: tool.customName,
            x: placeCoord.x,
            y: placeCoord.y,
            z: placeCoord.z,
          });
        } else if (tool.mode === 'agent') {
          void handleCreateAgent({
            name: tool.customName,
            role: tool.role,
            x: placeCoord.x,
            y: placeCoord.y,
            z: placeCoord.z,
          });
          handleSelectTool({ mode: 'inspect' });
        }
      },
      onNpcScreenPos: (pos) => setNpcScreenPos(pos),
    });
    scene.setShowPath(false);
    sceneRef.current = scene;

    const init = demoSim.getInitMessage();
    scene.applyWorldInit(init);
    setWorldState(init.state);

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [handleCreateAgent, handleGodIntervene, handleSelectTool]);

  useEffect(() => {
    const client = new WorldWsClient({
      onOpen: () => setConnMode('live'),
      onMessage: (msg) => {
        if (msg.type === 'world_init') {
          setConnMode('live');
          sceneRef.current?.applyWorldInit(msg);
          setWorldState(msg.state);
          setSelectedAgentId('aiden');
          sceneRef.current?.setSelectedAgent('aiden');
        } else if (msg.type === 'tick_update') {
          if (connectionModeRef.current !== 'live') setConnMode('live');
          sceneRef.current?.applyTickUpdate(msg.block_updates, msg.state);
          setWorldState(msg.state);
        } else if (msg.type === 'llm_trace') {
          setTraces((prev) => [msg.trace, ...prev].slice(0, 50));
        }
      },
      onDisconnect: (attempt) => {
        if (connectionModeRef.current === 'offline_demo') return;
        setConnMode(attempt >= 2 ? 'offline_demo' : 'reconnecting');
      },
    });
    wsClientRef.current = client;
    client.connect();

    const fallbackTimer = window.setTimeout(() => {
      if (connectionModeRef.current === 'connecting') {
        setConnMode('offline_demo');
      }
    }, 1500);

    return () => {
      window.clearTimeout(fallbackTimer);
      client.disconnect();
      wsClientRef.current = null;
    };
  }, [setConnMode]);

  useEffect(() => {
    if (connectionMode !== 'offline_demo') return;
    const interval = window.setInterval(() => {
      const res = demoSim.step(0.15);
      sceneRef.current?.applyTickUpdate(res.blockUpdates, res.state);
      setWorldState(res.state);
      if (res.trace) {
        setTraces((prev) => [res.trace!, ...prev].slice(0, 50));
      }
    }, 150);
    return () => window.clearInterval(interval);
  }, [connectionMode]);

  const handleControl = useCallback(
    async (action: 'pause' | 'resume' | 'step' | 'set_speed' | 'reset', speed?: SimSpeed, seed?: number) => {
      if (connectionModeRef.current === 'live') {
        try {
          await backendApi.simControl({ action, speed, seed });
        } catch (err) {
          notifyError(err instanceof Error ? err.message : 'Control failed');
        }
      } else {
        const resetInit = demoSim.handleControl(action, speed, seed);
        if (resetInit) {
          sceneRef.current?.applyWorldInit(resetInit);
          setWorldState(resetInit.state);
          setSelectedAgentId('aiden');
          sceneRef.current?.setSelectedAgent('aiden');
        } else {
          const next = demoSim.getState();
          sceneRef.current?.applyTickUpdate([], next);
          setWorldState(next);
        }
      }
    },
    [notifyError],
  );

  const handleCameraMode = useCallback((mode: CameraMode) => {
    setCameraMode(mode);
    sceneRef.current?.setCameraMode(mode);
  }, []);

  const handleTogglePath = useCallback(() => {
    setShowPath((prev) => {
      const next = !prev;
      sceneRef.current?.setShowPath(next);
      return next;
    });
  }, []);

  const handleToggleOfflineDemo = useCallback(() => {
    if (connectionModeRef.current === 'offline_demo') {
      setConnMode('connecting');
      wsClientRef.current?.reconnectNow();
    } else {
      setConnMode('offline_demo');
    }
  }, [setConnMode]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-neutral-950">
      <div ref={viewportRef} className="absolute inset-0 w-full h-full" />

      <NpcThoughtOverlay
        pos={npcScreenPos}
        agent={selectedAgent}
        enabled={showThoughtBubble && cameraMode !== 'pov'}
      />

      <div className="pointer-events-none relative z-20 flex flex-col w-full h-full">
        <TopBar
          state={worldState}
          connectionMode={connectionMode}
          cameraMode={cameraMode}
          showThoughtBubble={showThoughtBubble}
          showPath={showPath}
          inspectorOpen={inspectorOpen}
          onControl={handleControl}
          onCameraMode={handleCameraMode}
          onToggleThoughtBubble={() => setShowThoughtBubble((v) => !v)}
          onTogglePath={handleTogglePath}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
          onOpenLlmModal={() => {
            setLlmAgentId(selectedAgentId);
            setLlmModalOpen(true);
          }}
          onToggleOfflineDemo={handleToggleOfflineDemo}
        />

        {bannerError && (
          <div className="pointer-events-auto mx-auto mt-2 px-3 py-1 rounded-full bg-neutral-950/90 border border-white/15 text-[11px] text-neutral-200 shadow-lg">
            {bannerError}
          </div>
        )}
      </div>

      {/* Multi-NPC Roster & Quick Switcher */}
      <AgentBar
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        onOpenBrainForAgent={handleOpenBrainForAgent}
        onQuickAddAgent={() => setDockTray('life')}
      />

      <InspectorDrawer
        state={worldState}
        agents={agents}
        selectedAgentId={selectedAgentId}
        open={inspectorOpen}
        onSelectAgent={handleSelectAgent}
        onOpenBrainForAgent={handleOpenBrainForAgent}
        onDeleteAgent={handleDeleteAgent}
      />

      <GodDock
        state={worldState}
        agents={agents}
        selectedAgentId={selectedAgentId}
        activeTool={activeTool}
        tray={dockTray}
        onSetTray={setDockTray}
        onSelectTool={handleSelectTool}
        onSelectAgent={handleSelectAgent}
        onOpenBrainForAgent={handleOpenBrainForAgent}
        onCreateAgent={handleCreateAgent}
        onDeleteAgent={handleDeleteAgent}
        onGodIntervene={handleGodIntervene}
      />

      <InspectToast
        target={inspectTarget}
        state={worldState}
        agents={agents}
        onClose={() => setInspectTarget(null)}
      />

      <LlmModal
        open={llmModalOpen}
        connectionMode={connectionMode}
        agents={agents}
        activeAgentId={llmAgentId}
        traces={traces}
        onSelectAgentId={setLlmAgentId}
        onClose={() => setLlmModalOpen(false)}
        onTracesUpdated={setTraces}
      />
    </div>
  );
}

export default App;
