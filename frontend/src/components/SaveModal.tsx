import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { SaveSlotSummary } from '../types/world';

interface SaveModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'live' | 'offline_demo';
  currentDay: number;
  currentClock: string;
  saves: SaveSlotSummary[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onCreateSlot: (name: string) => Promise<string | null>;
  onLoadSlot: (slot: string) => Promise<string | null>;
  onDeleteSlot: (slot: string) => Promise<string | null>;
  onDownloadFile: () => Promise<string | null>;
  onUploadFile: (file: File) => Promise<string | null>;
}

function formatSavedTime(iso: string): string {
  if (!iso) return 'Just now';
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export const SaveModal: React.FC<SaveModalProps> = ({
  open,
  onClose,
  mode,
  currentDay,
  currentClock,
  saves,
  loading,
  onRefresh,
  onCreateSlot,
  onLoadSlot,
  onDeleteSlot,
  onDownloadFile,
  onUploadFile,
}) => {
  const [slotName, setSlotName] = useState(`Day ${currentDay} Island`);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSlotName(`Day ${currentDay} Island`);
      setNotice(null);
    }
    wasOpenRef.current = open;
  }, [open, currentDay]);

  if (!open) return null;

  const runAction = async (key: string, fn: () => Promise<string | null>, fallbackOk: string) => {
    setBusyKey(key);
    setNotice(null);
    try {
      const err = await fn();
      if (err) {
        setNotice({ kind: 'err', text: err });
      } else {
        setNotice({ kind: 'ok', text: fallbackOk });
      }
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'Action failed' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await runAction('upload', () => onUploadFile(file), `Loaded save file "${file.name}".`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-white/12 bg-neutral-950/95 text-neutral-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <HardDrive className="h-4 w-4 text-neutral-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium tracking-tight text-white">World Saves</h2>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
                  {mode === 'live' ? 'Server Disk' : 'Browser Storage'}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                Save or resume terrain, buildings, AI agents & companions • Day {currentDay} ({currentClock})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close saves dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Save Checkpoint Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = slotName.trim();
              if (!clean) return;
              void runAction('create', () => onCreateSlot(clean), `Saved "${clean}".`);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="text"
              value={slotName}
              onChange={(e) => setSlotName(e.target.value)}
              maxLength={64}
              placeholder="Checkpoint name (e.g. Cozy Village)"
              className="flex-1 rounded-xl border border-white/10 bg-neutral-900/90 px-3 py-2 text-xs text-white placeholder-neutral-500 outline-none transition focus:border-white/30"
            />
            <button
              type="submit"
              disabled={!slotName.trim() || busyKey !== null}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-45"
            >
              {busyKey === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Checkpoint
            </button>
          </form>

          {/* File Export / Import Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
            <span className="text-[11px] text-neutral-400">Portable `.json` save file for backup or sharing</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void runAction('download', onDownloadFile, 'Downloaded save file.')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-neutral-200 transition hover:bg-white/10 disabled:opacity-45"
              >
                {busyKey === 'download' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Export File
              </button>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-neutral-200 transition hover:bg-white/10 disabled:opacity-45"
              >
                {busyKey === 'upload' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Import File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleFileChange(e)}
                className="hidden"
              />
            </div>
          </div>

          {notice && (
            <div
              className={`rounded-xl border px-3 py-2 text-xs ${
                notice.kind === 'err'
                  ? 'border-white/20 bg-white/5 text-neutral-200'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300'
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* Saved Slots */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                Saved Checkpoints ({saves.length})
              </span>
              <button
                type="button"
                onClick={() => void onRefresh()}
                disabled={loading || busyKey !== null}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200"
              >
                <RotateCcw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {saves.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-8 text-center">
                  <FolderOpen className="mb-2 h-5 w-5 text-neutral-500" />
                  <p className="text-xs text-neutral-400">No saved checkpoints yet.</p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    Save a checkpoint above or export a `.json` file to resume later.
                  </p>
                </div>
              ) : (
                saves.map((item) => (
                  <div
                    key={item.slot}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/70 px-3.5 py-2.5 transition hover:border-white/20"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-white">{item.name}</span>
                        {item.size_bytes > 0 && (
                          <span className="shrink-0 text-[10px] text-neutral-500">{formatBytes(item.size_bytes)}</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400">
                        <span>Day {item.day} ({item.clock_str})</span>
                        <span>•</span>
                        <span className="capitalize">{item.weather}</span>
                        <span>•</span>
                        <span>{item.agents_count} NPC{item.agents_count === 1 ? '' : 's'}</span>
                        {item.entities_count > 0 && (
                          <>
                            <span>•</span>
                            <span>{item.entities_count} animal{item.entities_count === 1 ? '' : 's'}</span>
                          </>
                        )}
                        <span>•</span>
                        <span className="text-neutral-500">{formatSavedTime(item.saved_at)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void runAction(`load:${item.slot}`, () => onLoadSlot(item.slot), `Loaded "${item.name}".`)}
                        className="rounded-lg border border-white/15 bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-45"
                      >
                        {busyKey === `load:${item.slot}` ? 'Loading…' : 'Load'}
                      </button>
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void runAction(`del:${item.slot}`, () => onDeleteSlot(item.slot), `Deleted "${item.name}".`)}
                        className="rounded-lg border border-white/10 p-1.5 text-neutral-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white disabled:opacity-45"
                        title="Delete checkpoint"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
