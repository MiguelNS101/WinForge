import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import {
  AlwaysOnTopResult,
  AutostartTask,
  AwakeStatus,
  BatchResizeResult,
  EnvVarEntry,
  HarvestOptions,
  HarvestResult,
  HostEntry,
  KeyRemapRule,
  LogEntry,
  MouseOverlayState,
  OcrExtractResult,
  PickedColor,
  PipelineProgressEvent,
  PowerToolEventPayload,
  PowerToolsConfig,
  ProvisionFinishedEvent,
  QuickMaintenanceAction,
  ReverseSyncResult,
  RuntimeStatus,
  SystemHealthReport,
  TrayAction,
  WinForgeProfile,
  WingetBatchResult,
  WingetInstalledItem,
  WingetSearchItem,
  WingetUpdateItem,
  WintoysRepairId,
  WintoysTweakState,
} from '../types/profile';
import { validateProfileJson } from '../utils/profileValidator';

/**
 * Tauri v2 event channels emitted by the Rust execution engine via `app.emit(...)`.
 */
export const TAURI_EVENTS = {
  LOG: 'provision-log',
  PROGRESS: 'provision-progress',
  FINISHED: 'provision-finished',
  TRAY_ACTION: 'tray-action',
  POWERTOOL: 'powertool-event',
  MOUSE_OVERLAY: 'mouse-overlay-state',
} as const;

type UnlistenFn = () => void;
type EventCallback<T> = (payload: T) => void;

const DESKTOP_REQUIRED_MSG =
  'Runtime desktop Tauri v2 não detectado. Execute o executável portátil WinForge.exe no Windows.';

interface TauriGlobalWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as TauriGlobalWindow;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

function assertTauriRuntime(): void {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_MSG);
  }
}

export const tauriBridge = {
  /**
   * Checks Windows Administrator privileges (`IsUserAnAdmin` in Rust backend).
   */
  async checkAdminStatus(): Promise<RuntimeStatus> {
    if (!isTauriRuntime()) {
      return {
        isTauri: false,
        isAdmin: false,
        platform: 'Desktop Runtime Offline',
      };
    }

    try {
      const isAdmin = await invoke<boolean>('check_admin');
      return {
        isTauri: true,
        isAdmin,
        platform: 'Windows (Tauri v2)',
      };
    } catch {
      return {
        isTauri: true,
        isAdmin: false,
        platform: 'Windows (Tauri v2)',
      };
    }
  },

  /**
   * Checks for a portable `profile.json` next to `WinForge.exe` on startup.
   */
  async loadStartupProfile(): Promise<WinForgeProfile | null> {
    if (!isTauriRuntime()) return null;
    try {
      const loaded = await invoke<WinForgeProfile | null>('load_startup_profile');
      return loaded ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Subscribes to Rust `provision-log` events.
   */
  async onLog(callback: EventCallback<LogEntry>): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<LogEntry>(TAURI_EVENTS.LOG, (ev) => callback(ev.payload));
  },

  /**
   * Subscribes to Rust `provision-progress` events.
   */
  async onProgress(callback: EventCallback<PipelineProgressEvent>): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<PipelineProgressEvent>(TAURI_EVENTS.PROGRESS, (ev) => callback(ev.payload));
  },

  /**
   * Subscribes to Rust `provision-finished` events.
   */
  async onFinished(callback: EventCallback<ProvisionFinishedEvent>): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<ProvisionFinishedEvent>(TAURI_EVENTS.FINISHED, (ev) => {
      const payload = ev.payload;
      const normalizedFailures =
        typeof payload.failureCount === 'number'
          ? payload.failureCount
          : typeof payload.failed_count === 'number'
          ? payload.failed_count
          : 0;
      callback({
        ...payload,
        failureCount: normalizedFailures,
        failed_count: normalizedFailures,
      });
    });
  },

  /**
   * Opens the native Windows folder picker via `tauri-plugin-dialog`.
   */
  async pickDirectory(defaultPath?: string): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: defaultPath?.trim() || undefined,
      title: 'Selecionar pasta de destino do Bundle WinForge',
    });
    return typeof selected === 'string' && selected.trim() ? selected.trim() : null;
  },

  /**
   * Opens native JSON file picker in Tauri and reads its contents.
   */
  async openProfileFileNative(): Promise<{ name: string; content: string } | null> {
    if (!isTauriRuntime()) return null;
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: 'Importar manifesto WinForge (profile.json)',
      filters: [{ name: 'Manifesto JSON', extensions: ['json'] }],
    });
    if (typeof selected !== 'string' || !selected.trim()) return null;
    const content = await readTextFile(selected);
    const name = selected.split(/[\\/]/).pop() || selected;
    return { name, content };
  },

  /**
   * Opens native Save dialog in Tauri and writes the formatted JSON manifesto.
   */
  async saveProfileFileNative(defaultFilename: string, jsonContent: string): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    const target = await saveDialog({
      defaultPath: defaultFilename,
      title: 'Exportar manifesto WinForge',
      filters: [{ name: 'Manifesto JSON', extensions: ['json'] }],
    });
    if (!target) return null;
    await writeTextFile(target, jsonContent);
    return target;
  },

  /**
   * Loads `failed_report.json` via the Rust `read_profile_file` command (unrestricted by FS plugin scopes),
   * falling back to the embedded `failedProfile` payload if present.
   */
  async loadFailedReport(
    reportPath?: string | null,
    embeddedProfile?: WinForgeProfile | null
  ): Promise<WinForgeProfile | null> {
    if (isTauriRuntime() && reportPath?.trim()) {
      try {
        const parsed = await invoke<WinForgeProfile>('read_profile_file', {
          path: reportPath.trim(),
        });
        const validated = validateProfileJson(JSON.stringify(parsed));
        if (validated.valid && validated.parsed) {
          return validated.parsed;
        }
        return parsed;
      } catch {
        // Fallback to embedded profile from event payload
      }
    }
    return embeddedProfile ?? null;
  },

  /**
   * Cancels an active provisioning or harvest run in Rust.
   */
  async abortProvisioning(): Promise<void> {
    assertTauriRuntime();
    await invoke('abort_provisioning');
  },

  /**
   * Reverse Snapshot: runs `scan_current_system` in Rust (`winget export` + local config folder scan).
   */
  async scanCurrentSystem(): Promise<WinForgeProfile> {
    assertTauriRuntime();
    return invoke<WinForgeProfile>('scan_current_system');
  },

  /**
   * Scans `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` shortcuts into suggested `AutostartTask`s.
   */
  async scanStartupTasks(): Promise<AutostartTask[]> {
    assertTauriRuntime();
    return invoke<AutostartTask[]>('scan_startup_tasks');
  },

  /**
   * Schedules enabled `autostart_tasks` immediately via `schtasks /create /sc onlogon` (/rl highest when run_as_admin).
   */
  async deployAutostartTasks(tasks: AutostartTask[]): Promise<number> {
    assertTauriRuntime();
    return invoke<number>('deploy_autostart_tasks', { tasks });
  },

  /**
   * HARVEST Mode: runs `run_harvest(outputDir, options)` in Rust to generate a portable pre-format bundle.
   */
  async runHarvest(outputDir: string, options: HarvestOptions): Promise<HarvestResult> {
    assertTauriRuntime();
    return invoke<HarvestResult>('run_harvest', { outputDir, options });
  },

  /**
   * Runs the 5-stage provisioning pipeline (`run_provisioning`) in Rust.
   */
  async executeProvisioning(profile: WinForgeProfile, dryRun = false): Promise<void> {
    assertTauriRuntime();
    await invoke('run_provisioning', { profile, dryRun });
  },

  /**
   * Subscribes to System Tray menu quick actions (`check-updates` | `sync-dotfiles`).
   */
  async onTrayAction(callback: EventCallback<TrayAction>): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<TrayAction>(TAURI_EVENTS.TRAY_ACTION, (ev) => callback(ev.payload));
  },

  /**
   * UniGet Mode: live WinGet package management commands.
   */
  async wingetCheckUpdates(): Promise<WingetUpdateItem[]> {
    assertTauriRuntime();
    return invoke<WingetUpdateItem[]>('winget_check_updates');
  },

  async wingetUpgradePackages(ids: string[]): Promise<WingetBatchResult> {
    assertTauriRuntime();
    return invoke<WingetBatchResult>('winget_upgrade_packages', { ids });
  },

  async wingetSearch(query: string): Promise<WingetSearchItem[]> {
    assertTauriRuntime();
    return invoke<WingetSearchItem[]>('winget_search', { query });
  },

  async wingetInstallPackage(id: string, name: string): Promise<void> {
    assertTauriRuntime();
    await invoke('winget_install_package', { id, name });
  },

  async wingetListInstalled(): Promise<WingetInstalledItem[]> {
    assertTauriRuntime();
    return invoke<WingetInstalledItem[]>('winget_list_installed');
  },

  async wingetUninstallPackage(id: string, name: string): Promise<void> {
    assertTauriRuntime();
    await invoke('winget_uninstall_package', { id, name });
  },

  async saveProfileToDisk(profile: WinForgeProfile): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    try {
      return await invoke<string | null>('save_profile_to_disk', { profile });
    } catch {
      return null;
    }
  },

  /**
   * Reverse Dotfiles & Vault Sync (+ optional Git commit & push).
   */
  async syncDotfilesReverse(profile: WinForgeProfile): Promise<ReverseSyncResult> {
    assertTauriRuntime();
    return invoke<ReverseSyncResult>('sync_dotfiles_reverse', { profile });
  },

  /**
   * Quick Maintenance tasks (`clean_temp_winget` | `sfc_scannow`).
   */
  async runQuickMaintenance(action: QuickMaintenanceAction): Promise<string> {
    assertTauriRuntime();
    return invoke<string>('run_quick_maintenance', { action });
  },

  /**
   * Subscribes to PowerTools global hotkey events (`powertool-event`).
   */
  async onPowerToolEvent(callback: EventCallback<PowerToolEventPayload>): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<PowerToolEventPayload>(TAURI_EVENTS.POWERTOOL, (ev) => callback(ev.payload));
  },

  /**
   * Wintoys & PowerTools native Rust commands (`src-tauri/src/power_modules.rs`).
   */
  async getSystemHealth(): Promise<SystemHealthReport> {
    assertTauriRuntime();
    return invoke<SystemHealthReport>('get_system_health');
  },

  async getWintoysTweaksStatus(): Promise<WintoysTweakState[]> {
    assertTauriRuntime();
    return invoke<WintoysTweakState[]>('get_wintoys_tweaks_status');
  },

  async applyWintoysTweak(tweakId: string, enabled: boolean): Promise<WintoysTweakState> {
    assertTauriRuntime();
    return invoke<WintoysTweakState>('apply_wintoys_tweak', { tweakId, enabled });
  },

  async runWintoysRepair(repairId: WintoysRepairId): Promise<string> {
    assertTauriRuntime();
    return invoke<string>('run_wintoys_repair', { repairId });
  },

  async toggleAwake(keepScreenOn: boolean, enabled?: boolean): Promise<AwakeStatus> {
    assertTauriRuntime();
    return invoke<AwakeStatus>('toggle_awake', { keepScreenOn, enabled });
  },

  async toggleAlwaysOnTop(): Promise<AlwaysOnTopResult> {
    assertTauriRuntime();
    return invoke<AlwaysOnTopResult>('toggle_always_on_top');
  },

  async pickScreenColor(): Promise<PickedColor> {
    assertTauriRuntime();
    return invoke<PickedColor>('pick_screen_color');
  },

  async pastePlainText(): Promise<string> {
    assertTauriRuntime();
    return invoke<string>('paste_plain_text');
  },

  async getEnvVars(): Promise<EnvVarEntry[]> {
    assertTauriRuntime();
    return invoke<EnvVarEntry[]>('get_env_vars');
  },

  async saveEnvVar(scope: string, key: string, value: string): Promise<void> {
    assertTauriRuntime();
    await invoke('save_env_var', { scope, key, value });
  },

  async deleteEnvVar(scope: string, key: string): Promise<void> {
    assertTauriRuntime();
    await invoke('delete_env_var', { scope, key });
  },

  async getPowerToolsConfig(): Promise<PowerToolsConfig> {
    assertTauriRuntime();
    return invoke<PowerToolsConfig>('get_powertools_config');
  },

  async updatePowerToolsConfig(config: PowerToolsConfig): Promise<PowerToolsConfig> {
    assertTauriRuntime();
    return invoke<PowerToolsConfig>('update_powertools_config', { config });
  },

  /**
   * Text Extractor (Native Windows 11 WinRT OCR).
   */
  async openOcrOverlay(): Promise<void> {
    assertTauriRuntime();
    await invoke('open_ocr_overlay');
  },

  async extractTextFromRegion(
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<OcrExtractResult> {
    assertTauriRuntime();
    return invoke<OcrExtractResult>('extract_text_from_region', { x, y, width, height });
  },

  /**
   * Visual Hosts File Editor (`C:\Windows\System32\drivers\etc\hosts`).
   */
  async readHostsFile(): Promise<HostEntry[]> {
    assertTauriRuntime();
    return invoke<HostEntry[]>('read_hosts_file');
  },

  async saveHostsFile(entries: HostEntry[]): Promise<string> {
    assertTauriRuntime();
    return invoke<string>('save_hosts_file', { entries });
  },

  /**
   * Batch Image Resizer & Converter (`image` crate).
   */
  async pickImageFiles(): Promise<string[]> {
    if (!isTauriRuntime()) return [];
    const selected = await openDialog({
      multiple: true,
      directory: false,
      title: 'Selecionar imagens para redimensionar/converter',
      filters: [
        {
          name: 'Imagens',
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
      ],
    });
    if (!selected) return [];
    const list: string[] = Array.isArray(selected) ? selected : [selected];
    return list.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  },

  async batchResizeImages(
    paths: string[],
    width: number,
    height: number,
    format: 'png' | 'jpg' | 'webp',
    quality: number
  ): Promise<BatchResizeResult> {
    assertTauriRuntime();
    return invoke<BatchResizeResult>('batch_resize_images', {
      paths,
      width,
      height,
      format,
      quality,
    });
  },

  /**
   * Mouse Utilities (Find My Mouse & Crosshair) & Simple Key Remapper (WH_KEYBOARD_LL).
   */
  async triggerFindMyMouse(): Promise<void> {
    assertTauriRuntime();
    await invoke('trigger_find_my_mouse');
  },

  async setMouseCrosshair(enabled: boolean): Promise<boolean> {
    assertTauriRuntime();
    return invoke<boolean>('set_mouse_crosshair', { enabled });
  },

  async syncKeyRemaps(rules: KeyRemapRule[]): Promise<number> {
    if (!isTauriRuntime()) return 0;
    return invoke<number>('sync_key_remaps', { rules });
  },

  async onMouseOverlayState(callback: EventCallback<MouseOverlayState>): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<MouseOverlayState>(TAURI_EVENTS.MOUSE_OVERLAY, (ev) => callback(ev.payload));
  },

  /**
   * Native Tauri v2 frameless window controls.
   */
  async windowMinimize(): Promise<void> {
    if (!isTauriRuntime()) return;
    await getCurrentWindow().minimize();
  },

  async windowClose(): Promise<void> {
    if (!isTauriRuntime()) return;
    await getCurrentWindow().close();
  },

  async windowStartDragging(): Promise<void> {
    if (!isTauriRuntime()) return;
    await getCurrentWindow().startDragging();
  },

  async windowSetAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    if (!isTauriRuntime()) return;
    await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
  },
};
