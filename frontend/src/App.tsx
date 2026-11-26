import { useCallback, useEffect, useRef, useState } from 'react';
import { VoxelWorldScene } from './engine/VoxelWorldScene';
import { backendApi } from './services/api';
import { OfflineDemoSimulator } from './services/offlineDemo';
import { WorldWsClient } from './services/wsClient';
import type {
  CameraMode,
  ConnectionMode,
  InspectTarget,
  LlmTrace,
  SimSpeed,
  WorldStateSnapshot,
} from './types/world';
import { TopBar } from './components/TopBar';
import { LeftDrawer } from './components/LeftDrawer';
import { RightDrawer } from './components/RightDrawer';
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
  const [traces, setTraces] = useState<LlmTrace[]>([]);
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [showThoughtBubble, setShowThoughtBubble] = useState(true);
  const [showPath, setShowPath] = useState(true);
  const [panelsOpen, setPanelsOpen] = useState(true);
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const [npcScreenPos, setNpcScreenPos] = useState({ x: 0, y: 0, visible: false });
  const [bannerError, setBannerError] = useState<string | null>(null);

  const notifyError = useCallback((msg: string) => {
    setBannerError(msg);
    window.setTimeout(() => {
      setBannerError((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  // Initialize Three.js floating island scene
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const scene = new VoxelWorldScene(el, {
      onSelectTarget: (t) => setInspectTarget(t),
      onNpcScreenPos: (pos) => setNpcScreenPos(pos),
    });
    sceneRef.current = scene;

    // Seed initial visual immediately while live WebSocket connects
    const init = demoSim.getInitMessage();
    scene.applyWorldInit(init);
    setWorldState(init.state);

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Connect live WebSocket with fallback to Offline Demo if backend isn't running
  useEffect(() => {
    const client = new WorldWsClient({
      onOpen: () => {
        setConnMode('live');
      },
      onMessage: (msg) => {
        if (msg.type === 'world_init') {
          setConnMode('live');
          sceneRef.current?.applyWorldInit(msg);
          setWorldState(msg.state);
        } else if (msg.type === 'tick_update') {
          if (connectionModeRef.current !== 'live') {
            setConnMode('live');
          }
          sceneRef.current?.applyTickUpdate(msg.block_updates, msg.state);
          setWorldState(msg.state);
        } else if (msg.type === 'llm_trace') {
          setTraces((prev) => [msg.trace, ...prev].slice(0, 40));
        }
      },
      onDisconnect: (attempt) => {
        if (connectionModeRef.current === 'offline_demo') return;
        if (attempt >= 2) {
          setConnMode('offline_demo');
        } else {
          setConnMode('reconnecting');
        }
      },
    });
    wsClientRef.current = client;
    client.connect();

    // If backend isn't running on initial mount, switch smoothly to Offline Demo after 1.5s
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

  // Run Offline Demo tick loop only while in offline_demo mode
  useEffect(() => {
    if (connectionMode !== 'offline_demo') return;
    const interval = window.setInterval(() => {
      const res = demoSim.step(0.15);
      sceneRef.current?.applyTickUpdate(res.blockUpdates, res.state);
      setWorldState(res.state);
      if (res.trace) {
        setTraces((prev) => [res.trace!, ...prev].slice(0, 40));
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
          notifyError(err instanceof Error ? err.message : 'Simulation control failed');
        }
      } else {
        const resetInit = demoSim.handleControl(action, speed, seed);
        if (resetInit) {
          sceneRef.current?.applyWorldInit(resetInit);
          setWorldState(resetInit.state);
        } else {
          const next = demoSim.getState();
          sceneRef.current?.applyTickUpdate([], next);
          setWorldState(next);
        }
      }
    },
    [notifyError],
  );

  const handleGodIntervene = useCallback(
    async (
      action: 'set_time' | 'set_weather' | 'whisper' | 'spawn_tree' | 'drop_gift' | 'heal_npc',
      value?: unknown,
    ) => {
      if (connectionModeRef.current === 'live') {
        try {
          await backendApi.godIntervene({ action, value });
        } catch (err) {
          notifyError(err instanceof Error ? err.message : 'God intervention failed');
        }
      } else {
        const updates = demoSim.handleGodIntervene(action, value);
        const next = demoSim.getState();
        sceneRef.current?.applyTickUpdate(updates, next);
        setWorldState(next);
      }
    },
    [notifyError],
  );

  const handleCameraMode = useCallback((mode: CameraMode) => {
    setCameraMode(mode);
    sceneRef.current?.setCameraMode(mode);
  }, []);

  const handleFocusPreset = useCallback((preset: 'overview' | 'npc') => {
    setCameraMode(preset === 'overview' ? 'orbit' : 'follow');
    sceneRef.current?.focusPreset(preset);
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
    <div className="relative w-full h-full overflow-hidden bg-slate-950">
      {/* Full-bleed 3D Voxel Canvas */}
      <div ref={viewportRef} className="absolute inset-0 w-full h-full" />

      {/* 3D Projected NPC Thought Bubble */}
      <NpcThoughtOverlay
        pos={npcScreenPos}
        state={worldState}
        enabled={showThoughtBubble && cameraMode !== 'pov'}
      />

      {/* HUD Chrome */}
      <div className="pointer-events-none relative z-20 flex flex-col w-full h-full">
        <TopBar
          state={worldState}
          connectionMode={connectionMode}
          cameraMode={cameraMode}
          showThoughtBubble={showThoughtBubble}
          showPath={showPath}
          panelsOpen={panelsOpen}
          onControl={handleControl}
          onCameraMode={handleCameraMode}
          onFocusPreset={handleFocusPreset}
          onToggleThoughtBubble={() => setShowThoughtBubble((v) => !v)}
          onTogglePath={handleTogglePath}
          onTogglePanels={() => setPanelsOpen((v) => !v)}
          onOpenLlmModal={() => setLlmModalOpen(true)}
          onToggleOfflineDemo={handleToggleOfflineDemo}
        />

        {bannerError && (
          <div className="pointer-events-auto mx-auto mt-2 px-3 py-1.5 rounded-xl bg-rose-950/90 border border-rose-500/40 text-xs text-rose-200 shadow-lg">
            {bannerError}
          </div>
        )}

        <div className="flex-1 min-h-0 flex justify-between items-stretch p-3 gap-3">
          <LeftDrawer state={worldState} open={panelsOpen} />
          <div className="flex-1" />
          <RightDrawer state={worldState} open={panelsOpen} onGodIntervene={handleGodIntervene} />
        </div>
      </div>

      {/* Click-to-Inspect Toast */}
      <InspectToast
        target={inspectTarget}
        state={worldState}
        onClose={() => setInspectTarget(null)}
      />

      {/* LLM Config & Trace Inspector Modal */}
      <LlmModal
        open={llmModalOpen}
        connectionMode={connectionMode}
        traces={traces}
        onClose={() => setLlmModalOpen(false)}
        onTracesUpdated={setTraces}
      />
    </div>
  );
}

export default App;
