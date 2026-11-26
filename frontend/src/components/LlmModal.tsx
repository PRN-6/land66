import { useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  KeyRound,
  Radar,
  RefreshCw,
  Server,
  X,
  XCircle,
} from 'lucide-react';
import { backendApi } from '../services/api';
import type {
  ConnectionMode,
  DetectedLocalModel,
  LlmConfig,
  LlmTestResponse,
  LlmTrace,
  NpcState,
} from '../types/world';

interface LlmModalProps {
  open: boolean;
  connectionMode: ConnectionMode;
  agents: NpcState[];
  activeAgentId: string;
  traces: LlmTrace[];
  onSelectAgentId: (agentId: string) => void;
  onRetryConnection: () => void;
  onClose: () => void;
  onTracesUpdated: (traces: LlmTrace[]) => void;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string; isLocal: boolean }> = {
  ollama: { baseUrl: 'http://localhost:11434', defaultModel: 'llama3.2', isLocal: true },
  lmstudio: { baseUrl: 'http://localhost:1234/v1', defaultModel: 'local-model', isLocal: true },
  custom: { baseUrl: 'http://localhost:8080/v1', defaultModel: 'default', isLocal: true },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', isLocal: false },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    isLocal: false,
  },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', isLocal: false },
  fallback: { baseUrl: '', defaultModel: 'rule-based', isLocal: true },
};

export function LlmModal({
  open,
  connectionMode,
  agents,
  activeAgentId,
  traces,
  onSelectAgentId,
  onRetryConnection,
  onClose,
  onTracesUpdated,
}: LlmModalProps) {
  const [tab, setTab] = useState<'config' | 'traces'>('config');
  const [traceScope, setTraceScope] = useState<'agent' | 'all'>('agent');
  const [config, setConfig] = useState<LlmConfig>({
    provider: 'ollama',
    model: 'llama3.2',
    base_url: 'http://localhost:11434',
    has_api_key: false,
    api_key: '',
    temperature: 0.7,
    decision_interval_ticks: 100,
    enabled: true,
  });
  const [models, setModels] = useState<string[]>([]);
  const [detectedModels, setDetectedModels] = useState<DetectedLocalModel[]>([]);
  const [scanningLocal, setScanningLocal] = useState(false);
  const [scanChecked, setScanChecked] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResponse | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);

  const activeAgent =
    agents.find((a, idx) => (a.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`)) === activeAgentId) ??
    agents[0];

  const scanLocalModels = async () => {
    setScanningLocal(true);
    try {
      const res = await backendApi.detectLocalLlms();
      setDetectedModels(res.detected ?? []);
      setScanChecked(true);
    } catch {
      setDetectedModels([]);
      setScanChecked(true);
    } finally {
      setScanningLocal(false);
    }
  };

  useEffect(() => {
    if (!open || connectionMode !== 'live') return;
    setTestResult(null);
    setStatusMsg(null);
    backendApi
      .getLlmConfig(activeAgentId)
      .then((cfg) => {
        setConfig((prev) => ({
          ...prev,
          ...cfg,
          api_key: '',
        }));
      })
      .catch(() => {});
    backendApi
      .getLlmTraces(40)
      .then((list) => {
        if (list.length > 0) onTracesUpdated(list);
      })
      .catch(() => {});
    scanLocalModels();
  }, [open, connectionMode, activeAgentId, onTracesUpdated]);

  if (!open) return null;

  const isLocal = PROVIDER_DEFAULTS[config.provider]?.isLocal ?? true;

  const handleProviderChange = (nextProvider: string) => {
    const preset = PROVIDER_DEFAULTS[nextProvider] ?? PROVIDER_DEFAULTS.custom;
    setConfig((prev) => ({
      ...prev,
      provider: nextProvider,
      base_url: preset.baseUrl,
      model: preset.defaultModel,
      enabled: nextProvider === 'fallback' ? false : true,
    }));
    setModels([]);
    setTestResult(null);
  };

  const handleSelectDetected = async (item: DetectedLocalModel) => {
    const nextPatch: Partial<LlmConfig> = {
      provider: item.provider,
      model: item.model,
      base_url: item.base_url,
      enabled: true,
    };
    setConfig((prev) => ({ ...prev, ...nextPatch, api_key: '' }));
    setModels([item.model]);
    setTestResult(null);
    setSaving(true);
    setStatusMsg(null);
    try {
      const saved = await backendApi.updateLlmConfig(nextPatch, activeAgentId);
      setConfig((prev) => ({ ...prev, ...saved, api_key: '' }));
      setStatusMsg(`${activeAgent?.name ?? 'NPC'}: active ${item.model}`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to activate local model');
    } finally {
      setSaving(false);
    }
  };

  const handleFetchModels = async () => {
    setLoadingModels(true);
    setStatusMsg(null);
    try {
      const res = await backendApi.getLlmModels(config.provider, config.base_url, activeAgentId);
      setModels(res.models);
      if (res.models.length > 0 && !res.models.includes(config.model)) {
        setConfig((prev) => ({ ...prev, model: res.models[0] }));
      }
      setStatusMsg(res.models.length > 0 ? `Found ${res.models.length} models` : 'No models returned');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoadingModels(false);
    }
  };

  const buildPayload = (): Partial<LlmConfig> => {
    const payload: Partial<LlmConfig> = {
      provider: config.provider,
      model: config.model,
      base_url: config.base_url,
      temperature: config.temperature,
      decision_interval_ticks: config.decision_interval_ticks,
      enabled: config.enabled,
    };
    if (config.api_key && config.api_key.trim().length > 0) {
      payload.api_key = config.api_key.trim();
    }
    return payload;
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const saved = await backendApi.updateLlmConfig(buildPayload(), activeAgentId);
      setConfig((prev) => ({ ...prev, ...saved, api_key: '' }));
      setStatusMsg(`Saved for ${activeAgent?.name ?? activeAgentId}`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyAll = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await backendApi.applyLlmToAll(buildPayload());
      setStatusMsg(`Applied to all ${res.count} NPCs`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to apply to all NPCs');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await backendApi.testLlmConnection(buildPayload(), activeAgentId);
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        latency_ms: 0,
        reply: '',
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const filteredTraces =
    traceScope === 'all'
      ? traces
      : traces.filter((t) => !t.agent_id || t.agent_id === activeAgentId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-neutral-950 border border-white/15 shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Brain className="w-4 h-4 text-neutral-300" />
            <div>
              <h2 className="text-xs font-semibold text-white">NPC Brain Manager</h2>
              <p className="text-[11px] text-neutral-400">
                Assign an independent Local LLM, Cloud API Key, or Fallback brain per NPC
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Agent Switcher Strip */}
        <div className="px-5 py-2.5 border-b border-white/10 bg-neutral-900/40 flex items-center gap-1.5 overflow-x-auto hud-scroll">
          {agents.map((ag, idx) => {
            const aid = ag.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`);
            const selected = aid === activeAgentId;
            return (
              <button
                key={aid}
                onClick={() => onSelectAgentId(aid)}
                className={`px-3 py-1.5 rounded-full text-xs shrink-0 transition cursor-pointer border ${
                  selected
                    ? 'bg-white text-neutral-950 border-white font-medium'
                    : 'bg-neutral-900 border-white/10 text-neutral-300 hover:border-white/25'
                }`}
              >
                {ag.name}
                <span className={`ml-1.5 text-[10px] ${selected ? 'text-neutral-600' : 'text-neutral-500'}`}>
                  {ag.llm_status?.model || ag.llm_status?.provider || 'fallback'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 pt-2.5 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setTab('config')}
              className={`pb-2.5 text-xs font-medium border-b-2 transition cursor-pointer ${
                tab === 'config' ? 'border-white text-white' : 'border-transparent text-neutral-500 hover:text-neutral-200'
              }`}
            >
              {activeAgent?.name ?? 'NPC'} Settings
            </button>
            <button
              onClick={() => setTab('traces')}
              className={`pb-2.5 text-xs font-medium border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                tab === 'traces' ? 'border-white text-white' : 'border-transparent text-neutral-500 hover:text-neutral-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Traces ({filteredTraces.length})
            </button>
          </div>

          {tab === 'traces' && (
            <div className="flex gap-1 pb-2 text-[10px]">
              <button
                onClick={() => setTraceScope('agent')}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  traceScope === 'agent' ? 'bg-white text-neutral-950 font-medium' : 'text-neutral-400'
                }`}
              >
                {activeAgent?.name ?? 'Selected'}
              </button>
              <button
                onClick={() => setTraceScope('all')}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  traceScope === 'all' ? 'bg-white text-neutral-950 font-medium' : 'text-neutral-400'
                }`}
              >
                All NPCs
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto hud-scroll p-5 space-y-4">
          {tab === 'config' ? (
            <>
              {/* Auto-Detected Local Models */}
              <div className="p-3 rounded-xl bg-neutral-900/70 border border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                    <Radar className={`w-3.5 h-3.5 ${scanningLocal ? 'animate-spin' : ''}`} />
                    <span>Detected on This Computer</span>
                  </div>
                  <button
                    onClick={scanLocalModels}
                    disabled={scanningLocal || connectionMode !== 'live'}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] text-neutral-200 disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${scanningLocal ? 'animate-spin' : ''}`} />
                    {scanningLocal ? 'Scanning...' : 'Scan PC'}
                  </button>
                </div>

                {connectionMode !== 'live' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
                    <span>
                      Backend <code className="font-mono text-neutral-300">:8000</code> is offline — Test, Save, and Scan PC are disabled in Demo mode.
                    </span>
                    <button
                      type="button"
                      onClick={onRetryConnection}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white text-neutral-950 font-medium hover:bg-neutral-200 transition cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reconnect :8000
                    </button>
                  </div>
                ) : detectedModels.length > 0 ? (
                  <div className="grid sm:grid-cols-2 gap-1.5 max-h-32 overflow-y-auto hud-scroll">
                    {detectedModels.map((item) => {
                      const active =
                        config.provider === item.provider &&
                        config.model === item.model &&
                        config.base_url === item.base_url;
                      return (
                        <button
                          key={`${item.provider}-${item.base_url}-${item.model}`}
                          onClick={() => handleSelectDetected(item)}
                          className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-left transition cursor-pointer ${
                            active
                              ? 'bg-white text-neutral-950 border-white font-medium'
                              : 'bg-neutral-950/70 border-white/10 hover:border-white/25 text-neutral-200'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-mono truncate">{item.model}</div>
                            <div className={`text-[10px] truncate ${active ? 'text-neutral-600' : 'text-neutral-500'}`}>
                              {item.label}
                              {item.size ? ` · ${item.size}` : ''}
                            </div>
                          </div>
                          <span className="text-[10px] shrink-0">
                            {active ? 'Active' : item.status === 'running' ? 'Use' : 'Installed'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : scanChecked ? (
                  <div className="text-[11px] text-neutral-500">
                    No running Ollama or LM Studio detected. Start one and click Scan PC.
                  </div>
                ) : null}
              </div>

              {/* Provider Selector */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {[
                  { id: 'ollama', label: 'Ollama', icon: Server },
                  { id: 'lmstudio', label: 'LM Studio', icon: Cpu },
                  { id: 'openai', label: 'OpenAI', icon: KeyRound },
                  { id: 'gemini', label: 'Gemini', icon: KeyRound },
                  { id: 'openrouter', label: 'OpenRouter', icon: KeyRound },
                  { id: 'custom', label: 'Custom', icon: Server },
                  { id: 'fallback', label: 'Fallback', icon: Cpu },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => handleProviderChange(id)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs transition cursor-pointer ${
                      config.provider === id
                        ? 'bg-white text-neutral-950 border-white font-medium'
                        : 'bg-neutral-900/70 border-white/5 text-neutral-300 hover:border-white/20'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={config.base_url}
                    onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-neutral-400">Model</label>
                    <button
                      onClick={handleFetchModels}
                      disabled={loadingModels || connectionMode !== 'live'}
                      className="inline-flex items-center gap-1 text-[11px] text-neutral-300 hover:text-white disabled:opacity-40 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} />
                      Fetch
                    </button>
                  </div>
                  {models.length > 0 ? (
                    <select
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs font-mono text-white"
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                    />
                  )}
                </div>
              </div>

              {(!isLocal || config.provider === 'custom') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-neutral-400">API Key</label>
                    {config.has_api_key && <span className="text-[10px] text-neutral-400">Saved on server</span>}
                  </div>
                  <input
                    type="password"
                    value={config.api_key ?? ''}
                    onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                    placeholder={config.has_api_key ? '••••••••••••' : 'sk-...'}
                    className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                  />
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-3 items-center p-3 rounded-xl bg-neutral-900/60 border border-white/5">
                <div>
                  <label className="flex justify-between text-[11px] text-neutral-400 mb-1">
                    <span>Temperature</span>
                    <span className="font-mono text-neutral-200">{config.temperature}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1.2}
                    step={0.1}
                    value={config.temperature}
                    onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })}
                    className="w-full accent-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Interval (Ticks)</label>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={config.decision_interval_ticks}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        decision_interval_ticks: Math.max(5, Number(e.target.value) || 25),
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-xs font-mono text-white"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-neutral-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                    className="accent-white w-4 h-4"
                  />
                  <span>Active</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-xs text-neutral-400">{statusMsg}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={testing || connectionMode !== 'live'}
                    className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 disabled:opacity-40 text-xs text-neutral-200 cursor-pointer"
                  >
                    {testing ? 'Testing...' : 'Test'}
                  </button>
                  {agents.length > 1 && (
                    <button
                      onClick={handleApplyAll}
                      disabled={saving || connectionMode !== 'live'}
                      className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 disabled:opacity-40 text-xs text-neutral-200 cursor-pointer"
                    >
                      Apply All
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || connectionMode !== 'live'}
                    className="px-4 py-2 rounded-xl bg-white hover:bg-neutral-200 disabled:opacity-40 text-xs font-semibold text-neutral-950 cursor-pointer"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="p-3 rounded-xl bg-neutral-900 border border-white/10 text-xs text-neutral-200">
                  <div className="flex items-center gap-2 font-medium mb-1">
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    <span>{testResult.ok ? `Connected (${testResult.latency_ms} ms)` : 'Failed'}</span>
                  </div>
                  <div className="font-mono text-[11px] text-neutral-400 break-words">
                    {testResult.error || testResult.reply}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {filteredTraces.length === 0 ? (
                <div className="text-center py-8 text-xs text-neutral-500">No traces yet.</div>
              ) : (
                filteredTraces.map((tr) => {
                  const isOpen = expandedTraceId === tr.id;
                  return (
                    <div key={tr.id} className="rounded-xl bg-neutral-900/70 border border-white/5 overflow-hidden">
                      <button
                        onClick={() => setExpandedTraceId(isOpen ? null : tr.id)}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/5 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                            {tr.agent_name && <span className="text-white">{tr.agent_name}</span>}
                            <span className="text-neutral-300">
                              {tr.provider}/{tr.model}
                            </span>
                            <span>{tr.latency_ms}ms</span>
                            {tr.used_fallback && <span>fallback</span>}
                          </div>
                          <div className="text-xs text-neutral-300 truncate mt-0.5">
                            {tr.parsed_decision?.action
                              ? `${tr.parsed_decision.action} — ${tr.parsed_decision.thought ?? tr.prompt_summary}`
                              : tr.prompt_summary}
                          </div>
                        </div>
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-neutral-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" />
                        )}
                      </button>

                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2 text-[11px]">
                          {tr.error && <div className="text-neutral-300 font-mono">Error: {tr.error}</div>}
                          <pre className="p-2 rounded bg-neutral-950 text-neutral-400 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {tr.raw_prompt}
                          </pre>
                          <pre className="p-2 rounded bg-neutral-950 text-neutral-200 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {tr.raw_response}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
