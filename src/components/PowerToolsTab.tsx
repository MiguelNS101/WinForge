import React, { useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ArrowRight,
  Check,
  ClipboardType,
  Coffee,
  Copy,
  Crosshair,
  Edit3,
  FileCode2,
  FolderOpen,
  Image as ImageIcon,
  Keyboard,
  Loader2,
  MousePointerClick,
  Pin,
  Pipette,
  Plus,
  RefreshCw,
  Save,
  ScanText,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Variable,
  X,
  Zap,
} from 'lucide-react';
import { tauriBridge } from '../services/tauriBridge';
import {
  BatchResizeResult,
  EnvVarEntry,
  HostEntry,
  KeyRemapRule,
  OcrExtractResult,
  PickedColor,
  PowerToolsConfig,
} from '../types/profile';
import { TuiCheckbox } from './TuiCheckbox';

type PowerToolsSubTab = 'tools' | 'env' | 'hosts' | 'images' | 'mouse';

interface PowerToolsTabProps {
  isTauri: boolean;
  disabled: boolean;
  config: PowerToolsConfig;
  colorHistory: PickedColor[];
  lastOcr: OcrExtractResult | null;
  keyRemaps: KeyRemapRule[];
  onUpdateConfig: (next: PowerToolsConfig) => Promise<void>;
  onToggleAwake: (enabled: boolean, keepScreenOn: boolean) => Promise<void>;
  onTriggerAlwaysOnTop: () => Promise<void>;
  onTriggerPickColor: () => Promise<void>;
  onTriggerPlainTextPaste: () => Promise<void>;
  onTriggerOcrCapture: () => Promise<void>;
  onTriggerFindMyMouse: () => Promise<void>;
  onToggleMouseCrosshair: (enabled: boolean) => Promise<void>;
  onUpdateKeyRemaps: (next: KeyRemapRule[]) => Promise<void>;
  onClearColorHistory: () => void;
  onLog: (level: 'INFO' | 'OK' | 'WARN' | 'ERR', message: string) => void;
}

const IMAGE_PRESETS = [
  { id: 'small', label: 'Small', desc: '854×480', width: 854, height: 480, format: 'jpg' as const, quality: 85 },
  { id: 'medium', label: 'Medium', desc: '1366×768', width: 1366, height: 768, format: 'jpg' as const, quality: 88 },
  { id: 'fhd', label: 'Full HD', desc: '1920×1080', width: 1920, height: 1080, format: 'png' as const, quality: 92 },
  { id: 'webp', label: 'WebP Optimize', desc: 'Original · WebP', width: 0, height: 0, format: 'webp' as const, quality: 82 },
];

const REMAP_KEY_OPTIONS = [
  'CapsLock',
  'Escape',
  'LControl',
  'RControl',
  'LAlt',
  'RAlt',
  'LShift',
  'RShift',
  'LWin',
  'RWin',
  'Tab',
  'Space',
  'Enter',
  'Backspace',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'PrintScreen',
  'ScrollLock',
  'Pause',
  'Apps',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
];

const SUPPORTED_IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function PowerToolsTab({
  isTauri,
  disabled,
  config,
  colorHistory,
  lastOcr,
  keyRemaps,
  onUpdateConfig,
  onToggleAwake,
  onTriggerAlwaysOnTop,
  onTriggerPickColor,
  onTriggerPlainTextPaste,
  onTriggerOcrCapture,
  onTriggerFindMyMouse,
  onToggleMouseCrosshair,
  onUpdateKeyRemaps,
  onClearColorHistory,
  onLog,
}: PowerToolsTabProps) {
  const [subTab, setSubTab] = useState<PowerToolsSubTab>('tools');

  // Editable hotkey draft inputs
  const [hkTop, setHkTop] = useState(config.hotkeyAlwaysOnTop);
  const [hkColor, setHkColor] = useState(config.hotkeyColorPicker);
  const [hkPlain, setHkPlain] = useState(config.hotkeyPlainText);
  const [hkOcr, setHkOcr] = useState(config.hotkeyOcr);
  const [savingConfig, setSavingConfig] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Environment Variables & Visual PATH Editor state
  const [envVars, setEnvVars] = useState<EnvVarEntry[]>([]);
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [hasLoadedEnv, setHasLoadedEnv] = useState(false);
  const [envScopeFilter, setEnvScopeFilter] = useState<'all' | 'user' | 'system'>('all');
  const [envSearch, setEnvSearch] = useState('');
  const [editingVar, setEditingVar] = useState<EnvVarEntry | null>(null);
  const [editLines, setEditLines] = useState<string[]>([]);
  const [editSingleVal, setEditSingleVal] = useState('');
  const [isPathMode, setIsPathMode] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [showAddEnv, setShowAddEnv] = useState(false);
  const [newEnvScope, setNewEnvScope] = useState<'user' | 'system'>('user');
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');

  // Hosts File Editor state
  const [hosts, setHosts] = useState<HostEntry[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [hasLoadedHosts, setHasLoadedHosts] = useState(false);
  const [savingHosts, setSavingHosts] = useState(false);
  const [hostsDirty, setHostsDirty] = useState(false);
  const [hostsSearch, setHostsSearch] = useState('');
  const [newHostIp, setNewHostIp] = useState('127.0.0.1');
  const [newHostDomain, setNewHostDomain] = useState('');
  const [newHostComment, setNewHostComment] = useState('');
  const [hostsError, setHostsError] = useState<string | null>(null);

  // Batch Image Resizer state
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [imgWidth, setImgWidth] = useState<number>(1920);
  const [imgHeight, setImgHeight] = useState<number>(1080);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpg' | 'webp'>('webp');
  const [imgQuality, setImgQuality] = useState<number>(85);
  const [activePreset, setActivePreset] = useState<string>('fhd');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [resizingImages, setResizingImages] = useState(false);
  const [lastResizeResult, setLastResizeResult] = useState<BatchResizeResult | null>(null);

  // Key Remapper form state
  const [newFromKey, setNewFromKey] = useState('CapsLock');
  const [newToKey, setNewToKey] = useState('Escape');

  useEffect(() => {
    setHkTop(config.hotkeyAlwaysOnTop);
    setHkColor(config.hotkeyColorPicker);
    setHkPlain(config.hotkeyPlainText);
    setHkOcr(config.hotkeyOcr);
  }, [
    config.hotkeyAlwaysOnTop,
    config.hotkeyColorPicker,
    config.hotkeyPlainText,
    config.hotkeyOcr,
  ]);

  const loadEnvVars = async () => {
    if (!isTauri) return;
    setLoadingEnv(true);
    try {
      const vars = await tauriBridge.getEnvVars();
      setEnvVars(vars);
      setHasLoadedEnv(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('ERR', `Erro ao carregar variáveis de ambiente: ${msg}`);
    } finally {
      setLoadingEnv(false);
    }
  };

  const loadHosts = async () => {
    if (!isTauri) return;
    setLoadingHosts(true);
    setHostsError(null);
    try {
      const entries = await tauriBridge.readHostsFile();
      setHosts(entries);
      setHasLoadedHosts(true);
      setHostsDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHostsError(msg);
      onLog('ERR', `Erro ao ler arquivo hosts: ${msg}`);
    } finally {
      setLoadingHosts(false);
    }
  };

  // Lazy-load Env & Hosts when entering their sub-tabs
  useEffect(() => {
    if (!isTauri) return;
    if (subTab === 'env' && !hasLoadedEnv && !loadingEnv) {
      void loadEnvVars();
    }
    if (subTab === 'hosts' && !hasLoadedHosts && !loadingHosts) {
      void loadHosts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, isTauri]);

  // Tauri v2 native Drag & Drop listener for Batch Image Resizer
  useEffect(() => {
    if (!isTauri || subTab !== 'images') return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDraggingOver(true);
        } else if (payload.type === 'leave') {
          setIsDraggingOver(false);
        } else if (payload.type === 'drop') {
          setIsDraggingOver(false);
          const dropped = payload.paths.filter((p) => {
            const lower = p.toLowerCase();
            return SUPPORTED_IMG_EXTS.some((ext) => lower.endsWith(ext));
          });
          if (dropped.length > 0) {
            setImagePaths((prev) => Array.from(new Set([...prev, ...dropped])));
            onLog('INFO', `${dropped.length} imagem(ns) adicionada(s) à fila via Drag & Drop.`);
          } else {
            onLog('WARN', 'Nenhum arquivo PNG/JPG/WEBP válido detectado no drop.');
          }
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      setIsDraggingOver(false);
      unlisten?.();
    };
  }, [isTauri, subTab, onLog]);

  const hotkeysDirty =
    hkTop.trim() !== config.hotkeyAlwaysOnTop ||
    hkColor.trim() !== config.hotkeyColorPicker ||
    hkPlain.trim() !== config.hotkeyPlainText ||
    hkOcr.trim() !== config.hotkeyOcr;

  const handleSaveHotkeys = async () => {
    if (!isTauri || savingConfig) return;
    setSavingConfig(true);
    try {
      await onUpdateConfig({
        ...config,
        hotkeyAlwaysOnTop: hkTop.trim() || 'Ctrl+Shift+T',
        hotkeyColorPicker: hkColor.trim() || 'Ctrl+Shift+C',
        hotkeyPlainText: hkPlain.trim() || 'Ctrl+Alt+V',
        hotkeyOcr: hkOcr.trim() || 'Ctrl+Shift+E',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleTool = async (
    field:
      | 'alwaysOnTopEnabled'
      | 'colorPickerEnabled'
      | 'plainTextEnabled'
      | 'ocrEnabled'
      | 'findMyMouseEnabled'
      | 'keyRemapperEnabled'
  ) => {
    if (!isTauri || savingConfig) return;
    setSavingConfig(true);
    try {
      await onUpdateConfig({
        ...config,
        [field]: !config[field],
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCopyText = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedText(text);
    window.setTimeout(() => setCopiedText(null), 1400);
  };

  // --- Env Vars helpers ---
  const filteredEnvVars = useMemo(() => {
    const q = envSearch.trim().toLowerCase();
    return envVars.filter((v) => {
      if (envScopeFilter !== 'all' && v.scope !== envScopeFilter) return false;
      if (!q) return true;
      return v.key.toLowerCase().includes(q) || v.value.toLowerCase().includes(q);
    });
  }, [envVars, envScopeFilter, envSearch]);

  const startEditingVar = (entry: EnvVarEntry) => {
    const looksLikePath =
      entry.key.toLowerCase() === 'path' ||
      entry.key.toLowerCase() === 'pathext' ||
      entry.value.includes(';');
    setEditingVar(entry);
    setIsPathMode(looksLikePath);
    if (looksLikePath) {
      const parts = entry.value
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      setEditLines(parts.length > 0 ? parts : ['']);
    } else {
      setEditSingleVal(entry.value);
    }
  };

  const handleSaveEditedVar = async () => {
    if (!editingVar || !isTauri || savingEnv) return;
    const finalValue = isPathMode
      ? editLines
          .map((l) => l.trim())
          .filter(Boolean)
          .join(';')
      : editSingleVal;

    setSavingEnv(true);
    try {
      await tauriBridge.saveEnvVar(editingVar.scope, editingVar.key, finalValue);
      setEditingVar(null);
      await loadEnvVars();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('ERR', `Falha ao salvar variável "${editingVar.key}": ${msg}`);
    } finally {
      setSavingEnv(false);
    }
  };

  const handleAddNewEnvVar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isTauri || !newEnvKey.trim() || savingEnv) return;
    setSavingEnv(true);
    try {
      await tauriBridge.saveEnvVar(newEnvScope, newEnvKey.trim(), newEnvVal);
      setNewEnvKey('');
      setNewEnvVal('');
      setShowAddEnv(false);
      await loadEnvVars();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('ERR', `Falha ao criar variável: ${msg}`);
    } finally {
      setSavingEnv(false);
    }
  };

  const handleDeleteEnvVar = async (entry: EnvVarEntry) => {
    if (!isTauri || savingEnv) return;
    setSavingEnv(true);
    try {
      await tauriBridge.deleteEnvVar(entry.scope, entry.key);
      if (editingVar?.key === entry.key && editingVar?.scope === entry.scope) {
        setEditingVar(null);
      }
      await loadEnvVars();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('ERR', `Falha ao remover variável "${entry.key}": ${msg}`);
    } finally {
      setSavingEnv(false);
    }
  };

  // --- Hosts Editor helpers ---
  const filteredHosts = useMemo(() => {
    const q = hostsSearch.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.ip.toLowerCase().includes(q) ||
        h.domain.toLowerCase().includes(q) ||
        h.comment.toLowerCase().includes(q)
    );
  }, [hosts, hostsSearch]);

  const handleAddHostEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const ip = newHostIp.trim();
    const domain = newHostDomain.trim();
    if (!ip || !domain) return;
    setHosts((prev) => [
      ...prev,
      {
        id: `host_new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ip,
        domain,
        comment: newHostComment.trim(),
        enabled: true,
      },
    ]);
    setNewHostDomain('');
    setNewHostComment('');
    setHostsDirty(true);
    setHostsError(null);
  };

  const handleToggleHostEntry = (id: string) => {
    setHosts((prev) => prev.map((h) => (h.id === id ? { ...h, enabled: !h.enabled } : h)));
    setHostsDirty(true);
  };

  const handleDeleteHostEntry = (id: string) => {
    setHosts((prev) => prev.filter((h) => h.id !== id));
    setHostsDirty(true);
  };

  const handleSaveHosts = async () => {
    if (!isTauri || savingHosts) return;
    setSavingHosts(true);
    setHostsError(null);
    try {
      await tauriBridge.saveHostsFile(hosts);
      setHostsDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHostsError(msg);
      onLog('ERR', `Hosts Editor: ${msg}`);
    } finally {
      setSavingHosts(false);
    }
  };

  // --- Batch Image Resizer helpers ---
  const applyImagePreset = (preset: (typeof IMAGE_PRESETS)[number]) => {
    setActivePreset(preset.id);
    setImgWidth(preset.width);
    setImgHeight(preset.height);
    setImgFormat(preset.format);
    setImgQuality(preset.quality);
  };

  const handlePickImages = async () => {
    if (!isTauri) return;
    const picked = await tauriBridge.pickImageFiles();
    if (picked.length > 0) {
      setImagePaths((prev) => Array.from(new Set([...prev, ...picked])));
    }
  };

  const handleRunBatchResize = async () => {
    if (!isTauri || imagePaths.length === 0 || resizingImages) return;
    setResizingImages(true);
    setLastResizeResult(null);
    try {
      const result = await tauriBridge.batchResizeImages(
        imagePaths,
        Math.max(0, Math.round(imgWidth || 0)),
        Math.max(0, Math.round(imgHeight || 0)),
        imgFormat,
        imgQuality
      );
      setLastResizeResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('ERR', `Batch Image Resizer: ${msg}`);
    } finally {
      setResizingImages(false);
    }
  };

  // --- Key Remapper helpers ---
  const handleAddKeyRemap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFromKey || !newToKey || newFromKey === newToKey) return;
    const filtered = keyRemaps.filter(
      (r) => r.from_key.toLowerCase() !== newFromKey.toLowerCase()
    );
    await onUpdateKeyRemaps([
      ...filtered,
      { from_key: newFromKey, to_key: newToKey, enabled: true },
    ]);
  };

  const handleQuickCapsToEsc = async () => {
    const filtered = keyRemaps.filter((r) => r.from_key.toLowerCase() !== 'capslock');
    await onUpdateKeyRemaps([
      ...filtered,
      { from_key: 'CapsLock', to_key: 'Escape', enabled: true },
    ]);
  };

  const handleToggleKeyRemap = async (idx: number) => {
    const next = keyRemaps.map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r));
    await onUpdateKeyRemaps(next);
  };

  const handleDeleteKeyRemap = async (idx: number) => {
    const next = keyRemaps.filter((_, i) => i !== idx);
    await onUpdateKeyRemaps(next);
  };

  const subTabs: { id: PowerToolsSubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'tools', label: 'Tools', icon: <Zap className="h-3 w-3" /> },
    { id: 'env', label: 'Env', icon: <Variable className="h-3 w-3" /> },
    { id: 'hosts', label: 'Hosts', icon: <FileCode2 className="h-3 w-3" /> },
    { id: 'images', label: 'Images', icon: <ImageIcon className="h-3 w-3" /> },
    { id: 'mouse', label: 'Mouse', icon: <Crosshair className="h-3 w-3" /> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#313244] pb-2">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-[#cba6f7]" />
          <h2 className="font-mono text-xs font-bold text-[#cba6f7]">[07] POWERTOOLS</h2>
        </div>
        <span className="font-mono text-[10px] text-[#7f849c]">Native Win32 + WinRT</span>
      </div>

      {/* Compact 5-module Sub-Tab Switcher */}
      <div className="grid grid-cols-5 border border-[#313244] bg-[#181825] p-0.5 font-mono text-[9px]">
        {subTabs.map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#cba6f7] font-bold text-[#11111b]'
                  : 'text-[#a6adc8] hover:bg-[#1e1e2e] hover:text-[#cdd6f4]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {!isTauri && (
        <div className="border border-[#fab387]/40 bg-[#fab387]/10 px-3 py-2 font-mono text-[10px] text-[#fab387]">
          OCR WinRT, Hosts Editor, Image Resizer, Mouse Utilities e Key Remapper rodam nativamente no WinForge.exe.
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 1: TOOLS (Awake, OCR Text Extractor, Top, Color, Plain)   */}
      {/* ================================================================= */}
      {subTab === 'tools' && (
        <>
          <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#cba6f7]">
                <Keyboard className="h-3 w-3" />
                UTILITÁRIOS &amp; ATALHOS GLOBAIS
              </span>
              {hotkeysDirty && (
                <button
                  type="button"
                  onClick={handleSaveHotkeys}
                  disabled={!isTauri || savingConfig}
                  className="flex items-center gap-1 border border-[#a6e3a1] bg-[#a6e3a1] px-2 py-0.5 font-mono text-[9px] font-bold text-[#11111b] cursor-pointer"
                >
                  <Save className="h-2.5 w-2.5" />
                  <span>Salvar Atalhos</span>
                </button>
              )}
            </div>

            {/* 1. Text Extractor (Native Windows 11 WinRT OCR) */}
            <div className="flex flex-col gap-2 border border-[#cba6f7]/50 bg-[#1e1e2e] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <TuiCheckbox
                    checked={config.ocrEnabled}
                    onChange={() => void handleToggleTool('ocrEnabled')}
                    ariaLabel="Ativar atalho Text Extractor OCR"
                    disabled={!isTauri || disabled}
                  />
                  <ScanText className="h-3.5 w-3.5 shrink-0 text-[#cba6f7]" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-semibold text-[#cdd6f4]">
                      Text Extractor (OCR Win11)
                    </span>
                    <input
                      type="text"
                      value={hkOcr}
                      onChange={(e) => setHkOcr(e.target.value)}
                      disabled={!isTauri}
                      className="mt-0.5 w-28 border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px] text-[#89b4fa] focus:border-[#cba6f7] focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void onTriggerOcrCapture()}
                  disabled={!isTauri || disabled}
                  className="shrink-0 bg-[#cba6f7] px-2.5 py-1.5 font-mono text-[9px] font-bold text-[#11111b] hover:bg-[#d8b8ff] disabled:opacity-40 cursor-pointer"
                >
                  OCR CAPTURE
                </button>
              </div>

              {lastOcr && (
                <div className="flex flex-col gap-1 border border-[#313244] bg-[#181825] p-2">
                  <div className="flex items-center justify-between font-mono text-[9px] text-[#7f849c]">
                    <span>
                      Último OCR ({lastOcr.timestamp}) · {lastOcr.lineCount}L / {lastOcr.charCount}c
                    </span>
                    {lastOcr.text && (
                      <button
                        type="button"
                        onClick={() => handleCopyText(lastOcr.text)}
                        className="flex items-center gap-1 text-[#a6e3a1] hover:underline cursor-pointer"
                      >
                        {copiedText === lastOcr.text ? (
                          <Check className="h-2.5 w-2.5" />
                        ) : (
                          <Copy className="h-2.5 w-2.5" />
                        )}
                        <span>{copiedText === lastOcr.text ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    )}
                  </div>
                  <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-[#cdd6f4]">
                    {lastOcr.text || '(Nenhum texto reconhecido na área selecionada)'}
                  </pre>
                </div>
              )}
            </div>

            {/* 2. Awake */}
            <div className="flex flex-col gap-1.5 border border-[#313244] bg-[#1e1e2e] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Coffee
                    className={`h-3.5 w-3.5 ${
                      config.awakeEnabled ? 'text-[#a6e3a1]' : 'text-[#6c7086]'
                    }`}
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-[#cdd6f4]">Awake (Sem Suspensão)</span>
                    <span className="font-mono text-[9px] text-[#7f849c]">
                      SetThreadExecutionState
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!isTauri || disabled}
                  onClick={() => onToggleAwake(!config.awakeEnabled, config.awakeKeepScreenOn)}
                  className={`border px-2.5 py-1 font-mono text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-40 ${
                    config.awakeEnabled
                      ? 'border-[#a6e3a1] bg-[#a6e3a1]/15 text-[#a6e3a1]'
                      : 'border-[#313244] text-[#7f849c] hover:text-[#cdd6f4]'
                  }`}
                >
                  {config.awakeEnabled ? 'ATIVO' : 'OFF'}
                </button>
              </div>

              <div
                onClick={() => {
                  if (!isTauri || disabled) return;
                  void onToggleAwake(config.awakeEnabled, !config.awakeKeepScreenOn);
                }}
                className="flex cursor-pointer items-center gap-2 pl-5 font-mono text-[10px] text-[#a6adc8]"
              >
                <TuiCheckbox
                  checked={config.awakeKeepScreenOn}
                  onChange={(next) => {
                    if (isTauri && !disabled) {
                      void onToggleAwake(config.awakeEnabled, next);
                    }
                  }}
                  ariaLabel="Manter tela ligada no modo Awake"
                  disabled={!isTauri || disabled}
                />
                <span>Manter tela ligada (ES_DISPLAY_REQUIRED)</span>
              </div>
            </div>

            {/* 3. Always on Top */}
            <div className="flex items-center justify-between gap-2 border border-[#313244] bg-[#1e1e2e] p-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <TuiCheckbox
                  checked={config.alwaysOnTopEnabled}
                  onChange={() => void handleToggleTool('alwaysOnTopEnabled')}
                  ariaLabel="Ativar atalho Always on Top"
                  disabled={!isTauri || disabled}
                />
                <Pin className="h-3.5 w-3.5 shrink-0 text-[#fab387]" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-[#cdd6f4]">Always on Top</span>
                  <input
                    type="text"
                    value={hkTop}
                    onChange={(e) => setHkTop(e.target.value)}
                    disabled={!isTauri}
                    className="mt-0.5 w-28 border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px] text-[#89b4fa] focus:border-[#cba6f7] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void onTriggerAlwaysOnTop()}
                disabled={!isTauri || disabled}
                className="shrink-0 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[9px] text-[#fab387] hover:border-[#fab387] disabled:opacity-40 cursor-pointer"
              >
                Alternar
              </button>
            </div>

            {/* 4. Color Picker */}
            <div className="flex items-center justify-between gap-2 border border-[#313244] bg-[#1e1e2e] p-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <TuiCheckbox
                  checked={config.colorPickerEnabled}
                  onChange={() => void handleToggleTool('colorPickerEnabled')}
                  ariaLabel="Ativar atalho Color Picker"
                  disabled={!isTauri || disabled}
                />
                <Pipette className="h-3.5 w-3.5 shrink-0 text-[#cba6f7]" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-[#cdd6f4]">Color Picker</span>
                  <input
                    type="text"
                    value={hkColor}
                    onChange={(e) => setHkColor(e.target.value)}
                    disabled={!isTauri}
                    className="mt-0.5 w-28 border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px] text-[#89b4fa] focus:border-[#cba6f7] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void onTriggerPickColor()}
                disabled={!isTauri || disabled}
                className="shrink-0 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[9px] text-[#cba6f7] hover:border-[#cba6f7] disabled:opacity-40 cursor-pointer"
              >
                Capturar
              </button>
            </div>

            {/* 5. Plain Text Paste */}
            <div className="flex items-center justify-between gap-2 border border-[#313244] bg-[#1e1e2e] p-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <TuiCheckbox
                  checked={config.plainTextEnabled}
                  onChange={() => void handleToggleTool('plainTextEnabled')}
                  ariaLabel="Ativar atalho Plain Text Paste"
                  disabled={!isTauri || disabled}
                />
                <ClipboardType className="h-3.5 w-3.5 shrink-0 text-[#a6e3a1]" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-[#cdd6f4]">
                    Plain Text Paste
                  </span>
                  <input
                    type="text"
                    value={hkPlain}
                    onChange={(e) => setHkPlain(e.target.value)}
                    disabled={!isTauri}
                    className="mt-0.5 w-28 border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px] text-[#89b4fa] focus:border-[#cba6f7] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void onTriggerPlainTextPaste()}
                disabled={!isTauri || disabled}
                className="shrink-0 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[9px] text-[#a6e3a1] hover:border-[#a6e3a1] disabled:opacity-40 cursor-pointer"
              >
                Colar Puro
              </button>
            </div>
          </section>

          {/* Color Picker History */}
          <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#a6adc8]">
                <Pipette className="h-3 w-3 text-[#cba6f7]" />
                HISTÓRICO DO COLOR PICKER ({colorHistory.length})
              </span>
              {colorHistory.length > 0 && (
                <button
                  type="button"
                  onClick={onClearColorHistory}
                  className="font-mono text-[9px] text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>

            {colorHistory.length === 0 ? (
              <div className="border border-[#313244] bg-[#1e1e2e]/60 p-3 text-center font-mono text-[10px] text-[#7f849c]">
                Pressione <span className="text-[#89b4fa]">{config.hotkeyColorPicker}</span> para capturar HEX/RGB/HSL sob o cursor.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {colorHistory.map((c, idx) => (
                  <div
                    key={`${c.hex}_${c.timestamp}_${idx}`}
                    className="flex items-center justify-between gap-2 border border-[#313244] bg-[#1e1e2e] px-2.5 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className="h-7 w-7 shrink-0 border border-[#cdd6f4]/30"
                        style={{ backgroundColor: c.hex }}
                      />
                      <div className="flex min-w-0 flex-col font-mono">
                        <span className="text-[11px] font-bold text-[#cdd6f4]">{c.hex}</span>
                        <span className="truncate text-[9px] text-[#89b4fa]">{c.rgb}</span>
                        <span className="truncate text-[9px] text-[#7f849c]">{c.hsl}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {[
                        { label: 'HEX', val: c.hex },
                        { label: 'RGB', val: c.rgb },
                        { label: 'HSL', val: c.hsl },
                      ].map((fmt) => (
                        <button
                          key={fmt.label}
                          type="button"
                          onClick={() => handleCopyText(fmt.val)}
                          className="flex items-center gap-0.5 border border-[#313244] bg-[#181825] px-1.5 py-1 font-mono text-[8px] text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] cursor-pointer"
                        >
                          {copiedText === fmt.val ? (
                            <Check className="h-2.5 w-2.5 text-[#a6e3a1]" />
                          ) : (
                            <Copy className="h-2.5 w-2.5" />
                          )}
                          <span>{fmt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 2: ENV VARS & VISUAL PATH EDITOR                          */}
      {/* ================================================================= */}
      {subTab === 'env' && (
        <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#cba6f7]">
              <Variable className="h-3 w-3" />
              VARIÁVEIS DE AMBIENTE &amp; PATH
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void loadEnvVars()}
                disabled={!isTauri || loadingEnv}
                title="Recarregar variáveis do Registro"
                className="border border-[#313244] bg-[#1e1e2e] p-1 text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${loadingEnv ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setShowAddEnv((v) => !v)}
                disabled={!isTauri}
                className="flex items-center gap-1 border border-[#cba6f7]/60 bg-[#cba6f7]/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] disabled:opacity-40 cursor-pointer"
              >
                {showAddEnv ? <X className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                <span>{showAddEnv ? 'Fechar' : 'Nova'}</span>
              </button>
            </div>
          </div>

          {showAddEnv && (
            <form
              onSubmit={handleAddNewEnvVar}
              className="flex flex-col gap-2 border border-[#cba6f7]/60 bg-[#1e1e2e] p-2.5"
            >
              <div className="grid grid-cols-2 border border-[#313244] bg-[#181825] p-0.5 font-mono text-[9px]">
                <button
                  type="button"
                  onClick={() => setNewEnvScope('user')}
                  className={`py-1 cursor-pointer ${
                    newEnvScope === 'user'
                      ? 'bg-[#cba6f7] font-bold text-[#11111b]'
                      : 'text-[#a6adc8]'
                  }`}
                >
                  USER (HKCU)
                </button>
                <button
                  type="button"
                  onClick={() => setNewEnvScope('system')}
                  className={`py-1 cursor-pointer ${
                    newEnvScope === 'system'
                      ? 'bg-[#fab387] font-bold text-[#11111b]'
                      : 'text-[#a6adc8]'
                  }`}
                >
                  SYSTEM (HKLM)
                </button>
              </div>
              <input
                type="text"
                value={newEnvKey}
                onChange={(e) => setNewEnvKey(e.target.value)}
                placeholder="NOME_DA_VARIAVEL"
                className="border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[11px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
                required
              />
              <input
                type="text"
                value={newEnvVal}
                onChange={(e) => setNewEnvVal(e.target.value)}
                placeholder="Valor (use ; para múltiplos caminhos)"
                className="border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[11px] text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingEnv}
                className="bg-[#cba6f7] py-1.5 font-mono text-[10px] font-bold text-[#11111b] hover:bg-[#d8b8ff] disabled:opacity-40 cursor-pointer"
              >
                {savingEnv ? 'Salvando...' : 'Gravar + Broadcast WM_SETTINGCHANGE'}
              </button>
            </form>
          )}

          {editingVar && (
            <div className="flex flex-col gap-2 border border-[#a6e3a1]/60 bg-[#1e1e2e] p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className="border border-[#313244] bg-[#181825] px-1 py-0.5 text-[8px] uppercase text-[#fab387]">
                    {editingVar.scope}
                  </span>
                  <span className="font-bold text-[#cdd6f4]">{editingVar.key}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingVar(null)}
                  className="text-[#6c7086] hover:text-[#cdd6f4] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {isPathMode ? (
                <div className="flex flex-col gap-1.5">
                  <span className="font-mono text-[9px] text-[#7f849c]">
                    Edição linha por linha (separado por ;)
                  </span>
                  <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
                    {editLines.map((line, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <input
                          type="text"
                          value={line}
                          onChange={(e) => {
                            const next = [...editLines];
                            next[idx] = e.target.value;
                            setEditLines(next);
                          }}
                          className="flex-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#a6e3a1] focus:border-[#cba6f7] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setEditLines((prev) => prev.filter((_, i) => i !== idx))
                          }
                          title="Remover linha"
                          className="p-1 text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditLines((prev) => [...prev, ''])}
                    className="flex items-center justify-center gap-1 border border-dashed border-[#45475a] py-1 font-mono text-[10px] text-[#cba6f7] hover:border-[#cba6f7] cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Adicionar caminho</span>
                  </button>
                </div>
              ) : (
                <textarea
                  rows={3}
                  value={editSingleVal}
                  onChange={(e) => setEditSingleVal(e.target.value)}
                  className="w-full border border-[#313244] bg-[#181825] p-2 font-mono text-[10px] text-[#a6e3a1] focus:border-[#cba6f7] focus:outline-none"
                />
              )}

              <button
                type="button"
                onClick={handleSaveEditedVar}
                disabled={savingEnv}
                className="flex items-center justify-center gap-1.5 bg-[#a6e3a1] py-1.5 font-mono text-[10px] font-bold text-[#11111b] hover:bg-[#b7ebb3] disabled:opacity-40 cursor-pointer"
              >
                {savingEnv ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                <span>Salvar no Registro</span>
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-3 border border-[#313244] bg-[#1e1e2e] p-0.5 font-mono text-[9px]">
              {(
                [
                  ['all', 'Todos'],
                  ['user', 'USER (HKCU)'],
                  ['system', 'SYSTEM (HKLM)'],
                ] as const
              ).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setEnvScopeFilter(val)}
                  className={`py-1 cursor-pointer ${
                    envScopeFilter === val
                      ? 'bg-[#cba6f7] font-bold text-[#11111b]'
                      : 'text-[#a6adc8]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#6c7086]" />
              <input
                type="text"
                value={envSearch}
                onChange={(e) => setEnvSearch(e.target.value)}
                placeholder="Buscar variável (ex: PATH, JAVA_HOME, CARGO)..."
                className="w-full border border-[#313244] bg-[#1e1e2e] py-1.5 pl-7 pr-2 font-mono text-[10px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              />
            </div>
          </div>

          {loadingEnv ? (
            <div className="flex items-center justify-center gap-2 p-4 font-mono text-[10px] text-[#7f849c]">
              <Loader2 className="h-3 w-3 animate-spin text-[#cba6f7]" />
              <span>Lendo HKCU &amp; HKLM Environment...</span>
            </div>
          ) : filteredEnvVars.length === 0 ? (
            <div className="border border-[#313244] bg-[#1e1e2e]/60 p-3 text-center font-mono text-[10px] text-[#7f849c]">
              {isTauri
                ? 'Nenhuma variável encontrada para o filtro atual.'
                : 'Execute no Windows para listar e editar variáveis do Registro.'}
            </div>
          ) : (
            <div className="max-h-72 divide-y divide-[#313244] overflow-y-auto border border-[#313244] bg-[#1e1e2e]">
              {filteredEnvVars.map((entry) => {
                const isPath = entry.key.toLowerCase() === 'path';
                return (
                  <div
                    key={`${entry.scope}_${entry.key}`}
                    className="flex items-center justify-between gap-2 px-2.5 py-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`shrink-0 font-mono text-[8px] uppercase ${
                            entry.scope === 'system' ? 'text-[#fab387]' : 'text-[#89b4fa]'
                          }`}
                        >
                          [{entry.scope}]
                        </span>
                        <span
                          className={`truncate font-mono text-[11px] font-semibold ${
                            isPath ? 'text-[#cba6f7]' : 'text-[#cdd6f4]'
                          }`}
                        >
                          {entry.key}
                        </span>
                      </div>
                      <span className="truncate font-mono text-[9px] text-[#7f849c]">
                        {entry.value}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditingVar(entry)}
                        title="Editar variável"
                        className="border border-[#313244] bg-[#181825] p-1 text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] cursor-pointer"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                      {!isPath && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteEnvVar(entry)}
                          title="Remover variável"
                          className="border border-[#313244] bg-[#181825] p-1 text-[#6c7086] hover:border-[#f38ba8] hover:text-[#f38ba8] cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 3: HOSTS EDITOR (C:\Windows\System32\drivers\etc\hosts)   */}
      {/* ================================================================= */}
      {subTab === 'hosts' && (
        <section className="flex flex-col gap-2.5 border border-[#313244] bg-[#181825] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#cba6f7]">
                <FileCode2 className="h-3 w-3" />
                HOSTS EDITOR
              </span>
              <span className="font-mono text-[9px] text-[#7f849c]">
                C:\Windows\System32\drivers\etc\hosts (backup .bak)
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void loadHosts()}
                disabled={!isTauri || loadingHosts}
                title="Recarregar arquivo hosts"
                className="border border-[#313244] bg-[#1e1e2e] p-1 text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${loadingHosts ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => void handleSaveHosts()}
                disabled={!isTauri || savingHosts || !hostsDirty}
                className={`flex items-center gap-1 px-2.5 py-1 font-mono text-[9px] font-bold transition-colors cursor-pointer disabled:opacity-40 ${
                  hostsDirty
                    ? 'bg-[#a6e3a1] text-[#11111b] hover:bg-[#b7ebb3]'
                    : 'border border-[#313244] bg-[#1e1e2e] text-[#6c7086]'
                }`}
              >
                {savingHosts ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Save className="h-2.5 w-2.5" />
                )}
                <span>Salvar{hostsDirty ? '*' : ''}</span>
              </button>
            </div>
          </div>

          {hostsError && (
            <div className="border border-[#f38ba8]/50 bg-[#f38ba8]/10 px-2.5 py-1.5 font-mono text-[10px] text-[#f38ba8]">
              {hostsError}
            </div>
          )}

          {/* Add New Host Entry Form */}
          <form
            onSubmit={handleAddHostEntry}
            className="flex flex-col gap-1.5 border border-[#313244] bg-[#1e1e2e] p-2.5"
          >
            <span className="font-mono text-[9px] font-semibold text-[#a6adc8]">
              ADICIONAR ENTRADA IP → DOMÍNIO
            </span>
            <div className="grid grid-cols-12 gap-1.5">
              <input
                type="text"
                value={newHostIp}
                onChange={(e) => setNewHostIp(e.target.value)}
                placeholder="127.0.0.1"
                className="col-span-5 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#89b4fa] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
                required
              />
              <input
                type="text"
                value={newHostDomain}
                onChange={(e) => setNewHostDomain(e.target.value)}
                placeholder="app.local"
                className="col-span-7 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
                required
              />
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newHostComment}
                onChange={(e) => setNewHostComment(e.target.value)}
                placeholder="Comentário opcional (ex: Dev API)"
                className="flex-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#7f849c] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              />
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#cba6f7] px-2.5 py-1 font-mono text-[10px] font-bold text-[#11111b] hover:bg-[#d8b8ff] cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>Add</span>
              </button>
            </div>
          </form>

          {/* Search Bar */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#6c7086]" />
            <input
              type="text"
              value={hostsSearch}
              onChange={(e) => setHostsSearch(e.target.value)}
              placeholder="Buscar IP, domínio ou comentário..."
              className="w-full border border-[#313244] bg-[#1e1e2e] py-1.5 pl-7 pr-2 font-mono text-[10px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
            />
          </div>

          {/* Entries List */}
          {loadingHosts ? (
            <div className="flex items-center justify-center gap-2 p-4 font-mono text-[10px] text-[#7f849c]">
              <Loader2 className="h-3 w-3 animate-spin text-[#cba6f7]" />
              <span>Lendo arquivo hosts...</span>
            </div>
          ) : filteredHosts.length === 0 ? (
            <div className="border border-[#313244] bg-[#1e1e2e]/60 p-3 text-center font-mono text-[10px] text-[#7f849c]">
              {hosts.length === 0
                ? 'Nenhuma entrada de host carregada. Adicione acima ou clique em Recarregar.'
                : 'Nenhuma entrada corresponde à busca.'}
            </div>
          ) : (
            <div className="max-h-64 divide-y divide-[#313244] overflow-y-auto border border-[#313244] bg-[#1e1e2e]">
              {filteredHosts.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 ${
                    entry.enabled ? '' : 'opacity-55'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <TuiCheckbox
                      checked={entry.enabled}
                      onChange={() => handleToggleHostEntry(entry.id)}
                      ariaLabel={`Alternar host ${entry.domain}`}
                    />
                    <div className="flex min-w-0 flex-col font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-[#89b4fa]">{entry.ip}</span>
                        <span
                          className={`truncate text-[11px] font-medium ${
                            entry.enabled ? 'text-[#cdd6f4]' : 'line-through text-[#7f849c]'
                          }`}
                        >
                          {entry.domain}
                        </span>
                      </div>
                      {entry.comment && (
                        <span className="truncate text-[9px] text-[#6c7086]">
                          # {entry.comment}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteHostEntry(entry.id)}
                    title="Remover linha"
                    className="shrink-0 p-1 text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 4: BATCH IMAGE RESIZER & CONVERTER                        */}
      {/* ================================================================= */}
      {subTab === 'images' && (
        <section className="flex flex-col gap-2.5 border border-[#313244] bg-[#181825] p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#cba6f7]">
              <ImageIcon className="h-3 w-3" />
              BATCH IMAGE RESIZER &amp; CONVERTER
            </span>
            <span className="font-mono text-[9px] text-[#7f849c]">Rust image crate</span>
          </div>

          {/* Drag & Drop Zone */}
          <div
            onClick={() => void handlePickImages()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 border border-dashed p-4 text-center transition-colors ${
              isDraggingOver
                ? 'border-[#a6e3a1] bg-[#a6e3a1]/10 text-[#a6e3a1]'
                : 'border-[#45475a] bg-[#1e1e2e] text-[#a6adc8] hover:border-[#cba6f7]'
            }`}
          >
            <Upload className="h-4 w-4 text-[#cba6f7]" />
            <span className="font-mono text-[11px] font-semibold text-[#cdd6f4]">
              {isDraggingOver
                ? 'Solte as imagens aqui...'
                : 'Arraste imagens (PNG/JPG/WEBP) ou clique'}
            </span>
            <span className="flex items-center gap-1 font-mono text-[9px] text-[#7f849c]">
              <FolderOpen className="h-2.5 w-2.5" />
              <span>Mantém proporção (Lanczos3) · Salva na mesma pasta</span>
            </span>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] text-[#7f849c]">PRESETS RÁPIDOS</span>
            <div className="grid grid-cols-2 gap-1.5">
              {IMAGE_PRESETS.map((preset) => {
                const selected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyImagePreset(preset)}
                    className={`flex flex-col items-start border px-2 py-1.5 text-left font-mono transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#cba6f7] bg-[#cba6f7]/15 text-[#cba6f7]'
                        : 'border-[#313244] bg-[#1e1e2e] text-[#cdd6f4] hover:border-[#585b70]'
                    }`}
                  >
                    <span className="text-[10px] font-bold">{preset.label}</span>
                    <span className="text-[9px] text-[#7f849c]">{preset.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dimensions, Format & Quality Controls */}
          <div className="grid grid-cols-3 gap-1.5 border border-[#313244] bg-[#1e1e2e] p-2.5 font-mono">
            <label className="flex flex-col gap-0.5 text-[9px] text-[#7f849c]">
              <span>Largura max</span>
              <input
                type="number"
                min={0}
                max={8192}
                value={imgWidth}
                onChange={(e) => {
                  setActivePreset('custom');
                  setImgWidth(Number(e.target.value));
                }}
                className="border border-[#313244] bg-[#181825] px-1.5 py-1 text-[10px] text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[9px] text-[#7f849c]">
              <span>Altura max</span>
              <input
                type="number"
                min={0}
                max={8192}
                value={imgHeight}
                onChange={(e) => {
                  setActivePreset('custom');
                  setImgHeight(Number(e.target.value));
                }}
                className="border border-[#313244] bg-[#181825] px-1.5 py-1 text-[10px] text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[9px] text-[#7f849c]">
              <span>Formato</span>
              <select
                value={imgFormat}
                onChange={(e) => setImgFormat(e.target.value as 'png' | 'jpg' | 'webp')}
                className="border border-[#313244] bg-[#181825] px-1.5 py-1 text-[10px] text-[#a6e3a1] focus:border-[#cba6f7] focus:outline-none"
              >
                <option value="webp">WEBP</option>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
              </select>
            </label>

            <div className="col-span-3 flex items-center justify-between gap-2 pt-1">
              <span className="text-[9px] text-[#7f849c]">Qualidade ({imgQuality}%)</span>
              <input
                type="range"
                min={40}
                max={100}
                value={imgQuality}
                onChange={(e) => setImgQuality(Number(e.target.value))}
                className="h-1 flex-1 accent-[#cba6f7]"
              />
              <span className="text-[9px] text-[#6c7086]">0×0 = Original</span>
            </div>
          </div>

          {/* Queued Files */}
          {imagePaths.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between font-mono text-[9px] text-[#a6adc8]">
                <span>FILA ({imagePaths.length} imagem(ns))</span>
                <button
                  type="button"
                  onClick={() => {
                    setImagePaths([]);
                    setLastResizeResult(null);
                  }}
                  className="text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                >
                  Limpar fila
                </button>
              </div>
              <div className="max-h-32 divide-y divide-[#313244] overflow-y-auto border border-[#313244] bg-[#1e1e2e]">
                {imagePaths.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="truncate font-mono text-[10px] text-[#cdd6f4]" title={p}>
                      {getFileName(p)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setImagePaths((prev) => prev.filter((item) => item !== p))}
                      className="text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Convert Action */}
          <button
            type="button"
            onClick={() => void handleRunBatchResize()}
            disabled={!isTauri || imagePaths.length === 0 || resizingImages || disabled}
            className="flex items-center justify-center gap-1.5 bg-[#a6e3a1] py-2 font-mono text-[10px] font-bold text-[#11111b] hover:bg-[#b7ebb3] disabled:opacity-40 cursor-pointer"
          >
            {resizingImages ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>
              {resizingImages
                ? 'Processando lote...'
                : `CONVERTER ${imagePaths.length || 0} IMAGEM(NS) -> ${imgFormat.toUpperCase()}`}
            </span>
          </button>

          {/* Last Conversion Results */}
          {lastResizeResult && (
            <div className="flex flex-col gap-1 border border-[#a6e3a1]/40 bg-[#1e1e2e] p-2 font-mono text-[9px]">
              <div className="flex items-center justify-between text-[#a6e3a1]">
                <span>✓ {lastResizeResult.succeeded.length} convertida(s)</span>
                {lastResizeResult.failed.length > 0 && (
                  <span className="text-[#f38ba8]">✗ {lastResizeResult.failed.length} erro(s)</span>
                )}
              </div>
              {lastResizeResult.succeeded.slice(0, 4).map((item) => (
                <div
                  key={item.outputPath}
                  className="flex items-center justify-between gap-2 text-[#a6adc8]"
                >
                  <span className="truncate">{getFileName(item.outputPath)}</span>
                  <span className="shrink-0 text-[#89b4fa]">
                    {item.outputWidth}×{item.outputHeight} · {formatKb(item.outputBytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 5: MOUSE UTILITIES & SIMPLE KEY REMAPPER                  */}
      {/* ================================================================= */}
      {subTab === 'mouse' && (
        <>
          {/* Mouse Utilities */}
          <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#cba6f7]">
              <MousePointerClick className="h-3 w-3" />
              MOUSE UTILITIES (CLICK-THROUGH OVERLAY)
            </span>

            {/* Find My Mouse */}
            <div className="flex items-center justify-between gap-2 border border-[#313244] bg-[#1e1e2e] p-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <TuiCheckbox
                  checked={config.findMyMouseEnabled}
                  onChange={() => void handleToggleTool('findMyMouseEnabled')}
                  ariaLabel="Ativar Find My Mouse com duplo Ctrl"
                  disabled={!isTauri || disabled}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium text-[#cdd6f4]">Find My Mouse</span>
                  <span className="font-mono text-[9px] text-[#7f849c]">
                    Pressione Ctrl 2× rápido (&lt;400ms) para holofote
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void onTriggerFindMyMouse()}
                disabled={!isTauri || disabled}
                className="shrink-0 border border-[#cba6f7]/60 bg-[#181825] px-2 py-1 font-mono text-[9px] text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] disabled:opacity-40 cursor-pointer"
              >
                Holofote
              </button>
            </div>

            {/* Mouse Crosshair */}
            <div className="flex items-center justify-between gap-2 border border-[#313244] bg-[#1e1e2e] p-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Crosshair
                  className={`h-3.5 w-3.5 shrink-0 ${
                    config.mouseCrosshairEnabled ? 'text-[#a6e3a1]' : 'text-[#6c7086]'
                  }`}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium text-[#cdd6f4]">Mouse Crosshair</span>
                  <span className="font-mono text-[9px] text-[#7f849c]">
                    Linhas guias H/V acompanhando o ponteiro
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void onToggleMouseCrosshair(!config.mouseCrosshairEnabled)}
                disabled={!isTauri || disabled}
                className={`shrink-0 border px-2.5 py-1 font-mono text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-40 ${
                  config.mouseCrosshairEnabled
                    ? 'border-[#a6e3a1] bg-[#a6e3a1]/15 text-[#a6e3a1]'
                    : 'border-[#313244] text-[#7f849c] hover:text-[#cdd6f4]'
                }`}
              >
                {config.mouseCrosshairEnabled ? 'ATIVO' : 'OFF'}
              </button>
            </div>
          </section>

          {/* Simple Key Remapper */}
          <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TuiCheckbox
                  checked={config.keyRemapperEnabled}
                  onChange={() => void handleToggleTool('keyRemapperEnabled')}
                  ariaLabel="Ativar Key Remapper WH_KEYBOARD_LL"
                  disabled={!isTauri || disabled}
                />
                <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#cba6f7]">
                  <Keyboard className="h-3 w-3" />
                  SIMPLE KEY REMAPPER
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleQuickCapsToEsc()}
                disabled={disabled}
                className="border border-[#313244] bg-[#1e1e2e] px-1.5 py-0.5 font-mono text-[8px] text-[#89b4fa] hover:border-[#89b4fa] cursor-pointer"
              >
                + Caps→Esc
              </button>
            </div>

            <span className="font-mono text-[9px] text-[#7f849c]">
              Hook nativo WH_KEYBOARD_LL · Regras salvas em profile.json (key_remaps)
            </span>

            {/* Add Remap Rule Form */}
            <form
              onSubmit={(e) => void handleAddKeyRemap(e)}
              className="flex items-center gap-1.5 border border-[#313244] bg-[#1e1e2e] p-2"
            >
              <select
                value={newFromKey}
                onChange={(e) => setNewFromKey(e.target.value)}
                className="min-w-0 flex-1 border border-[#313244] bg-[#181825] px-1.5 py-1 font-mono text-[10px] text-[#fab387] focus:border-[#cba6f7] focus:outline-none"
              >
                {REMAP_KEY_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>

              <ArrowRight className="h-3 w-3 shrink-0 text-[#6c7086]" />

              <select
                value={newToKey}
                onChange={(e) => setNewToKey(e.target.value)}
                className="min-w-0 flex-1 border border-[#313244] bg-[#181825] px-1.5 py-1 font-mono text-[10px] text-[#a6e3a1] focus:border-[#cba6f7] focus:outline-none"
              >
                {REMAP_KEY_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={disabled || newFromKey === newToKey}
                className="flex shrink-0 items-center gap-1 bg-[#cba6f7] px-2 py-1 font-mono text-[10px] font-bold text-[#11111b] hover:bg-[#d8b8ff] disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>Add</span>
              </button>
            </form>

            {/* Active Remap Rules List */}
            {keyRemaps.length === 0 ? (
              <div className="border border-[#313244] bg-[#1e1e2e]/60 p-3 text-center font-mono text-[10px] text-[#7f849c]">
                Nenhum remapeamento configurado. Ex: mapeie CapsLock → Escape acima.
              </div>
            ) : (
              <div className="divide-y divide-[#313244] border border-[#313244] bg-[#1e1e2e]">
                {keyRemaps.map((rule, idx) => (
                  <div
                    key={`${rule.from_key}_${rule.to_key}_${idx}`}
                    className={`flex items-center justify-between gap-2 px-2.5 py-2 ${
                      rule.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <TuiCheckbox
                        checked={rule.enabled}
                        onChange={() => void handleToggleKeyRemap(idx)}
                        ariaLabel={`Alternar remapeamento ${rule.from_key} para ${rule.to_key}`}
                        disabled={disabled}
                      />
                      <span className="border border-[#313244] bg-[#181825] px-1.5 py-0.5 text-[10px] text-[#fab387]">
                        {rule.from_key}
                      </span>
                      <ArrowRight className="h-3 w-3 text-[#6c7086]" />
                      <span className="border border-[#313244] bg-[#181825] px-1.5 py-0.5 text-[10px] text-[#a6e3a1]">
                        {rule.to_key}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleDeleteKeyRemap(idx)}
                      title="Remover regra"
                      className="p-1 text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
