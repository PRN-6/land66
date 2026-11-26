import type {
  AgentRole,
  DetectLocalLlmResponse,
  LlmConfig,
  LlmTestResponse,
  LlmTrace,
  NpcState,
  SaveSlotSummary,
  SimSpeed,
  WorldSavePayload,
  WorldStateSnapshot,
} from '../types/world';

const DEFAULT_API_URL = 'http://localhost:8000';

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  return (configured && configured.trim() ? configured : DEFAULT_API_URL).replace(/\/+$/, '');
}

export function getWsBaseUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured && configured.trim()) {
    return configured.trim();
  }
  const apiUrl = getApiBaseUrl();
  if (apiUrl.startsWith('https://')) {
    return `${apiUrl.replace(/^https:\/\//, 'wss://')}/ws`;
  }
  return `${apiUrl.replace(/^http:\/\//, 'ws://')}/ws`;
}

async function requestJson<T>(path: string, init?: RequestInit, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)),
    timeoutMs,
  );
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const backendApi = {
  health(): Promise<{ ok: boolean }> {
    return requestJson('/api/health');
  },

  getState(): Promise<WorldStateSnapshot> {
    return requestJson('/api/state');
  },

  simControl(payload: {
    action: 'pause' | 'resume' | 'step' | 'set_speed' | 'reset';
    speed?: SimSpeed;
    seed?: number;
  }): Promise<{ ok?: boolean; state?: WorldStateSnapshot }> {
    return requestJson('/api/sim/control', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  godIntervene(payload: {
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
      | 'clear_entities';
    value?: unknown;
    agent_id?: string;
  }): Promise<{ ok?: boolean; message?: string; state?: WorldStateSnapshot }> {
    return requestJson('/api/god/intervene', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listAgents(): Promise<Array<NpcState & { llm_config?: LlmConfig }>> {
    return requestJson('/api/agents');
  },

  createAgent(payload: {
    name?: string;
    role?: AgentRole;
    x?: number;
    y?: number;
    z?: number;
    llm_config?: Partial<LlmConfig>;
  }): Promise<NpcState & { llm_config?: LlmConfig }> {
    return requestJson('/api/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteAgent(agentId: string): Promise<{ ok: boolean; removed: string }> {
    return requestJson(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    });
  },

  getLlmConfig(agentId?: string): Promise<LlmConfig> {
    const qs = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
    return requestJson(`/api/llm/config${qs}`);
  },

  updateLlmConfig(config: Partial<LlmConfig>, agentId?: string): Promise<LlmConfig> {
    const qs = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
    return requestJson(`/api/llm/config${qs}`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  applyLlmToAll(config: Partial<LlmConfig>): Promise<{ ok: boolean; count: number }> {
    return requestJson('/api/llm/apply_all', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  getLlmModels(provider?: string, baseUrl?: string, agentId?: string): Promise<{ models: string[] }> {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    if (baseUrl) params.set('base_url', baseUrl);
    if (agentId) params.set('agent_id', agentId);
    const qs = params.toString();
    return requestJson(`/api/llm/models${qs ? `?${qs}` : ''}`).then((res: unknown) => {
      if (Array.isArray(res)) {
        return { models: res as string[] };
      }
      const obj = res as { models?: string[] };
      return { models: Array.isArray(obj?.models) ? obj.models : [] };
    });
  },

  testLlmConnection(override?: Partial<LlmConfig>, agentId?: string): Promise<LlmTestResponse> {
    const qs = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
    return requestJson(
      `/api/llm/test${qs}`,
      {
        method: 'POST',
        body: JSON.stringify(override ?? {}),
      },
      60000,
    );
  },

  detectLocalLlms(): Promise<DetectLocalLlmResponse> {
    return requestJson('/api/llm/detect');
  },

  getLlmTraces(limit = 30, agentId?: string): Promise<LlmTrace[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (agentId) params.set('agent_id', agentId);
    return requestJson<LlmTrace[] | { traces: LlmTrace[] }>(`/api/llm/traces?${params.toString()}`).then(
      (res) => (Array.isArray(res) ? res : (res?.traces ?? [])),
    );
  },

  downloadSave(): Promise<WorldSavePayload> {
    return requestJson('/api/sim/save');
  },

  loadSave(payload: WorldSavePayload): Promise<{ ok: boolean; state: WorldStateSnapshot }> {
    return requestJson('/api/sim/load', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listSaves(): Promise<{ saves: SaveSlotSummary[] }> {
    return requestJson('/api/sim/saves');
  },

  createSaveSlot(name: string): Promise<{ ok: boolean; save: SaveSlotSummary }> {
    return requestJson('/api/sim/saves', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  loadSaveSlot(slot: string): Promise<{ ok: boolean; slot: string; state: WorldStateSnapshot }> {
    return requestJson(`/api/sim/saves/${encodeURIComponent(slot)}/load`, {
      method: 'POST',
    });
  },

  deleteSaveSlot(slot: string): Promise<{ ok: boolean; slot: string }> {
    return requestJson(`/api/sim/saves/${encodeURIComponent(slot)}`, {
      method: 'DELETE',
    });
  },
};
