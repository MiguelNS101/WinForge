import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Terminal } from 'lucide-react';
import { DotfilesThemesTab } from './components/DotfilesThemesTab';
import { HarvestScopeFlags, HarvestTab } from './components/HarvestTab';
import { JsonEditorTab } from './components/JsonEditorTab';
import { PackagesTab } from './components/PackagesTab';
import { PkgManagerTab, PkgMgrSubTab } from './components/PkgManagerTab';
import { PowerToolsTab } from './components/PowerToolsTab';
import { SplashScreen } from './components/SplashScreen';
import { SystemDebloatTab } from './components/SystemDebloatTab';
import { TabNav } from './components/TabNav';
import { TerminalConsole } from './components/TerminalConsole';
import { WindowTitleBar } from './components/WindowTitleBar';
import { WintoysTab } from './components/WintoysTab';
import { EMPTY_PROFILE } from './data/defaultProfile';
import { tauriBridge } from './services/tauriBridge';
import {
  AutostartTask,
  DotfileMapping,
  ExternalScript,
  HarvestOptions,
  HarvestResult,
  KeyRemapRule,
  LogEntry,
  LogLevel,
  ModuleTab,
  OcrExtractResult,
  PickedColor,
  PipelineProgressEvent,
  PortableApp,
  PowerToolsConfig,
  ProvisionFinishedEvent,
  QuickMaintenanceAction,
  RegistryFile,
  ReverseSyncResult,
  RuntimeStatus,
  SystemTweak,
  WinForgeProfile,
  WingetInstalledItem,
  WingetPackage,
  WingetSearchItem,
  WingetUpdateItem,
} from './types/profile';
import { validateProfileJson } from './utils/profileValidator';

function makeLocalLog(level: LogLevel, stage: number, message: string): LogEntry {
  return {
    id: `ui_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toTimeString().slice(0, 8),
    level,
    stage,
    message,
  };
}

export default function App() {
  const [profile, setProfile] = useState<WinForgeProfile>(EMPTY_PROFILE);
  const [activeTab, setActiveTab] = useState<ModuleTab>('harvest');
  const [jsonValid, setJsonValid] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [lastHarvestResult, setLastHarvestResult] = useState<HarvestResult | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [lastFinished, setLastFinished] = useState<ProvisionFinishedEvent | null>(null);

  // UniGet Mode ([05] PKG MANAGER) state
  const [pkgMgrSubTab, setPkgMgrSubTab] = useState<PkgMgrSubTab>('updates');
  const [updates, setUpdates] = useState<WingetUpdateItem[]>([]);
  const [hasCheckedUpdates, setHasCheckedUpdates] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [searchResults, setSearchResults] = useState<WingetSearchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedPkgs, setInstalledPkgs] = useState<WingetInstalledItem[]>([]);
  const [hasLoadedInstalled, setHasLoadedInstalled] = useState(false);
  const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  // Reverse Sync & Quick Maintenance state
  const [isSyncingReverse, setIsSyncingReverse] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<ReverseSyncResult | null>(null);
  const [runningMaintenance, setRunningMaintenance] = useState<QuickMaintenanceAction | null>(null);

  // Wintoys ([06]) & PowerTools ([07]) state
  const [liveCpuPct, setLiveCpuPct] = useState<number | null>(null);
  const [colorHistory, setColorHistory] = useState<PickedColor[]>([]);
  const [lastOcr, setLastOcr] = useState<OcrExtractResult | null>(null);
  const [powerToolsConfig, setPowerToolsConfig] = useState<PowerToolsConfig>({
    awakeEnabled: false,
    awakeKeepScreenOn: true,
    alwaysOnTopEnabled: true,
    colorPickerEnabled: true,
    plainTextEnabled: true,
    ocrEnabled: true,
    findMyMouseEnabled: true,
    mouseCrosshairEnabled: false,
    keyRemapperEnabled: true,
    hotkeyAlwaysOnTop: 'Ctrl+Shift+T',
    hotkeyColorPicker: 'Ctrl+Shift+C',
    hotkeyPlainText: 'Ctrl+Alt+V',
    hotkeyOcr: 'Ctrl+Shift+E',
  });

  const profileRef = useRef<WinForgeProfile>(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Frameless portrait card window state
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [isMinimizedPreview, setIsMinimizedPreview] = useState(false);
  const [isClosedPreview, setIsClosedPreview] = useState(false);

  // Startup Splash Screen state (squish cat + WinForge display + progress bar)
  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const [splashProgress, setSplashProgress] = useState(0);
  const [splashStatus, setSplashStatus] = useState('Inicializando núcleo...');
  const splashTimersRef = useRef<number[]>([]);

  const [harvestScopeFlags, setHarvestScopeFlags] = useState<HarvestScopeFlags>({
    collectVault: true,
    collectDotfiles: true,
    collectWingetAndManualReport: true,
    collectVscodeExtensions: true,
  });

  const [runtime, setRuntime] = useState<RuntimeStatus>({
    isTauri: false,
    isAdmin: false,
    platform: 'Desktop Runtime Offline',
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [progressState, setProgressState] = useState<PipelineProgressEvent>({
    stage: 0,
    stageLabel: 'Aguardando execução',
    progress: 0,
    status: 'idle',
  });

  const isRunning = progressState.status === 'running';
  const uiDisabled =
    isRunning ||
    isScanning ||
    isHarvesting ||
    isSyncingReverse ||
    Boolean(runningMaintenance) ||
    isUpgrading ||
    Boolean(installingId) ||
    Boolean(uninstallingId);

  const appendLog = useCallback((level: LogLevel, stage: number, message: string) => {
    setLogs((prev) => [...prev, makeLocalLog(level, stage, message)]);
  }, []);

  const clearSplashTimers = useCallback(() => {
    splashTimersRef.current.forEach((id) => window.clearTimeout(id));
    splashTimersRef.current = [];
  }, []);

  const playSplashSequence = useCallback(
    (onBootCheck?: () => Promise<void>) => {
      clearSplashTimers();
      setShowSplash(true);
      setSplashFading(false);
      setSplashProgress(10);
      setSplashStatus('Inicializando núcleo...');

      const schedule = (ms: number, fn: () => void) => {
        const id = window.setTimeout(fn, ms);
        splashTimersRef.current.push(id);
      };

      const bootPromise = onBootCheck ? onBootCheck().catch(() => undefined) : Promise.resolve();

      schedule(260, () => {
        setSplashProgress(38);
        setSplashStatus('Verificando privilégios UAC...');
      });

      schedule(680, () => {
        setSplashProgress(72);
        setSplashStatus('Carregando manifesto...');
      });

      schedule(1120, async () => {
        await bootPromise;
        setSplashProgress(100);
        setSplashStatus('Pronto');

        schedule(340, () => {
          setSplashFading(true);
          schedule(320, () => {
            setShowSplash(false);
            setSplashFading(false);
          });
        });
      });
    },
    [clearSplashTimers]
  );

  // Initialize Tauri v2 desktop runtime, startup portable profile.json, and Rust event listeners
  useEffect(() => {
    let unlistenLog: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;
    let unlistenTray: (() => void) | undefined;
    let unlistenPowerTool: (() => void) | undefined;
    let cancelled = false;

    const runBootChecks = async () => {
      const status = await tauriBridge.checkAdminStatus();
      if (cancelled) return;
      setRuntime(status);

      if (!status.isTauri) {
        appendLog(
          'WARN',
          0,
          'Runtime desktop Tauri v2 não detectado. Você pode editar/importar/exportar profile.json aqui; para executar HARVEST, UniGet ou Provisionamento, abra o WinForge.exe no Windows.'
        );
        return;
      }

      appendLog(
        status.isAdmin ? 'OK' : 'WARN',
        0,
        status.isAdmin
          ? 'WinForge Portable inicializado com privilégios de Administrador (UAC elevado).'
          : 'WinForge inicializado sem privilégios elevados. Execute WinForge.exe como Administrador para aplicar tweaks HKLM, WinGet, sfc e backup de drivers.'
      );

      const startupProfile = await tauriBridge.loadStartupProfile();
      if (cancelled) return;
      if (startupProfile) {
        const validated = validateProfileJson(JSON.stringify(startupProfile));
        const normalized = validated.valid && validated.parsed ? validated.parsed : startupProfile;
        setProfile(normalized);
        setJsonValid(true);
        appendLog(
          'OK',
          0,
          `Manifesto portátil profile.json carregado automaticamente ("${normalized.profile_name}").`
        );
      } else {
        appendLog(
          'INFO',
          0,
          'Nenhum profile.json encontrado ao lado do executável. Importe um manifesto, use "Capturar Setup" ou gere um bundle em [00] HARVEST.'
        );
      }

      try {
        const ptConfig = await tauriBridge.getPowerToolsConfig();
        if (!cancelled) {
          setPowerToolsConfig(ptConfig);
        }
      } catch {
        // Ignore if not available
      }
    };

    playSplashSequence(runBootChecks);

    tauriBridge
      .onLog((entry) => {
        setLogs((prev) => [...prev, entry]);
      })
      .then((unlisten) => {
        unlistenLog = unlisten;
      });

    tauriBridge
      .onProgress((event) => {
        setProgressState(event);
      })
      .then((unlisten) => {
        unlistenProgress = unlisten;
      });

    tauriBridge
      .onFinished((summary) => {
        setLastFinished(summary);
      })
      .then((unlisten) => {
        unlistenFinished = unlisten;
      });

    tauriBridge
      .onTrayAction((action) => {
        if (action === 'check-updates') {
          setActiveTab('pkgmgr');
          setPkgMgrSubTab('updates');
          setIsCheckingUpdates(true);
          tauriBridge
            .wingetCheckUpdates()
            .then((items) => {
              setUpdates(items);
              setHasCheckedUpdates(true);
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              appendLog('ERR', 2, `Tray -> Checar Atualizações falhou: ${message}`);
            })
            .finally(() => {
              setIsCheckingUpdates(false);
            });
        } else if (action === 'sync-dotfiles') {
          setActiveTab('dotfiles');
          setIsSyncingReverse(true);
          tauriBridge
            .syncDotfilesReverse(profileRef.current)
            .then((res) => {
              setLastSyncResult(res);
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              appendLog('ERR', 3, `Tray -> Sync Dotfiles falhou: ${message}`);
            })
            .finally(() => {
              setIsSyncingReverse(false);
            });
        }
      })
      .then((unlisten) => {
        unlistenTray = unlisten;
      });

    tauriBridge
      .onPowerToolEvent((ev) => {
        if (ev.kind === 'color-picked' && ev.color) {
          const picked = ev.color;
          setColorHistory((prev) => [picked, ...prev].slice(0, 20));
        } else if (ev.kind === 'ocr-extracted' && ev.ocr) {
          setLastOcr(ev.ocr);
        }
      })
      .then((unlisten) => {
        unlistenPowerTool = unlisten;
      });

    return () => {
      cancelled = true;
      clearSplashTimers();
      unlistenLog?.();
      unlistenProgress?.();
      unlistenFinished?.();
      unlistenTray?.();
      unlistenPowerTool?.();
    };
  }, [appendLog, clearSplashTimers, playSplashSequence]);

  // Keep Rust WH_KEYBOARD_LL key remap table in sync with `profile.key_remaps`
  useEffect(() => {
    if (!runtime.isTauri) return;
    const rules = profile.key_remaps ?? [];
    void tauriBridge.syncKeyRemaps(rules).catch(() => undefined);
  }, [runtime.isTauri, profile.key_remaps]);

  // Frameless Window Controls
  const handleStartDragging = () => {
    if (runtime.isTauri) {
      void tauriBridge.windowStartDragging();
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    if (runtime.isTauri) {
      await tauriBridge.windowSetAlwaysOnTop(next);
    }
  };

  const handleMinimize = () => {
    if (runtime.isTauri) {
      void tauriBridge.windowMinimize();
    } else {
      setIsMinimizedPreview((v) => !v);
    }
  };

  const handleClose = () => {
    if (runtime.isTauri) {
      void tauriBridge.windowClose();
    } else {
      setIsClosedPreview(true);
    }
  };

  const handleReopenPreview = () => {
    setIsClosedPreview(false);
    setIsMinimizedPreview(false);
    playSplashSequence();
  };

  // Tab counts
  const counts = useMemo(() => {
    const harvestActive = [
      harvestScopeFlags.collectVault,
      harvestScopeFlags.collectDotfiles,
      harvestScopeFlags.collectWingetAndManualReport,
      harvestScopeFlags.collectVscodeExtensions,
      Boolean(profile.backup_wifi),
      Boolean(profile.backup_drivers),
    ].filter(Boolean).length;

    const portables = profile.portable_apps ?? [];
    const vscodeCount = (profile.vscode_extensions ?? []).length;
    const autostarts = profile.autostart_tasks ?? [];

    return {
      harvestActive,
      systemEnabled:
        profile.system_tweaks.filter((t) => t.enabled).length +
        profile.external_scripts.filter((s) => s.enabled).length +
        autostarts.filter((a) => a.enabled !== false).length,
      systemTotal:
        profile.system_tweaks.length + profile.external_scripts.length + autostarts.length,
      packagesEnabled:
        profile.winget_packages.filter((p) => p.enabled).length +
        portables.filter((p) => p.enabled).length +
        vscodeCount,
      packagesTotal: profile.winget_packages.length + portables.length + vscodeCount,
      dotfilesEnabled:
        profile.dotfiles.mappings.filter((m) => m.enabled).length +
        profile.registry_files.filter((r) => r.enabled).length,
      dotfilesTotal: profile.dotfiles.mappings.length + profile.registry_files.length,
      jsonValid,
      updatesAvailable: hasCheckedUpdates ? updates.length : null,
      cpuPct: liveCpuPct,
      awakeActive: powerToolsConfig.awakeEnabled,
    };
  }, [
    profile,
    harvestScopeFlags,
    jsonValid,
    hasCheckedUpdates,
    updates.length,
    liveCpuPct,
    powerToolsConfig.awakeEnabled,
  ]);

  const profilePackageIds = useMemo(
    () => new Set(profile.winget_packages.map((p) => p.id.toLowerCase())),
    [profile.winget_packages]
  );

  const applyImportedJson = (fileName: string, content: string) => {
    const result = validateProfileJson(content);
    if (!result.valid || !result.parsed) {
      appendLog('ERR', 0, `Falha ao importar "${fileName}": ${result.error}`);
      return;
    }
    setProfile(result.parsed);
    setJsonValid(true);
    appendLog(
      'OK',
      0,
      `Manifesto "${result.parsed.profile_name}" importado de ${fileName} (${result.parsed.winget_packages.length} pacotes, ${result.parsed.system_tweaks.length} tweaks).`
    );
    result.warnings.forEach((w) => appendLog('WARN', 0, w));
  };

  // Titlebar / Profile Actions
  const handleUpdateProfileMeta = (profile_name: string, author: string) => {
    setProfile((prev) => ({ ...prev, profile_name, author }));
    appendLog(
      'INFO',
      0,
      `Metadados atualizados: "${profile_name}"${author ? ` (autor: ${author})` : ''}.`
    );
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      applyImportedJson(file.name, content);
    };
    reader.onerror = () => {
      appendLog('ERR', 0, `Erro ao ler o arquivo local "${file.name}".`);
    };
    reader.readAsText(file);
  };

  const handleImportNative = async () => {
    try {
      const picked = await tauriBridge.openProfileFileNative();
      if (!picked) return;
      applyImportedJson(picked.name, picked.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 0, `Erro ao importar manifesto: ${message}`);
    }
  };

  const handleExportProfile = async () => {
    const json = JSON.stringify(profile, null, 2);
    const slug = profile.profile_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const filename = `${slug || 'profile'}.json`;

    if (runtime.isTauri) {
      try {
        const savedPath = await tauriBridge.saveProfileFileNative(filename, json);
        if (savedPath) {
          appendLog('OK', 0, `Manifesto salvo em "${savedPath}".`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog('ERR', 0, `Erro ao exportar manifesto: ${message}`);
      }
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    appendLog('OK', 0, `Manifesto exportado como "${filename}".`);
  };

  const handleScanCurrentSystem = async () => {
    if (isRunning || isScanning || isHarvesting) return;
    setIsScanning(true);
    try {
      const snapshot = await tauriBridge.scanCurrentSystem();
      setProfile(snapshot);
      setJsonValid(true);
      setActiveTab('packages');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 0, `Falha no Reverse Snapshot: ${message}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Module 00 (HARVEST) handlers
  const handleUpdateHarvestScopeFlags = (patch: Partial<HarvestScopeFlags>) => {
    setHarvestScopeFlags((prev) => ({ ...prev, ...patch }));
  };

  const handleUpdateHarvestFields = (patch: Partial<WinForgeProfile>) => {
    setProfile((prev) => ({ ...prev, ...patch }));
  };

  const handleRunHarvest = async (outputDir: string, options: HarvestOptions) => {
    if (isRunning || isScanning || isHarvesting) return;
    setIsHarvesting(true);
    try {
      const result = await tauriBridge.runHarvest(outputDir, options);
      setLastHarvestResult(result);
      setProfile(result.profile);
      setJsonValid(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 0, `Falha no modo HARVEST: ${message}`);
    } finally {
      setIsHarvesting(false);
    }
  };

  // Module 01 handlers
  const handleToggleRestorePoint = (create_restore_point: boolean) => {
    setProfile((prev) => ({ ...prev, create_restore_point }));
  };

  const handleToggleTweak = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      system_tweaks: prev.system_tweaks.map((t) =>
        t.id === id ? { ...t, enabled: !t.enabled } : t
      ),
    }));
  };

  const handleDeleteTweak = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      system_tweaks: prev.system_tweaks.filter((t) => t.id !== id),
    }));
    appendLog('INFO', 1, `Tweak "${id}" removido do manifesto.`);
  };

  const handleAddTweak = (tweak: SystemTweak) => {
    setProfile((prev) => ({
      ...prev,
      system_tweaks: [...prev.system_tweaks, tweak],
    }));
    appendLog('OK', 1, `Tweak customizado "${tweak.label}" (${tweak.id}) adicionado.`);
  };

  const handleToggleScript = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      external_scripts: prev.external_scripts.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    }));
  };

  const handleToggleScriptInteractive = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      external_scripts: prev.external_scripts.map((s) =>
        s.id === id ? { ...s, interactive: !s.interactive } : s
      ),
    }));
  };

  const handleDeleteScript = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      external_scripts: prev.external_scripts.filter((s) => s.id !== id),
    }));
    appendLog('INFO', 1, `Script externo "${id}" removido.`);
  };

  const handleAddScript = (script: ExternalScript) => {
    setProfile((prev) => ({
      ...prev,
      external_scripts: [...prev.external_scripts, script],
    }));
    appendLog('OK', 1, `Script externo "${script.label}" adicionado.`);
  };

  const handleToggleAutostart = (index: number) => {
    setProfile((prev) => ({
      ...prev,
      autostart_tasks: (prev.autostart_tasks ?? []).map((task, idx) =>
        idx === index ? { ...task, enabled: task.enabled === false } : task
      ),
    }));
  };

  const handleToggleAutostartAdmin = (index: number) => {
    setProfile((prev) => ({
      ...prev,
      autostart_tasks: (prev.autostart_tasks ?? []).map((task, idx) =>
        idx === index ? { ...task, run_as_admin: !task.run_as_admin } : task
      ),
    }));
  };

  const handleAddAutostart = (task: AutostartTask) => {
    setProfile((prev) => ({
      ...prev,
      autostart_tasks: [...(prev.autostart_tasks ?? []), task],
    }));
    appendLog(
      'OK',
      4,
      `Tarefa Autostart "${task.name}" adicionada${task.run_as_admin ? ' (/rl highest)' : ''}.`
    );
  };

  const handleDeleteAutostart = (index: number) => {
    setProfile((prev) => ({
      ...prev,
      autostart_tasks: (prev.autostart_tasks ?? []).filter((_, idx) => idx !== index),
    }));
    appendLog('INFO', 4, 'Tarefa Autostart removida do manifesto.');
  };

  const handleScanStartupTasks = async () => {
    if (uiDisabled) return;
    try {
      const found = await tauriBridge.scanStartupTasks();
      if (found.length === 0) return;
      setProfile((prev) => {
        const existing = prev.autostart_tasks ?? [];
        const existingExes = new Set(existing.map((t) => t.exe_path.trim().toLowerCase()));
        const merged = [...existing];
        for (const item of found) {
          if (!existingExes.has(item.exe_path.trim().toLowerCase())) {
            merged.push(item);
          }
        }
        return { ...prev, autostart_tasks: merged };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 4, `Falha ao escanear Startup: ${message}`);
    }
  };

  const handleDeployAutostartTasks = async () => {
    if (uiDisabled) return;
    try {
      await tauriBridge.deployAutostartTasks(profile.autostart_tasks ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 4, `Falha ao agendar tarefas Autostart: ${message}`);
    }
  };

  // Module 02 handlers (WinGet + Portable ZIP Apps + VS Code Extensions)
  const handleTogglePackage = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      winget_packages: prev.winget_packages.map((p) =>
        p.id === id ? { ...p, enabled: !p.enabled } : p
      ),
    }));
  };

  const handleToggleManyPackages = (ids: string[], enabled: boolean) => {
    const idSet = new Set(ids);
    setProfile((prev) => ({
      ...prev,
      winget_packages: prev.winget_packages.map((p) =>
        idSet.has(p.id) ? { ...p, enabled } : p
      ),
    }));
  };

  const handleAddPackage = (pkg: WingetPackage) => {
    setProfile((prev) => ({
      ...prev,
      winget_packages: [pkg, ...prev.winget_packages],
    }));
    appendLog('OK', 2, `Pacote WinGet "${pkg.id}" adicionado na categoria ${pkg.category}.`);
  };

  const handleDeletePackage = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      winget_packages: prev.winget_packages.filter((p) => p.id !== id),
    }));
    appendLog('INFO', 2, `Pacote "${id}" removido.`);
  };

  const handleTogglePortableApp = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      portable_apps: (prev.portable_apps ?? []).map((app) =>
        app.id === id ? { ...app, enabled: !app.enabled } : app
      ),
    }));
  };

  const handleTogglePortableAddToPath = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      portable_apps: (prev.portable_apps ?? []).map((app) =>
        app.id === id ? { ...app, add_to_path: !app.add_to_path } : app
      ),
    }));
  };

  const handleAddPortableApp = (app: PortableApp) => {
    setProfile((prev) => ({
      ...prev,
      portable_apps: [...(prev.portable_apps ?? []), app],
    }));
    appendLog(
      'OK',
      2,
      `Portable ZIP App "${app.name}" adicionado (destino: ${app.extract_to}${
        app.add_to_path ? ', +PATH' : ''
      }).`
    );
  };

  const handleUpdatePortableApp = (updated: PortableApp) => {
    setProfile((prev) => ({
      ...prev,
      portable_apps: (prev.portable_apps ?? []).map((app) =>
        app.id === updated.id ? updated : app
      ),
    }));
    appendLog('INFO', 2, `Portable ZIP App "${updated.name}" atualizado.`);
  };

  const handleDeletePortableApp = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      portable_apps: (prev.portable_apps ?? []).filter((app) => app.id !== id),
    }));
    appendLog('INFO', 2, `Portable ZIP App "${id}" removido.`);
  };

  const handleAddVscodeExtensions = (ids: string[]) => {
    setProfile((prev) => ({
      ...prev,
      vscode_extensions: [...(prev.vscode_extensions ?? []), ...ids],
    }));
    appendLog(
      'OK',
      2,
      `${ids.length} extensão(ões) VS Code adicionada(s): ${ids.join(', ')}.`
    );
  };

  const handleDeleteVscodeExtension = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      vscode_extensions: (prev.vscode_extensions ?? []).filter((ext) => ext !== id),
    }));
    appendLog('INFO', 2, `Extensão VS Code "${id}" removida.`);
  };

  const handleClearVscodeExtensions = () => {
    setProfile((prev) => ({ ...prev, vscode_extensions: [] }));
    appendLog('INFO', 2, 'Lista de extensões do VS Code limpa.');
  };

  // Module 03 handlers
  const handleUpdateRepoUrl = (repo_url: string) => {
    setProfile((prev) => ({
      ...prev,
      dotfiles: { ...prev.dotfiles, repo_url },
    }));
  };

  const handleToggleMapping = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      dotfiles: {
        ...prev.dotfiles,
        mappings: prev.dotfiles.mappings.map((m) =>
          m.id === id ? { ...m, enabled: !m.enabled } : m
        ),
      },
    }));
  };

  const handleAddMapping = (mapping: DotfileMapping) => {
    setProfile((prev) => ({
      ...prev,
      dotfiles: {
        ...prev.dotfiles,
        mappings: [...prev.dotfiles.mappings, mapping],
      },
    }));
    appendLog(
      'OK',
      3,
      `Mapeamento "${mapping.label}" (${mapping.source} -> ${mapping.target}) adicionado.`
    );
  };

  const handleDeleteMapping = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      dotfiles: {
        ...prev.dotfiles,
        mappings: prev.dotfiles.mappings.filter((m) => m.id !== id),
      },
    }));
    appendLog('INFO', 3, `Mapeamento "${id}" removido.`);
  };

  const handleToggleRegistryFile = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      registry_files: prev.registry_files.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r
      ),
    }));
  };

  const handleAddRegistryFile = (reg: RegistryFile) => {
    setProfile((prev) => ({
      ...prev,
      registry_files: [...prev.registry_files, reg],
    }));
    appendLog('OK', 4, `Arquivo de registro "${reg.path}" adicionado.`);
  };

  const handleDeleteRegistryFile = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      registry_files: prev.registry_files.filter((r) => r.id !== id),
    }));
    appendLog('INFO', 4, `Arquivo de registro "${id}" removido.`);
  };

  // Module 04 handler
  const handleApplyRawProfile = (updated: WinForgeProfile) => {
    setProfile(updated);
    appendLog('OK', 0, `Manifesto JSON aplicado diretamente para "${updated.profile_name}".`);
  };

  // Execution pipeline triggers (real Tauri backend only)
  const handleExecuteProvisioning = async () => {
    if (isRunning || isScanning || isHarvesting) return;
    setLastFinished(null);
    try {
      await tauriBridge.executeProvisioning(profile, dryRun);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 0, message);
    }
  };

  const handleRetryFailedItems = async () => {
    if (!lastFinished || isRunning || isScanning || isHarvesting) return;
    try {
      const failedProfile = await tauriBridge.loadFailedReport(
        lastFinished.failedReportPath,
        lastFinished.failedProfile
      );
      if (!failedProfile) {
        appendLog(
          'ERR',
          0,
          'Não foi possível carregar failed_report.json para reexecutar os itens com falha.'
        );
        return;
      }

      const count = Math.max(
        lastFinished.failureCount ?? 0,
        lastFinished.failed_count ?? 0
      );
      setProfile(failedProfile);
      setJsonValid(true);
      setDryRun(false);
      setLastFinished(null);
      appendLog(
        'WARN',
        0,
        `Carregado failed_report.json — reexecutando apenas os ${count} item(ns) que falharam...`
      );
      await tauriBridge.executeProvisioning(failedProfile, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 0, message);
    }
  };

  const handleAbortProvisioning = async () => {
    try {
      await tauriBridge.abortProvisioning();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 0, message);
    }
  };

  // Module 05 (UniGet Mode) handlers
  const handleCheckUpdates = async () => {
    if (isCheckingUpdates || uiDisabled) return;
    setIsCheckingUpdates(true);
    try {
      const items = await tauriBridge.wingetCheckUpdates();
      setUpdates(items);
      setHasCheckedUpdates(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 2, `Erro ao checar atualizações WinGet: ${message}`);
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleUpgradeSelected = async (ids: string[]) => {
    if (ids.length === 0 || uiDisabled) return;
    setIsUpgrading(true);
    try {
      const result = await tauriBridge.wingetUpgradePackages(ids);
      if (result.succeeded.length > 0) {
        const doneSet = new Set(result.succeeded.map((id) => id.toLowerCase()));
        setUpdates((prev) => prev.filter((item) => !doneSet.has(item.id.toLowerCase())));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 2, `Erro ao atualizar pacotes: ${message}`);
    } finally {
      setIsUpgrading(false);
    }
  };

  const handleSearchPackages = async (query: string) => {
    if (!query.trim() || isSearching || uiDisabled) return;
    setIsSearching(true);
    try {
      const results = await tauriBridge.wingetSearch(query);
      setSearchResults(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 2, `Erro na busca WinGet: ${message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleInstallSearchedPackage = async (item: WingetSearchItem, addToProfile: boolean) => {
    if (uiDisabled) return;
    setInstallingId(item.id);
    try {
      await tauriBridge.wingetInstallPackage(item.id, item.name);
      if (addToProfile) {
        const alreadyExists = profileRef.current.winget_packages.some(
          (p) => p.id.toLowerCase() === item.id.toLowerCase()
        );
        if (!alreadyExists) {
          const newPkg: WingetPackage = {
            id: item.id,
            name: item.name || item.id,
            category: 'Geral',
            enabled: true,
          };
          const updatedProfile: WinForgeProfile = {
            ...profileRef.current,
            winget_packages: [newPkg, ...profileRef.current.winget_packages],
          };
          setProfile(updatedProfile);
          const savedPath = await tauriBridge.saveProfileToDisk(updatedProfile);
          appendLog(
            'OK',
            2,
            savedPath
              ? `Pacote "${item.id}" adicionado ao manifesto e salvo em "${savedPath}".`
              : `Pacote "${item.id}" adicionado ao manifesto em memória (exporte profile.json para salvar).`
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 2, `Falha ao instalar ${item.id}: ${message}`);
    } finally {
      setInstallingId(null);
    }
  };

  const handleLoadInstalled = async () => {
    if (isLoadingInstalled || uiDisabled) return;
    setIsLoadingInstalled(true);
    try {
      const items = await tauriBridge.wingetListInstalled();
      setInstalledPkgs(items);
      setHasLoadedInstalled(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 2, `Erro ao listar pacotes instalados: ${message}`);
    } finally {
      setIsLoadingInstalled(false);
    }
  };

  const handleUninstallPackage = async (item: WingetInstalledItem) => {
    if (uiDisabled) return;
    setUninstallingId(item.id);
    try {
      await tauriBridge.wingetUninstallPackage(item.id, item.name);
      setInstalledPkgs((prev) => prev.filter((p) => p.id.toLowerCase() !== item.id.toLowerCase()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 2, `Falha ao desinstalar ${item.id}: ${message}`);
    } finally {
      setUninstallingId(null);
    }
  };

  // Reverse Sync Dotfiles / Vault handler
  const handleSyncDotfilesReverse = async () => {
    if (uiDisabled) return;
    setIsSyncingReverse(true);
    try {
      const res = await tauriBridge.syncDotfilesReverse(profile);
      setLastSyncResult(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 3, `Falha no SYNC TO REPO / VAULT: ${message}`);
    } finally {
      setIsSyncingReverse(false);
    }
  };

  // Quick Maintenance handler
  const handleRunQuickMaintenance = async (action: QuickMaintenanceAction) => {
    if (uiDisabled) return;
    setRunningMaintenance(action);
    try {
      await tauriBridge.runQuickMaintenance(action);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Falha na manutenção rápida (${action}): ${message}`);
    } finally {
      setRunningMaintenance(null);
    }
  };

  // PowerTools ([07]) handlers
  const handleUpdatePowerToolsConfig = async (next: PowerToolsConfig) => {
    try {
      const updated = await tauriBridge.updatePowerToolsConfig(next);
      setPowerToolsConfig(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Falha ao atualizar PowerTools: ${message}`);
    }
  };

  const handleToggleAwake = async (enabled: boolean, keepScreenOn: boolean) => {
    try {
      const status = await tauriBridge.toggleAwake(keepScreenOn, enabled);
      setPowerToolsConfig((prev) => ({
        ...prev,
        awakeEnabled: status.enabled,
        awakeKeepScreenOn: status.keepScreenOn,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Falha ao alternar Awake: ${message}`);
    }
  };

  const handleTriggerAlwaysOnTop = async () => {
    try {
      await tauriBridge.toggleAlwaysOnTop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Always on Top: ${message}`);
    }
  };

  const handleTriggerPickColor = async () => {
    try {
      await tauriBridge.pickScreenColor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Color Picker: ${message}`);
    }
  };

  const handleTriggerPlainTextPaste = async () => {
    try {
      await tauriBridge.pastePlainText();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Plain Text Paste: ${message}`);
    }
  };

  const handleTriggerOcrCapture = async () => {
    try {
      await tauriBridge.openOcrOverlay();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Text Extractor (OCR): ${message}`);
    }
  };

  const handleTriggerFindMyMouse = async () => {
    try {
      await tauriBridge.triggerFindMyMouse();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Find My Mouse: ${message}`);
    }
  };

  const handleToggleMouseCrosshair = async (enabled: boolean) => {
    try {
      const next = await tauriBridge.setMouseCrosshair(enabled);
      setPowerToolsConfig((prev) => ({
        ...prev,
        mouseCrosshairEnabled: next,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog('ERR', 1, `Mouse Crosshair: ${message}`);
    }
  };

  const handleUpdateKeyRemaps = async (nextRules: KeyRemapRule[]) => {
    const updatedProfile: WinForgeProfile = {
      ...profileRef.current,
      key_remaps: nextRules,
    };
    setProfile(updatedProfile);
    if (runtime.isTauri) {
      await tauriBridge.saveProfileToDisk(updatedProfile);
    }
  };

  // Browser preview closed state (only reachable outside Tauri desktop window)
  if (!runtime.isTauri && isClosedPreview) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#11111b] p-4 text-[#cdd6f4]">
        <div className="flex w-full max-w-[340px] flex-col items-center gap-4 border border-[#313244] bg-[#1e1e2e] p-6 text-center shadow-2xl">
          <div className="flex h-10 w-10 items-center justify-center border border-[#cba6f7]/60 bg-[#181825] text-[#cba6f7]">
            <Terminal className="h-5 w-5" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="font-mono text-sm font-bold text-[#cdd6f4]">WinForge encerrado</h1>
            <p className="font-mono text-[11px] text-[#7f849c]">
              No executável portátil do Windows, este botão encerra o processo Tauri.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReopenPreview}
            className="tui-chamfer flex items-center gap-2 bg-[#cba6f7] px-4 py-2 font-mono text-xs font-bold text-[#11111b] hover:bg-[#d8b8ff] transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reabrir WinForge</span>
          </button>
        </div>
      </div>
    );
  }

  const cardShellClass = runtime.isTauri
    ? 'relative flex h-screen w-screen flex-col overflow-hidden border border-[#313244] bg-[#1e1e2e] text-[#cdd6f4]'
    : `relative flex w-full max-w-[440px] flex-col overflow-hidden border border-[#313244] bg-[#1e1e2e] text-[#cdd6f4] shadow-[0_24px_64px_rgba(0,0,0,0.65)] transition-[height] duration-200 ${
        isMinimizedPreview ? 'h-auto' : 'h-[min(780px,calc(100vh-1.5rem))]'
      }`;

  return (
    <div
      className={
        runtime.isTauri
          ? 'h-screen w-screen overflow-hidden bg-[#1e1e2e]'
          : 'flex h-screen w-screen items-center justify-center overflow-hidden bg-[#11111b] p-3'
      }
    >
      <div className={cardShellClass}>
        <WindowTitleBar
          profileName={profile.profile_name}
          author={profile.author}
          runtime={runtime}
          alwaysOnTop={alwaysOnTop}
          isMinimizedPreview={isMinimizedPreview}
          isRunning={isRunning}
          isScanning={isScanning}
          isHarvesting={isHarvesting}
          onStartDragging={handleStartDragging}
          onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
          onMinimize={handleMinimize}
          onClose={handleClose}
          onUpdateProfileMeta={handleUpdateProfileMeta}
          onImportFile={handleImportFile}
          onImportNative={handleImportNative}
          onExportProfile={handleExportProfile}
          onScanSystem={handleScanCurrentSystem}
          onReplaySplash={() => playSplashSequence()}
        />

        {!isMinimizedPreview && (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {showSplash && (
              <SplashScreen
                progress={splashProgress}
                statusText={splashStatus}
                fadingOut={splashFading}
              />
            )}

            <main className="flex-1 overflow-y-auto bg-[#1e1e2e]">
              {activeTab === 'harvest' && (
                <HarvestTab
                  profile={profile}
                  scopeFlags={harvestScopeFlags}
                  isTauri={runtime.isTauri}
                  isHarvesting={isHarvesting}
                  disabled={uiDisabled}
                  lastResult={lastHarvestResult}
                  onUpdateScopeFlags={handleUpdateHarvestScopeFlags}
                  onUpdateProfileHarvestFields={handleUpdateHarvestFields}
                  onRunHarvest={handleRunHarvest}
                />
              )}

              {activeTab === 'system' && (
                <SystemDebloatTab
                  createRestorePoint={profile.create_restore_point}
                  tweaks={profile.system_tweaks}
                  scripts={profile.external_scripts}
                  autostartTasks={profile.autostart_tasks ?? []}
                  isTauri={runtime.isTauri}
                  runningMaintenance={runningMaintenance}
                  disabled={uiDisabled}
                  onToggleRestorePoint={handleToggleRestorePoint}
                  onToggleTweak={handleToggleTweak}
                  onDeleteTweak={handleDeleteTweak}
                  onAddTweak={handleAddTweak}
                  onToggleScript={handleToggleScript}
                  onToggleScriptInteractive={handleToggleScriptInteractive}
                  onDeleteScript={handleDeleteScript}
                  onAddScript={handleAddScript}
                  onToggleAutostart={handleToggleAutostart}
                  onToggleAutostartAdmin={handleToggleAutostartAdmin}
                  onAddAutostart={handleAddAutostart}
                  onDeleteAutostart={handleDeleteAutostart}
                  onScanStartupTasks={handleScanStartupTasks}
                  onDeployAutostartTasks={handleDeployAutostartTasks}
                  onRunQuickMaintenance={handleRunQuickMaintenance}
                />
              )}

              {activeTab === 'packages' && (
                <PackagesTab
                  packages={profile.winget_packages}
                  portableApps={profile.portable_apps ?? []}
                  vscodeExtensions={profile.vscode_extensions ?? []}
                  disabled={uiDisabled}
                  onTogglePackage={handleTogglePackage}
                  onToggleMany={handleToggleManyPackages}
                  onAddPackage={handleAddPackage}
                  onDeletePackage={handleDeletePackage}
                  onTogglePortableApp={handleTogglePortableApp}
                  onTogglePortableAddToPath={handleTogglePortableAddToPath}
                  onAddPortableApp={handleAddPortableApp}
                  onUpdatePortableApp={handleUpdatePortableApp}
                  onDeletePortableApp={handleDeletePortableApp}
                  onAddVscodeExtensions={handleAddVscodeExtensions}
                  onDeleteVscodeExtension={handleDeleteVscodeExtension}
                  onClearVscodeExtensions={handleClearVscodeExtensions}
                />
              )}

              {activeTab === 'dotfiles' && (
                <DotfilesThemesTab
                  dotfiles={profile.dotfiles}
                  registryFiles={profile.registry_files}
                  isTauri={runtime.isTauri}
                  isSyncingReverse={isSyncingReverse}
                  lastSyncResult={lastSyncResult}
                  disabled={uiDisabled}
                  onUpdateRepoUrl={handleUpdateRepoUrl}
                  onToggleMapping={handleToggleMapping}
                  onAddMapping={handleAddMapping}
                  onDeleteMapping={handleDeleteMapping}
                  onToggleRegistryFile={handleToggleRegistryFile}
                  onAddRegistryFile={handleAddRegistryFile}
                  onDeleteRegistryFile={handleDeleteRegistryFile}
                  onSyncReverse={handleSyncDotfilesReverse}
                />
              )}

              {activeTab === 'json' && (
                <JsonEditorTab
                  profile={profile}
                  disabled={uiDisabled}
                  onApplyProfile={handleApplyRawProfile}
                  onValidityChange={setJsonValid}
                />
              )}

              {activeTab === 'pkgmgr' && (
                <PkgManagerTab
                  subTab={pkgMgrSubTab}
                  onChangeSubTab={setPkgMgrSubTab}
                  isTauri={runtime.isTauri}
                  disabled={uiDisabled}
                  profilePackageIds={profilePackageIds}
                  updates={updates}
                  hasCheckedUpdates={hasCheckedUpdates}
                  isCheckingUpdates={isCheckingUpdates}
                  isUpgrading={isUpgrading}
                  onCheckUpdates={handleCheckUpdates}
                  onUpgradeSelected={handleUpgradeSelected}
                  searchResults={searchResults}
                  isSearching={isSearching}
                  installingId={installingId}
                  onSearchPackages={handleSearchPackages}
                  onInstallPackage={handleInstallSearchedPackage}
                  installed={installedPkgs}
                  hasLoadedInstalled={hasLoadedInstalled}
                  isLoadingInstalled={isLoadingInstalled}
                  uninstallingId={uninstallingId}
                  onLoadInstalled={handleLoadInstalled}
                  onUninstallPackage={handleUninstallPackage}
                />
              )}

              {activeTab === 'wintoys' && (
                <WintoysTab
                  isTauri={runtime.isTauri}
                  disabled={uiDisabled}
                  onLog={(lvl, msg) => appendLog(lvl, 1, msg)}
                  onCpuUpdate={setLiveCpuPct}
                />
              )}

              {activeTab === 'powertools' && (
                <PowerToolsTab
                  isTauri={runtime.isTauri}
                  disabled={uiDisabled}
                  config={powerToolsConfig}
                  colorHistory={colorHistory}
                  lastOcr={lastOcr}
                  keyRemaps={profile.key_remaps ?? []}
                  onUpdateConfig={handleUpdatePowerToolsConfig}
                  onToggleAwake={handleToggleAwake}
                  onTriggerAlwaysOnTop={handleTriggerAlwaysOnTop}
                  onTriggerPickColor={handleTriggerPickColor}
                  onTriggerPlainTextPaste={handleTriggerPlainTextPaste}
                  onTriggerOcrCapture={handleTriggerOcrCapture}
                  onTriggerFindMyMouse={handleTriggerFindMyMouse}
                  onToggleMouseCrosshair={handleToggleMouseCrosshair}
                  onUpdateKeyRemaps={handleUpdateKeyRemaps}
                  onClearColorHistory={() => setColorHistory([])}
                  onLog={(lvl, msg) => appendLog(lvl, 1, msg)}
                />
              )}
            </main>

            <TerminalConsole
              logs={logs}
              progressState={progressState}
              lastFinished={lastFinished}
              dryRun={dryRun}
              isTauri={runtime.isTauri}
              onToggleDryRun={() => setDryRun((v) => !v)}
              onExecute={handleExecuteProvisioning}
              onAbort={handleAbortProvisioning}
              onClearLogs={() => setLogs([])}
              onRetryFailedItems={handleRetryFailedItems}
            />

            <TabNav activeTab={activeTab} onSelectTab={setActiveTab} counts={counts} />
          </div>
        )}
      </div>
    </div>
  );
}
