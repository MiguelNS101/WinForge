export interface SystemTweak {
  id: string;
  label: string;
  enabled: boolean;
  command: string;
}

export interface ExternalScript {
  id: string;
  label: string;
  enabled: boolean;
  command: string;
  interactive: boolean;
}

export interface WingetPackage {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  pre_cmd?: string;
  post_cmd?: string;
}

export interface DotfileMapping {
  id: string;
  label: string;
  source: string;
  target: string;
  kill_process: string;
  enabled: boolean;
}

export interface DotfilesConfig {
  repo_url: string;
  mappings: DotfileMapping[];
}

export interface RegistryFile {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
}

export interface VaultItem {
  id: string;
  label: string;
  source_path: string;
  bundle_subpath: string;
  enabled: boolean;
}

export interface PortableApp {
  id: string;
  name: string;
  zip_url: string;
  extract_to: string;
  add_to_path: boolean;
  enabled: boolean;
  pre_cmd?: string;
  post_cmd?: string;
}

export interface AutostartTask {
  name: string;
  exe_path: string;
  args: string;
  run_as_admin: boolean;
  enabled?: boolean;
}

export interface KeyRemapRule {
  from_key: string;
  to_key: string;
  enabled: boolean;
}

export interface WinForgeProfile {
  profile_name: string;
  author: string;
  create_restore_point: boolean;
  system_tweaks: SystemTweak[];
  external_scripts: ExternalScript[];
  winget_packages: WingetPackage[];
  dotfiles: DotfilesConfig;
  registry_files: RegistryFile[];
  bundle_root?: string | null;
  vault_items?: VaultItem[];
  vscode_extensions?: string[];
  portable_apps?: PortableApp[];
  backup_wifi?: boolean;
  backup_drivers?: boolean;
  extra_save_paths?: string[];
  autostart_tasks?: AutostartTask[];
  key_remaps?: KeyRemapRule[];
}

export interface HarvestOptions {
  profile?: WinForgeProfile;
  backup_wifi: boolean;
  backup_drivers: boolean;
  capture_vscode_extensions: boolean;
  detect_non_winget_apps: boolean;
  vault_items: VaultItem[];
  dotfile_mappings: DotfileMapping[];
  extra_save_paths: string[];
}

export interface HarvestResult {
  outputDir: string;
  profilePath: string;
  manualReportPath: string;
  manualReportMarkdown: string;
  manualAppsCount: number;
  vscodeExtensionsCount: number;
  copiedVaultFiles: number;
  copiedDotfileFiles: number;
  copiedSaveFiles: number;
  profile: WinForgeProfile;
}

export type ModuleTab =
  | 'harvest'
  | 'system'
  | 'packages'
  | 'dotfiles'
  | 'json'
  | 'pkgmgr'
  | 'wintoys'
  | 'powertools';

export interface DiskHealth {
  name: string;
  mountPoint: string;
  usedBytes: number;
  totalBytes: number;
  availableBytes: number;
}

export interface ServiceStatus {
  name: string;
  label: string;
  state: string;
  running: boolean;
  disabled: boolean;
}

export interface SystemHealthReport {
  cpuUsagePct: number;
  cpuCores: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  uptimeSecs: number;
  disks: DiskHealth[];
  services: ServiceStatus[];
}

export interface AwakeStatus {
  enabled: boolean;
  keepScreenOn: boolean;
}

export interface AlwaysOnTopResult {
  windowTitle: string;
  isTopmost: boolean;
}

export interface PickedColor {
  hex: string;
  rgb: string;
  hsl: string;
  r: number;
  g: number;
  b: number;
  x: number;
  y: number;
  timestamp: string;
}

export interface EnvVarEntry {
  scope: 'user' | 'system' | string;
  key: string;
  value: string;
}

export interface WintoysTweakState {
  id: string;
  category: 'Explorer' | 'Privacy' | 'Performance' | 'Services' | string;
  label: string;
  description: string;
  enabled: boolean;
}

export type WintoysRepairId = 'flush_dns' | 'rebuild_icon_cache' | 'reset_network';

export interface OcrExtractResult {
  text: string;
  lineCount: number;
  charCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  timestamp: string;
}

export interface HostEntry {
  id: string;
  ip: string;
  domain: string;
  comment: string;
  enabled: boolean;
}

export interface ResizedImageItem {
  sourcePath: string;
  outputPath: string;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  outputBytes: number;
}

export interface BatchResizeResult {
  succeeded: ResizedImageItem[];
  failed: string[];
}

export interface MouseOverlayState {
  x: number;
  y: number;
  spotlightActive: boolean;
  crosshairActive: boolean;
  spotlightRadius: number;
}

export interface PowerToolsConfig {
  awakeEnabled: boolean;
  awakeKeepScreenOn: boolean;
  alwaysOnTopEnabled: boolean;
  colorPickerEnabled: boolean;
  plainTextEnabled: boolean;
  ocrEnabled: boolean;
  findMyMouseEnabled: boolean;
  mouseCrosshairEnabled: boolean;
  keyRemapperEnabled: boolean;
  hotkeyAlwaysOnTop: string;
  hotkeyColorPicker: string;
  hotkeyPlainText: string;
  hotkeyOcr: string;
}

export interface PowerToolEventPayload {
  kind: 'color-picked' | 'always-on-top' | 'plain-text' | 'ocr-extracted' | 'error' | string;
  message: string;
  color?: PickedColor | null;
  alwaysOnTop?: AlwaysOnTopResult | null;
  ocr?: OcrExtractResult | null;
}

export interface WingetUpdateItem {
  name: string;
  id: string;
  version: string;
  available: string;
  source: string;
}

export interface WingetSearchItem {
  name: string;
  id: string;
  version: string;
  source: string;
}

export interface WingetInstalledItem {
  name: string;
  id: string;
  version: string;
  available: string;
  source: string;
}

export interface WingetBatchResult {
  succeeded: string[];
  failed: string[];
}

export interface ReverseSyncResult {
  targetDir: string;
  copiedDotfiles: number;
  copiedVaultFiles: number;
  exportedWindhawkReg: boolean;
  gitPushed: boolean;
  gitMessage: string;
}

export type QuickMaintenanceAction = 'clean_temp_winget' | 'sfc_scannow';

export type TrayAction = 'check-updates' | 'sync-dotfiles';

export type LogLevel = 'INFO' | 'OK' | 'WARN' | 'ERR';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  stage: number;
  message: string;
}

export interface PipelineProgressEvent {
  stage: number;
  stageLabel: string;
  progress: number;
  status: 'idle' | 'running' | 'completed' | 'aborted' | 'error';
  currentTask?: string;
}

export interface ProvisionFinishedEvent {
  dryRun: boolean;
  status: 'completed' | 'aborted' | 'error';
  successCount: number;
  failureCount: number;
  failed_count?: number;
  failedReportPath?: string | null;
  failedProfile?: WinForgeProfile | null;
}

export interface RuntimeStatus {
  isTauri: boolean;
  isAdmin: boolean;
  platform: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
  parsed?: WinForgeProfile;
}
