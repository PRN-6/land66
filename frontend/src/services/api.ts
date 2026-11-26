import type {
  LlmConfig,
  LlmTestResponse,
  LlmTrace,
  SimSpeed,
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
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
    action: 'set_time' | 'set_weather' | 'whisper' | 'spawn_tree' | 'drop_gift' | 'heal_npc';
    value?: unknown;
  }): Promise<{ ok?: boolean; message?: string; state?: WorldStateSnapshot }> {
    return requestJson('/api/god/intervene', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getLlmConfig(): Promise<LlmConfig> {
    return requestJson('/api/llm/config');
  },

  updateLlmConfig(config: Partial<LlmConfig>): Promise<LlmConfig> {
    return requestJson('/api/llm/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  getLlmModels(provider?: string, baseUrl?: string): Promise<{ models: string[] }> {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    if (baseUrl) params.set('base_url', baseUrl);
    const qs = params.toString();
    return requestJson(`/api/llm/models${qs ? `?${qs}` : ''}`).then((res: unknown) => {
      if (Array.isArray(res)) {
        return { models: res as string[] };
      }
      const obj = res as { models?: string[] };
      return { models: Array.isArray(obj?.models) ? obj.models : [] };
    });
  },

  testLlmConnection(override?: Partial<LlmConfig>): Promise<LlmTestResponse> {
    return requestJson('/api/llm/test', {
      method: 'POST',
      body: JSON.stringify(override ?? {}),
    });
  },

  getLlmTraces(limit = 30): Promise<LlmTrace[]> {
    return requestJson<LlmTrace[] | { traces: LlmTrace[] }>(`/api/llm/traces?limit=${limit}`).then(
      (res) => (Array.isArray(res) ? res : (res?.traces ?? [])),
    );
  },
};
