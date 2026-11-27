import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VoxelWorldScene } from './engine/VoxelWorldScene';
import { backendApi } from './services/api';
import { OfflineDemoSimulator, offlineSaveStore } from './services/offlineDemo';
import { WorldWsClient } from './services/wsClient';
import type {
  AgentRole,
  CameraMode,
  ConnectionMode,
  FloatingWorldId,
  GodTool,
  InspectTarget,
  LlmTrace,
  MarketCatalogPayload,
  NpcState,
  SaveSlotSummary,
  SimSpeed,
  WorldPresetId,
  WorldSavePayload,
  WorldStateSnapshot,
} from './types/world';
import { TopBar } from './components/TopBar';
import { AgentBar } from './components/AgentBar';
import { GodDock } from './components/GodDock';
import { InspectorDrawer } from './components/InspectorDrawer';
import { LlmModal } from './components/LlmModal';
import { SaveModal } from './components/SaveModal';
import { ShopModal } from './components/ShopModal';
import { GateModal } from './components/GateModal';
import { CreateWorldModal } from './components/CreateWorldModal';
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
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [gateModalOpen, setGateModalOpen] = useState(false);
  const [createWorldModalOpen, setCreateWorldModalOpen] = useState(false);
  const [marketCatalog, setMarketCatalog] = useState<MarketCatalogPayload | null>(null);
  const [saveSlots, setSaveSlots] = useState<SaveSlotSummary[]>([]);
  const [savesLoading, setSavesLoading] = useState(false);
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
            ...(tool.material ? { material: tool.material } : {}),
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
    const flushDemoSave = () => {
      demoSim.saveAutosave();
    };
    window.addEventListener('pagehide', flushDemoSave);
    window.addEventListener('beforeunload', flushDemoSave);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', flushDemoSave);
      window.removeEventListener('beforeunload', flushDemoSave);
      demoSim.saveAutosave();
    };
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

  const refreshSaveSlots = useCallback(async () => {
    setSavesLoading(true);
    try {
      if (connectionModeRef.current === 'live') {
        const res = await backendApi.listSaves();
        setSaveSlots(res.saves);
      } else {
        setSaveSlots(offlineSaveStore.list());
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to list saves');
    } finally {
      setSavesLoading(false);
    }
  }, [notifyError]);

  const handleOpenSavesModal = useCallback(() => {
    setSaveModalOpen(true);
    void refreshSaveSlots();
  }, [refreshSaveSlots]);

  const handleCreateSaveSlot = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        if (connectionModeRef.current === 'live') {
          await backendApi.createSaveSlot(name);
        } else {
          offlineSaveStore.save(name, demoSim.exportSave(name));
        }
        await refreshSaveSlots();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to save checkpoint';
      }
    },
    [refreshSaveSlots],
  );

  const handleLoadSaveSlot = useCallback(async (slot: string): Promise<string | null> => {
    try {
      if (connectionModeRef.current === 'live') {
        await backendApi.loadSaveSlot(slot);
      } else {
        const payload = offlineSaveStore.load(slot);
        const init = demoSim.loadSave(payload);
        sceneRef.current?.applyWorldInit(init);
        setWorldState(init.state);
        setSelectedAgentId('aiden');
        sceneRef.current?.setSelectedAgent('aiden');
      }
      setInspectTarget(null);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Failed to load checkpoint';
    }
  }, []);

  const handleDeleteSaveSlot = useCallback(
    async (slot: string): Promise<string | null> => {
      try {
        if (connectionModeRef.current === 'live') {
          await backendApi.deleteSaveSlot(slot);
        } else {
          offlineSaveStore.remove(slot);
        }
        await refreshSaveSlots();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to delete checkpoint';
      }
    },
    [refreshSaveSlots],
  );

  const handleDownloadSaveFile = useCallback(async (): Promise<string | null> => {
    try {
      const payload =
        connectionModeRef.current === 'live'
          ? await backendApi.downloadSave()
          : demoSim.exportSave();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `land66-day${Math.floor(payload.elapsed / 360) + 1}-save.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Failed to export save file';
    }
  }, []);

  const handleUploadSaveFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as WorldSavePayload;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.world?.blocks)) {
        return 'Invalid save file: missing world terrain data.';
      }
      if (connectionModeRef.current === 'live') {
        await backendApi.loadSave(parsed);
      } else {
        const init = demoSim.loadSave(parsed);
        sceneRef.current?.applyWorldInit(init);
        setWorldState(init.state);
        setSelectedAgentId('aiden');
        sceneRef.current?.setSelectedAgent('aiden');
      }
      setInspectTarget(null);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Failed to import save file';
    }
  }, []);

  const handleSwitchWorld = useCallback(
    async (world: FloatingWorldId) => {
      try {
        if (connectionModeRef.current === 'live') {
          await backendApi.switchWorld(world);
        } else {
          const init = demoSim.switchWorld(world);
          sceneRef.current?.applyWorldInit(init);
          setWorldState(init.state);
          setSelectedAgentId('aiden');
          sceneRef.current?.setSelectedAgent('aiden');
        }
        setInspectTarget(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to switch world';
        notifyError(msg);
      }
    },
    [notifyError],
  );

  const handleCreateWorld = useCallback(
    async (payload: {
      name?: string;
      preset: WorldPresetId;
      seed?: number;
      starter_name?: string;
      starter_role: AgentRole;
      switch: boolean;
    }): Promise<string | null> => {
      try {
        if (connectionModeRef.current === 'live') {
          const res = await backendApi.createWorld(payload);
          setWorldState(res.state);
        } else {
          const init = demoSim.createWorld(payload);
          if (init) {
            sceneRef.current?.applyWorldInit(init);
            setWorldState(init.state);
            setSelectedAgentId('aiden');
            sceneRef.current?.setSelectedAgent('aiden');
          } else {
            const next = demoSim.getState();
            sceneRef.current?.applyTickUpdate([], next);
            setWorldState(next);
          }
        }
        setInspectTarget(null);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to create floating world';
      }
    },
    [],
  );

  const handleDeleteWorld = useCallback(
    async (worldId: string): Promise<string | null> => {
      try {
        if (connectionModeRef.current === 'live') {
          const res = await backendApi.deleteWorld(worldId);
          setWorldState(res.state);
        } else {
          const init = demoSim.deleteWorld(worldId);
          if (init) {
            sceneRef.current?.applyWorldInit(init);
            setWorldState(init.state);
            setSelectedAgentId('aiden');
            sceneRef.current?.setSelectedAgent('aiden');
          } else {
            const next = demoSim.getState();
            sceneRef.current?.applyTickUpdate([], next);
            setWorldState(next);
          }
        }
        setInspectTarget(null);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to delete floating world';
      }
    },
    [],
  );

  const handleGateDecipher = useCallback(
    async (rune: 'anchor' | 'conduit' | 'core', answer: string) => {
      if (connectionModeRef.current === 'live') {
        const res = await backendApi.gateDecipher(rune, answer);
        setWorldState(res.state);
        return { correct: res.correct, feedback: res.feedback };
      }
      const res = demoSim.decipherGateRune(rune, answer);
      const next = demoSim.getState();
      sceneRef.current?.applyTickUpdate([], next);
      setWorldState(next);
      return res;
    },
    [],
  );

  const handleGateStudy = useCallback(async (): Promise<string | null> => {
    try {
      if (connectionModeRef.current === 'live') {
        const res = await backendApi.gateStudy(selectedAgentId);
        setWorldState(res.state);
        return res.message;
      }
      const msg = demoSim.studyGateWithNpc(selectedAgentId);
      const next = demoSim.getState();
      sceneRef.current?.applyTickUpdate([], next);
      setWorldState(next);
      return msg;
    } catch (err) {
      return err instanceof Error ? err.message : 'Failed to study ruins';
    }
  }, [selectedAgentId]);

  const handleGateBuild = useCallback(
    async (mode: 'place' | 'npc'): Promise<string | null> => {
      try {
        if (connectionModeRef.current === 'live') {
          const res = await backendApi.gateBuild(mode, selectedAgentId);
          setWorldState(res.state);
          return res.message;
        }
        const { updates, message } = demoSim.buildGate(mode, selectedAgentId);
        const next = demoSim.getState();
        sceneRef.current?.applyTickUpdate(updates, next);
        setWorldState(next);
        return message;
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to build gate block';
      }
    },
    [selectedAgentId],
  );

  const handleOpenShopModal = useCallback(async () => {
    setShopModalOpen(true);
    try {
      const cat =
        connectionModeRef.current === 'live'
          ? await backendApi.getMarketCatalog()
          : demoSim.getMarketCatalog();
      setMarketCatalog(cat);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to load market catalog');
    }
  }, [notifyError]);

  const handleMarketBuy = useCallback(
    async (itemId: string, quantity: number): Promise<string | null> => {
      try {
        if (connectionModeRef.current === 'live') {
          const res = await backendApi.marketBuy(itemId, quantity, selectedAgentId);
          setWorldState(res.state);
        } else {
          demoSim.marketBuy(itemId, quantity, selectedAgentId);
          const next = demoSim.getState();
          sceneRef.current?.applyTickUpdate([], next);
          setWorldState(next);
        }
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Purchase failed';
      }
    },
    [selectedAgentId],
  );

  const handleMarketSell = useCallback(
    async (item: string, quantity: number): Promise<string | null> => {
      try {
        if (connectionModeRef.current === 'live') {
          const res = await backendApi.marketSell(item, quantity, selectedAgentId);
          setWorldState(res.state);
        } else {
          demoSim.marketSell(item, quantity, selectedAgentId);
          const next = demoSim.getState();
          sceneRef.current?.applyTickUpdate([], next);
          setWorldState(next);
        }
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Sale failed';
      }
    },
    [selectedAgentId],
  );

  const handleNpcAction = useCallback(
    async (action: string, params?: Record<string, unknown>, agentId?: string) => {
      try {
        if (connectionModeRef.current === 'live') {
          const res = await backendApi.npcAction(action, params, agentId ?? selectedAgentId);
          setWorldState(res.state);
        } else {
          demoSim.npcAction(action, params, agentId ?? selectedAgentId);
          const next = demoSim.getState();
          sceneRef.current?.applyTickUpdate([], next);
          setWorldState(next);
        }
      } catch (err) {
        notifyError(err instanceof Error ? err.message : 'Action failed');
      }
    },
    [notifyError, selectedAgentId],
  );

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
          onSwitchWorld={handleSwitchWorld}
          onOpenCreateWorldModal={() => setCreateWorldModalOpen(true)}
          onCameraMode={handleCameraMode}
          onToggleThoughtBubble={() => setShowThoughtBubble((v) => !v)}
          onTogglePath={handleTogglePath}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
          onOpenGateModal={() => setGateModalOpen(true)}
          onOpenShopModal={handleOpenShopModal}
          onOpenSavesModal={handleOpenSavesModal}
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
        onNpcAction={handleNpcAction}
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
        onSwitchWorld={handleSwitchWorld}
        onOpenCreateWorldModal={() => setCreateWorldModalOpen(true)}
        onGodIntervene={handleGodIntervene}
      />

      <InspectToast
        target={inspectTarget}
        state={worldState}
        agents={agents}
        onClose={() => setInspectTarget(null)}
        onOpenShop={handleOpenShopModal}
        onOpenGate={() => setGateModalOpen(true)}
      />

      <GateModal
        open={gateModalOpen}
        onClose={() => setGateModalOpen(false)}
        worldId={worldState.world_id ?? 'homestead'}
        gate={
          worldState.gate ?? {
            discovered: false,
            unlocked: false,
            progress: 0,
            clues: { anchor: false, conduit: false, core: false },
            built_count: 0,
            total_count: 7,
            missing_items: { obsidian: 2, marble: 2, crystal: 2, sunstone: 1 },
            next_material: null,
            next_surface: null,
            position: { x: 10, y: 11, z: 15 },
          }
        }
        selectedAgent={selectedAgent}
        onDecipher={handleGateDecipher}
        onStudyWithNpc={handleGateStudy}
        onBuildGate={handleGateBuild}
        onEnterPortal={async () => {
          setGateModalOpen(false);
          const nextWorld: FloatingWorldId = worldState.world_id === 'market' ? 'homestead' : 'market';
          await handleSwitchWorld(nextWorld);
        }}
      />

      <ShopModal
        open={shopModalOpen}
        onClose={() => setShopModalOpen(false)}
        worldId={worldState.world_id ?? 'homestead'}
        coins={worldState.coins ?? 250}
        selectedAgent={selectedAgent}
        catalog={marketCatalog}
        onTravelMarket={async () => {
          setShopModalOpen(false);
          await handleSwitchWorld('market');
        }}
        onBuy={handleMarketBuy}
        onSell={handleMarketSell}
      />

      <LlmModal
        open={llmModalOpen}
        connectionMode={connectionMode}
        agents={agents}
        activeAgentId={llmAgentId}
        traces={traces}
        onSelectAgentId={setLlmAgentId}
        onRetryConnection={() => {
          setConnMode('connecting');
          wsClientRef.current?.reconnectNow();
        }}
        onClose={() => setLlmModalOpen(false)}
        onTracesUpdated={setTraces}
      />

      <SaveModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        mode={connectionMode === 'live' ? 'live' : 'offline_demo'}
        currentDay={worldState.day}
        currentClock={worldState.clock_str}
        saves={saveSlots}
        loading={savesLoading}
        onRefresh={refreshSaveSlots}
        onCreateSlot={handleCreateSaveSlot}
        onLoadSlot={handleLoadSaveSlot}
        onDeleteSlot={handleDeleteSaveSlot}
        onDownloadFile={handleDownloadSaveFile}
        onUploadFile={handleUploadSaveFile}
      />

      <CreateWorldModal
        open={createWorldModalOpen}
        activeWorldId={worldState.world_id ?? 'homestead'}
        worlds={worldState.worlds ?? []}
        onClose={() => setCreateWorldModalOpen(false)}
        onCreateWorld={handleCreateWorld}
        onSwitchWorld={handleSwitchWorld}
        onDeleteWorld={handleDeleteWorld}
      />
    </div>
  );
}

export default App;
