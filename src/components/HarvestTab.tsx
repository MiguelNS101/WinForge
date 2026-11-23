import React, { useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Download,
  FileText,
  FolderOpen,
  FolderOutput,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  PackageSearch,
  Pencil,
  Plus,
  Puzzle,
  ShieldAlert,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { tauriBridge } from '../services/tauriBridge';
import {
  HarvestOptions,
  HarvestResult,
  VaultItem,
  WinForgeProfile,
} from '../types/profile';
import { TuiCheckbox } from './TuiCheckbox';

export interface HarvestScopeFlags {
  collectVault: boolean;
  collectDotfiles: boolean;
  collectWingetAndManualReport: boolean;
  collectVscodeExtensions: boolean;
}

interface HarvestTabProps {
  profile: WinForgeProfile;
  scopeFlags: HarvestScopeFlags;
  isTauri: boolean;
  isHarvesting: boolean;
  disabled: boolean;
  lastResult: HarvestResult | null;
  onUpdateScopeFlags: (patch: Partial<HarvestScopeFlags>) => void;
  onUpdateProfileHarvestFields: (patch: Partial<WinForgeProfile>) => void;
  onRunHarvest: (outputDir: string, options: HarvestOptions) => void;
}

const BUNDLE_PATH_PRESETS = [
  'D:\\WinForge_Bundle_2026',
  './WinForge_Bundle',
  'E:\\WinForge_2026',
];

export function HarvestTab({
  profile,
  scopeFlags,
  isTauri,
  isHarvesting,
  disabled,
  lastResult,
  onUpdateScopeFlags,
  onUpdateProfileHarvestFields,
  onRunHarvest,
}: HarvestTabProps) {
  const [showVaultList, setShowVaultList] = useState(false);
  const [showAddVault, setShowAddVault] = useState(false);
  const [vaultLabel, setVaultLabel] = useState('');
  const [vaultSource, setVaultSource] = useState('%USERPROFILE%\\');
  const [vaultSubpath, setVaultSubpath] = useState('vault/');

  const [newSavePath, setNewSavePath] = useState('');
  const [editingSaveIndex, setEditingSaveIndex] = useState<number | null>(null);
  const [editingSaveValue, setEditingSaveValue] = useState('');

  const bundleRoot = profile.bundle_root ?? 'D:\\WinForge_Bundle_2026';
  const vaultItems = profile.vault_items ?? [];
  const extraSavePaths = profile.extra_save_paths ?? [];
  const backupWifi = Boolean(profile.backup_wifi);
  const backupDrivers = Boolean(profile.backup_drivers);

  const enabledVaultCount = vaultItems.filter((v) => v.enabled).length;
  const enabledDotfilesCount = profile.dotfiles.mappings.filter((m) => m.enabled).length;

  const activeCollectorsCount = [
    scopeFlags.collectVault,
    scopeFlags.collectDotfiles,
    scopeFlags.collectWingetAndManualReport,
    scopeFlags.collectVscodeExtensions,
    backupWifi,
    backupDrivers,
  ].filter(Boolean).length;

  const handleBrowseBundleDir = async () => {
    if (disabled) return;
    const picked = await tauriBridge.pickDirectory(bundleRoot);
    if (picked) {
      onUpdateProfileHarvestFields({ bundle_root: picked });
    }
  };

  const handleBrowseExtraSave = async () => {
    if (disabled) return;
    const picked = await tauriBridge.pickDirectory();
    if (picked) {
      setNewSavePath(picked);
    }
  };

  const toggleVaultItem = (id: string) => {
    onUpdateProfileHarvestFields({
      vault_items: vaultItems.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item
      ),
    });
  };

  const deleteVaultItem = (id: string) => {
    onUpdateProfileHarvestFields({
      vault_items: vaultItems.filter((item) => item.id !== id),
    });
  };

  const handleAddVaultItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultLabel.trim() || !vaultSource.trim()) return;
    const id =
      vaultLabel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 24) || `vault_${Date.now()}`;
    const subpath =
      vaultSubpath.trim() && vaultSubpath.trim() !== 'vault/'
        ? vaultSubpath.trim()
        : `vault/${id}`;

    const item: VaultItem = {
      id,
      label: vaultLabel.trim(),
      source_path: vaultSource.trim(),
      bundle_subpath: subpath,
      enabled: true,
    };

    onUpdateProfileHarvestFields({
      vault_items: [...vaultItems, item],
    });
    setVaultLabel('');
    setVaultSource('%USERPROFILE%\\');
    setVaultSubpath('vault/');
    setShowAddVault(false);
  };

  const handleAddSavePath = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newSavePath.trim();
    if (!clean || extraSavePaths.includes(clean)) return;
    onUpdateProfileHarvestFields({
      extra_save_paths: [...extraSavePaths, clean],
    });
    setNewSavePath('');
  };

  const startEditSavePath = (index: number) => {
    setEditingSaveIndex(index);
    setEditingSaveValue(extraSavePaths[index] ?? '');
  };

  const commitEditSavePath = () => {
    if (editingSaveIndex === null) return;
    const clean = editingSaveValue.trim();
    if (!clean) {
      setEditingSaveIndex(null);
      return;
    }
    onUpdateProfileHarvestFields({
      extra_save_paths: extraSavePaths.map((p, idx) =>
        idx === editingSaveIndex ? clean : p
      ),
    });
    setEditingSaveIndex(null);
    setEditingSaveValue('');
  };

  const removeSavePath = (index: number) => {
    if (editingSaveIndex === index) {
      setEditingSaveIndex(null);
    }
    onUpdateProfileHarvestFields({
      extra_save_paths: extraSavePaths.filter((_, idx) => idx !== index),
    });
  };

  const handleDownloadReport = () => {
    if (!lastResult?.manualReportMarkdown) return;
    const blob = new Blob([lastResult.manualReportMarkdown], {
      type: 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'manual_apps_report.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleGenerateBundle = () => {
    const cleanOut = bundleRoot.trim() || 'D:\\WinForge_Bundle_2026';
    onUpdateProfileHarvestFields({ bundle_root: cleanOut });
    onRunHarvest(cleanOut, {
      profile,
      backup_wifi: backupWifi,
      backup_drivers: backupDrivers,
      capture_vscode_extensions: scopeFlags.collectVscodeExtensions,
      detect_non_winget_apps: scopeFlags.collectWingetAndManualReport,
      vault_items: scopeFlags.collectVault ? vaultItems : [],
      dotfile_mappings: scopeFlags.collectDotfiles ? profile.dotfiles.mappings : [],
      extra_save_paths: extraSavePaths,
    });
  };

  return (
    <div className="flex flex-col gap-4 p-3.5">
      {/* Section Header */}
      <div className="flex items-baseline justify-between border-b border-[#313244] pb-2">
        <h2 className="font-mono text-xs font-bold text-[#cba6f7]">
          [00] HARVEST · PRE-FORMAT
        </h2>
        <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
          {activeCollectorsCount}/6 coletores
        </span>
      </div>

      {/* Bundle Destination Folder */}
      <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
        <label
          htmlFor="harvest-bundle-dest"
          className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#cdd6f4]"
        >
          <FolderOutput className="h-3.5 w-3.5 text-[#cba6f7]" />
          <span>Destino do Bundle</span>
        </label>

        <div className="flex items-center gap-1.5">
          <input
            id="harvest-bundle-dest"
            type="text"
            value={bundleRoot}
            onChange={(e) => onUpdateProfileHarvestFields({ bundle_root: e.target.value })}
            disabled={disabled}
            placeholder="D:\WinForge_Bundle_2026"
            className="min-w-0 flex-1 border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
          />
          {isTauri && (
            <button
              type="button"
              onClick={handleBrowseBundleDir}
              disabled={disabled}
              title="Selecionar pasta de destino"
              className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#313244] bg-[#1e1e2e] text-[#cdd6f4] hover:border-[#cba6f7] hover:text-[#cba6f7] disabled:opacity-40 cursor-pointer"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {BUNDLE_PATH_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onUpdateProfileHarvestFields({ bundle_root: preset })}
              className={`border px-1.5 py-0.5 font-mono text-[10px] transition-colors cursor-pointer disabled:opacity-40 ${
                bundleRoot === preset
                  ? 'border-[#cba6f7]/60 bg-[#cba6f7]/10 text-[#cba6f7]'
                  : 'border-[#313244] bg-[#1e1e2e] text-[#7f849c] hover:text-[#cdd6f4]'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </section>

      {/* 6 Core Collectors (Single-Column Mobile Card Stack) */}
      <section className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-semibold text-[#a6adc8]">
          O QUE COLETAR
        </span>

        <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
          {/* 1. SSH & Git/CLI Configs */}
          <div className="flex flex-col">
            <div
              onClick={() =>
                !disabled &&
                onUpdateScopeFlags({ collectVault: !scopeFlags.collectVault })
              }
              className={`flex items-center justify-between gap-2.5 px-3 py-2.5 transition-colors ${
                scopeFlags.collectVault ? '' : 'opacity-60'
              } ${disabled ? '' : 'cursor-pointer hover:bg-[#313244]/30'}`}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <div className="mt-0.5">
                  <TuiCheckbox
                    checked={scopeFlags.collectVault}
                    onChange={(checked) => onUpdateScopeFlags({ collectVault: checked })}
                    ariaLabel="Coletar Chaves SSH e Git/CLI Configs"
                    disabled={disabled}
                  />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-[#cdd6f4]">
                    <KeyRound className="h-3 w-3 shrink-0 text-[#cba6f7]" />
                    <span className="truncate">Chaves SSH &amp; Git/CLI Configs</span>
                  </span>
                  <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
                    {enabledVaultCount}/{vaultItems.length} itens → vault/
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowVaultList((v) => !v);
                }}
                className="flex shrink-0 items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-[10px] text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] cursor-pointer"
              >
                <span>Itens</span>
                {showVaultList ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </div>

            {showVaultList && (
              <div className="flex flex-col gap-2 border-t border-[#313244] bg-[#11111b]/70 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-[#cba6f7]">VAULT ITEMS</span>
                  <button
                    type="button"
                    onClick={() => setShowAddVault((v) => !v)}
                    disabled={disabled}
                    className="font-mono text-[10px] text-[#cba6f7] hover:underline cursor-pointer"
                  >
                    {showAddVault ? 'Fechar' : '+ Novo item'}
                  </button>
                </div>

                {showAddVault && (
                  <form onSubmit={handleAddVaultItem} className="flex flex-col gap-1.5">
                    <input
                      type="text"
                      value={vaultLabel}
                      onChange={(e) => setVaultLabel(e.target.value)}
                      placeholder="Rótulo (ex: GPG Keys)"
                      className="border border-[#313244] bg-[#181825] px-2 py-1 text-[11px] text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
                      required
                    />
                    <input
                      type="text"
                      value={vaultSource}
                      onChange={(e) => setVaultSource(e.target.value)}
                      placeholder="%USERPROFILE%\.gnupg"
                      className="border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[11px] text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
                      required
                    />
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={vaultSubpath}
                        onChange={(e) => setVaultSubpath(e.target.value)}
                        placeholder="vault/gnupg"
                        className="min-w-0 flex-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[11px] text-[#a6e3a1] focus:border-[#cba6f7] focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="bg-[#cba6f7] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#11111b] cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex flex-col divide-y divide-[#313244]/70 border border-[#313244]">
                  {vaultItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => !disabled && toggleVaultItem(item.id)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] ${
                        item.enabled ? '' : 'opacity-50'
                      } cursor-pointer hover:bg-[#1e1e2e]`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <TuiCheckbox
                          checked={item.enabled}
                          onChange={() => toggleVaultItem(item.id)}
                          ariaLabel={`Ativar ${item.label}`}
                          disabled={disabled}
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[#cdd6f4]">{item.label}</span>
                          <span className="truncate font-mono text-[10px] text-[#7f849c]">
                            {item.source_path}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteVaultItem(item.id);
                        }}
                        disabled={disabled}
                        className="p-1 text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2. Dotfiles & Temas Mapeados */}
          <div
            onClick={() =>
              !disabled &&
              onUpdateScopeFlags({ collectDotfiles: !scopeFlags.collectDotfiles })
            }
            className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors ${
              scopeFlags.collectDotfiles ? '' : 'opacity-60'
            } ${disabled ? '' : 'cursor-pointer hover:bg-[#313244]/30'}`}
          >
            <div className="mt-0.5">
              <TuiCheckbox
                checked={scopeFlags.collectDotfiles}
                onChange={(checked) => onUpdateScopeFlags({ collectDotfiles: checked })}
                ariaLabel="Coletar Dotfiles e Temas Mapeados"
                disabled={disabled}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#cdd6f4]">
                <Layers className="h-3 w-3 shrink-0 text-[#cba6f7]" />
                <span>Dotfiles &amp; Temas Mapeados</span>
              </span>
              <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
                {enabledDotfilesCount}/{profile.dotfiles.mappings.length} mapeamentos → dotfiles/
              </span>
            </div>
          </div>

          {/* 3. WinGet + Relatório de Apps Manuais */}
          <div
            onClick={() =>
              !disabled &&
              onUpdateScopeFlags({
                collectWingetAndManualReport: !scopeFlags.collectWingetAndManualReport,
              })
            }
            className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors ${
              scopeFlags.collectWingetAndManualReport ? '' : 'opacity-60'
            } ${disabled ? '' : 'cursor-pointer hover:bg-[#313244]/30'}`}
          >
            <div className="mt-0.5">
              <TuiCheckbox
                checked={scopeFlags.collectWingetAndManualReport}
                onChange={(checked) =>
                  onUpdateScopeFlags({ collectWingetAndManualReport: checked })
                }
                ariaLabel="Lista de Pacotes WinGet e Relatório de Apps Manuais"
                disabled={disabled}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#cdd6f4]">
                <PackageSearch className="h-3 w-3 shrink-0 text-[#a6e3a1]" />
                <span>Pacotes WinGet + Apps Manuais</span>
              </span>
              <span className="font-mono text-[10px] text-[#7f849c]">
                winget export + diff HKLM/HKCU → manual_apps_report.md
              </span>
            </div>
          </div>

          {/* 4. VS Code Extensions */}
          <div
            onClick={() =>
              !disabled &&
              onUpdateScopeFlags({
                collectVscodeExtensions: !scopeFlags.collectVscodeExtensions,
              })
            }
            className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors ${
              scopeFlags.collectVscodeExtensions ? '' : 'opacity-60'
            } ${disabled ? '' : 'cursor-pointer hover:bg-[#313244]/30'}`}
          >
            <div className="mt-0.5">
              <TuiCheckbox
                checked={scopeFlags.collectVscodeExtensions}
                onChange={(checked) =>
                  onUpdateScopeFlags({ collectVscodeExtensions: checked })
                }
                ariaLabel="Coletar Extensões do VS Code"
                disabled={disabled}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#cdd6f4]">
                <Puzzle className="h-3 w-3 shrink-0 text-[#89b4fa]" />
                <span>Extensões do VS Code</span>
              </span>
              <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
                code --list-extensions ({(profile.vscode_extensions ?? []).length} atuais)
              </span>
            </div>
          </div>

          {/* 5. Perfis Wi-Fi */}
          <div
            onClick={() =>
              !disabled && onUpdateProfileHarvestFields({ backup_wifi: !backupWifi })
            }
            className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors ${
              backupWifi ? '' : 'opacity-60'
            } ${disabled ? '' : 'cursor-pointer hover:bg-[#313244]/30'}`}
          >
            <div className="mt-0.5">
              <TuiCheckbox
                checked={backupWifi}
                onChange={(checked) =>
                  onUpdateProfileHarvestFields({ backup_wifi: checked })
                }
                ariaLabel="Exportar Perfis de Wi-Fi com senhas"
                disabled={disabled}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#cdd6f4]">
                <Wifi className="h-3 w-3 shrink-0 text-[#89b4fa]" />
                <span>Perfis de Wi-Fi (com senhas)</span>
              </span>
              <span className="font-mono text-[10px] text-[#7f849c]">
                netsh wlan export profile key=clear → vault/wifi/
              </span>
            </div>
          </div>

          {/* 6. Backup de Drivers */}
          <div
            onClick={() =>
              !disabled && onUpdateProfileHarvestFields({ backup_drivers: !backupDrivers })
            }
            className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors ${
              backupDrivers ? '' : 'opacity-60'
            } ${disabled ? '' : 'cursor-pointer hover:bg-[#313244]/30'}`}
          >
            <div className="mt-0.5">
              <TuiCheckbox
                checked={backupDrivers}
                onChange={(checked) =>
                  onUpdateProfileHarvestFields({ backup_drivers: checked })
                }
                ariaLabel="Backup de Drivers via pnputil"
                disabled={disabled}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#cdd6f4]">
                <Cpu className="h-3 w-3 shrink-0 text-[#fab387]" />
                <span>Backup de Drivers (pnputil)</span>
              </span>
              <span className="font-mono text-[10px] text-[#7f849c]">
                pnputil /export-driver * → drivers/
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Extra Save Paths */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#a6adc8]">
            <HardDrive className="h-3 w-3 text-[#cba6f7]" />
            <span>SAVES / PASTAS EXTRAS</span>
          </span>
          <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
            {extraSavePaths.length} caminho(s)
          </span>
        </div>

        <form onSubmit={handleAddSavePath} className="flex items-center gap-1.5">
          <input
            type="text"
            value={newSavePath}
            onChange={(e) => setNewSavePath(e.target.value)}
            disabled={disabled}
            placeholder="%USERPROFILE%\Documents\My Games"
            aria-label="Adicionar caminho extra para backup"
            className="min-w-0 flex-1 border border-[#313244] bg-[#181825] px-2.5 py-1.5 font-mono text-[11px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
          />
          {isTauri && (
            <button
              type="button"
              onClick={handleBrowseExtraSave}
              disabled={disabled}
              title="Procurar pasta"
              className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#313244] bg-[#181825] text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cdd6f4] cursor-pointer"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="submit"
            disabled={disabled || !newSavePath.trim()}
            title="Adicionar caminho"
            className="flex h-8 shrink-0 items-center gap-1 border border-[#cba6f7] bg-[#cba6f7]/15 px-2.5 font-mono text-[11px] font-medium text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] disabled:opacity-40 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </form>

        {extraSavePaths.length > 0 && (
          <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
            {extraSavePaths.map((savePath, index) => {
              const isEditing = editingSaveIndex === index;
              return (
                <div
                  key={`${savePath}_${index}`}
                  className="flex items-center justify-between gap-2 px-2.5 py-2"
                >
                  {isEditing ? (
                    <div className="flex flex-1 items-center gap-1.5">
                      <input
                        type="text"
                        value={editingSaveValue}
                        onChange={(e) => setEditingSaveValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEditSavePath();
                          if (e.key === 'Escape') setEditingSaveIndex(null);
                        }}
                        className="min-w-0 flex-1 border border-[#cba6f7] bg-[#1e1e2e] px-2 py-0.5 font-mono text-[11px] text-[#cdd6f4] focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={commitEditSavePath}
                        className="p-1 text-[#a6e3a1] cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSaveIndex(null)}
                        className="p-1 text-[#a6adc8] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="truncate font-mono text-[11px] text-[#bac2de]">
                        {savePath}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditSavePath(index)}
                          disabled={disabled}
                          title="Editar"
                          className="p-1 text-[#7f849c] hover:text-[#cba6f7] cursor-pointer"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSavePath(index)}
                          disabled={disabled}
                          title="Remover"
                          className="p-1 text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Security Privacy Notice + Primary CTA */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-start gap-2 border border-[#fab387]/35 bg-[#fab387]/8 px-3 py-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fab387]" />
          <p className="text-[11px] leading-relaxed text-[#bac2de]">
            <span className="font-semibold text-[#fab387]">Privacidade:</span> nunca suba a pasta{' '}
            <code className="font-mono text-[#fab387]">vault/</code> para repositórios públicos
            (contém chaves SSH e senhas Wi-Fi).
          </p>
        </div>

        <button
          type="button"
          onClick={handleGenerateBundle}
          disabled={disabled || activeCollectorsCount === 0}
          className="tui-chamfer flex h-10 w-full items-center justify-center gap-2 bg-[#cba6f7] px-4 font-mono text-xs font-bold tracking-wide text-[#11111b] hover:bg-[#d8b8ff] active:translate-y-[1px] transition-all whitespace-nowrap disabled:opacity-40 cursor-pointer"
        >
          {isHarvesting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          <span>
            {isHarvesting ? 'GERANDO BUNDLE...' : 'GENERATE PORTABLE BUNDLE'}
          </span>
        </button>
      </section>

      {/* Last Harvest Report Preview */}
      {lastResult && (
        <section className="flex flex-col gap-2 border border-[#a6e3a1]/40 bg-[#181825] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#a6e3a1]">
              <FileText className="h-3.5 w-3.5" />
              <span>Bundle gerado</span>
            </span>
            <span className="font-mono text-[10px] text-[#a6adc8] tabular-nums">
              {lastResult.copiedVaultFiles}v · {lastResult.copiedDotfileFiles}d · {lastResult.manualAppsCount} manuais
            </span>
          </div>
          {lastResult.manualReportMarkdown && (
            <div className="flex flex-col gap-1.5 border border-[#313244] bg-[#11111b] p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[#cdd6f4]">
                  manual_apps_report.md
                </span>
                <button
                  type="button"
                  onClick={handleDownloadReport}
                  className="flex items-center gap-1 border border-[#a6e3a1]/50 px-2 py-0.5 font-mono text-[10px] text-[#a6e3a1] hover:bg-[#a6e3a1] hover:text-[#11111b] cursor-pointer"
                >
                  <Download className="h-2.5 w-2.5" />
                  <span>Baixar .md</span>
                </button>
              </div>
              <pre className="max-h-36 overflow-auto font-mono text-[10px] leading-4 text-[#bac2de]">
                {lastResult.manualReportMarkdown}
              </pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
