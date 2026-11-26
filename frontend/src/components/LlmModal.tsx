import { useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  KeyRound,
  RefreshCw,
  Server,
  X,
  XCircle,
} from 'lucide-react';
import { backendApi } from '../services/api';
import type { ConnectionMode, LlmConfig, LlmTestResponse, LlmTrace } from '../types/world';

interface LlmModalProps {
  open: boolean;
  connectionMode: ConnectionMode;
  traces: LlmTrace[];
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

export function LlmModal({ open, connectionMode, traces, onClose, onTracesUpdated }: LlmModalProps) {
  const [tab, setTab] = useState<'config' | 'traces'>('config');
  const [config, setConfig] = useState<LlmConfig>({
    provider: 'ollama',
    model: 'llama3.2',
    base_url: 'http://localhost:11434',
    has_api_key: false,
    api_key: '',
    temperature: 0.7,
    decision_interval_ticks: 25,
    enabled: true,
  });
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResponse | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || connectionMode !== 'live') return;
    backendApi
      .getLlmConfig()
      .then((cfg) => {
        setConfig((prev) => ({
          ...prev,
          ...cfg,
          api_key: '',
        }));
      })
      .catch(() => {
        // Ignore if backend unavailable
      });
    backendApi
      .getLlmTraces(30)
      .then((list) => {
        if (list.length > 0) onTracesUpdated(list);
      })
      .catch(() => {
        // Ignore
      });
  }, [open, connectionMode, onTracesUpdated]);

  if (!open) return null;

  const isLocal = PROVIDER_DEFAULTS[config.provider]?.isLocal ?? true;

  const handleProviderChange = (nextProvider: string) => {
    const preset = PROVIDER_DEFAULTS[nextProvider] ?? PROVIDER_DEFAULTS.custom;
    setConfig((prev) => ({
      ...prev,
      provider: nextProvider,
      base_url: preset.baseUrl,
      model: preset.defaultModel,
    }));
    setModels([]);
    setTestResult(null);
  };

  const handleFetchModels = async () => {
    setLoadingModels(true);
    setStatusMsg(null);
    try {
      const res = await backendApi.getLlmModels(config.provider, config.base_url);
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

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
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
      const saved = await backendApi.updateLlmConfig(payload);
      setConfig((prev) => ({ ...prev, ...saved, api_key: '' }));
      setStatusMsg('AI Brain configuration saved');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: Partial<LlmConfig> = {
        provider: config.provider,
        model: config.model,
        base_url: config.base_url,
        temperature: config.temperature,
      };
      if (config.api_key && config.api_key.trim().length > 0) {
        payload.api_key = config.api_key.trim();
      }
      const res = await backendApi.testLlmConnection(payload);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <Brain className="w-5 h-5 text-violet-400" />
            <div>
              <h2 className="text-sm font-bold text-white">AI Brain Configuration & Trace Log</h2>
              <p className="text-[11px] text-slate-400">
                Connect a Local LLM (Ollama / LM Studio) or Cloud API Key
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex items-center gap-2 border-b border-slate-800 bg-slate-950/30">
          <button
            onClick={() => setTab('config')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition cursor-pointer ${
              tab === 'config'
                ? 'border-violet-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            LLM Provider Settings
          </button>
          <button
            onClick={() => setTab('traces')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              tab === 'traces'
                ? 'border-violet-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Decision Trace Log ({traces.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto hud-scroll p-5 space-y-4">
          {connectionMode !== 'live' && tab === 'config' && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              Currently in <strong>{connectionMode.replace('_', ' ')}</strong> mode. Start the backend
              at <code className="font-mono">http://localhost:8000</code> to persist settings and run
              live LLM decisions.
            </div>
          )}

          {tab === 'config' ? (
            <>
              {/* Provider Picker */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Select Provider
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'ollama', label: 'Ollama (Local)', icon: Server },
                    { id: 'lmstudio', label: 'LM Studio', icon: Cpu },
                    { id: 'openai', label: 'OpenAI Key', icon: KeyRound },
                    { id: 'gemini', label: 'Gemini Key', icon: KeyRound },
                    { id: 'openrouter', label: 'OpenRouter', icon: KeyRound },
                    { id: 'custom', label: 'Custom URL', icon: Server },
                    { id: 'fallback', label: 'Offline Fallback', icon: Cpu },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => handleProviderChange(id)}
                      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-medium transition cursor-pointer ${
                        config.provider === id
                          ? 'bg-violet-600/25 border-violet-400 text-white'
                          : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 text-violet-300" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {/* Base URL */}
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Endpoint Base URL</label>
                  <input
                    type="text"
                    value={config.base_url}
                    onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                    placeholder="http://localhost:11434"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-violet-500"
                  />
                </div>

                {/* Model */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-slate-400">Model Name</label>
                    <button
                      onClick={handleFetchModels}
                      disabled={loadingModels || connectionMode !== 'live'}
                      className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 disabled:opacity-40 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} />
                      Fetch Models
                    </button>
                  </div>
                  {models.length > 0 ? (
                    <select
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
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
                      placeholder="llama3.2 / gpt-4o-mini"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-violet-500"
                    />
                  )}
                </div>
              </div>

              {/* API Key (shown prominently for cloud providers, optional for custom) */}
              {(!isLocal || config.provider === 'custom') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-slate-400">API Key</label>
                    {config.has_api_key && (
                      <span className="text-[10px] text-emerald-300">
                        Key saved on server (leave blank to keep existing)
                      </span>
                    )}
                  </div>
                  <input
                    type="password"
                    value={config.api_key ?? ''}
                    onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                    placeholder={config.has_api_key ? '••••••••••••••••••••' : 'sk-... or AIza...'}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              {/* Tuning Parameters */}
              <div className="grid sm:grid-cols-3 gap-3 items-center p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div>
                  <label className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Temperature</span>
                    <span className="font-mono text-slate-200">{config.temperature}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1.2}
                    step={0.1}
                    value={config.temperature}
                    onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })}
                    className="w-full accent-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Think Every (Ticks)</label>
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
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-100"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer pt-3 sm:pt-0">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                    className="rounded accent-violet-500 w-4 h-4"
                  />
                  <span>LLM Brain Active</span>
                </label>
              </div>

              {/* Actions & Test Feedback */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-xs text-slate-300">{statusMsg}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={testing || connectionMode !== 'live'}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-100 cursor-pointer transition"
                  >
                    {testing ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || connectionMode !== 'live'}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer transition"
                  >
                    {saving ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs ${
                    testResult.ok
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    {testResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400" />
                    )}
                    <span>
                      {testResult.ok
                        ? `Connected (${testResult.latency_ms} ms)`
                        : `Connection Failed (${testResult.latency_ms} ms)`}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] opacity-90 break-words">
                    {testResult.error || testResult.reply}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2.5">
              {traces.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  No LLM decision traces recorded yet.
                </div>
              ) : (
                traces.map((tr) => {
                  const isOpen = expandedTraceId === tr.id;
                  return (
                    <div
                      key={tr.id}
                      className="rounded-xl bg-slate-950/80 border border-slate-800 overflow-hidden"
                    >
                      <button
                        onClick={() => setExpandedTraceId(isOpen ? null : tr.id)}
                        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-900/70 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap text-[11px]">
                            <span className="font-mono text-cyan-300">
                              {tr.provider}/{tr.model}
                            </span>
                            <span className="text-slate-500 font-mono">{tr.latency_ms}ms</span>
                            {tr.used_fallback && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                                fallback
                              </span>
                            )}
                            {tr.error && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px]">
                                error
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-300 truncate mt-0.5">
                            {tr.parsed_decision?.action
                              ? `${tr.parsed_decision.action} — ${tr.parsed_decision.thought ?? tr.prompt_summary}`
                              : tr.prompt_summary}
                          </div>
                        </div>
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                      </button>

                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 border-t border-slate-800/80 space-y-2 text-[11px]">
                          {tr.error && (
                            <div className="p-2 rounded bg-rose-500/10 text-rose-300 font-mono">
                              Error: {tr.error}
                            </div>
                          )}
                          <div>
                            <div className="text-slate-400 font-semibold mb-0.5">Prompt Context</div>
                            <pre className="p-2 rounded bg-slate-900 text-slate-300 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                              {tr.raw_prompt}
                            </pre>
                          </div>
                          <div>
                            <div className="text-slate-400 font-semibold mb-0.5">Model Output</div>
                            <pre className="p-2 rounded bg-slate-900 text-emerald-300 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                              {tr.raw_response}
                            </pre>
                          </div>
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
