import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  WingetInstalledItem,
  WingetSearchItem,
  WingetUpdateItem,
} from '../types/profile';
import { TuiCheckbox } from './TuiCheckbox';

export type PkgMgrSubTab = 'updates' | 'search' | 'installed';

interface PkgManagerTabProps {
  subTab: PkgMgrSubTab;
  onChangeSubTab: (tab: PkgMgrSubTab) => void;
  isTauri: boolean;
  disabled: boolean;
  profilePackageIds: Set<string>;
  // Updates state
  updates: WingetUpdateItem[];
  hasCheckedUpdates: boolean;
  isCheckingUpdates: boolean;
  isUpgrading: boolean;
  onCheckUpdates: () => void;
  onUpgradeSelected: (ids: string[]) => void;
  // Search & Install state
  searchResults: WingetSearchItem[];
  isSearching: boolean;
  installingId: string | null;
  onSearchPackages: (query: string) => void;
  onInstallPackage: (item: WingetSearchItem, addToProfile: boolean) => void;
  // Installed state
  installed: WingetInstalledItem[];
  hasLoadedInstalled: boolean;
  isLoadingInstalled: boolean;
  uninstallingId: string | null;
  onLoadInstalled: () => void;
  onUninstallPackage: (item: WingetInstalledItem) => void;
}

export function PkgManagerTab({
  subTab,
  onChangeSubTab,
  isTauri,
  disabled,
  profilePackageIds,
  updates,
  hasCheckedUpdates,
  isCheckingUpdates,
  isUpgrading,
  onCheckUpdates,
  onUpgradeSelected,
  searchResults,
  isSearching,
  installingId,
  onSearchPackages,
  onInstallPackage,
  installed,
  hasLoadedInstalled,
  isLoadingInstalled,
  uninstallingId,
  onLoadInstalled,
  onUninstallPackage,
}: PkgManagerTabProps) {
  const [selectedUpdateIds, setSelectedUpdateIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [addToProfile, setAddToProfile] = useState(true);
  const [installedFilter, setInstalledFilter] = useState('');
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(null);

  // Keep selection synced only to currently available updates
  const validSelectedIds = useMemo(() => {
    const valid = new Set(updates.map((u) => u.id));
    return Array.from(selectedUpdateIds).filter((id) => valid.has(id));
  }, [updates, selectedUpdateIds]);

  const toggleUpdateId = (id: string) => {
    setSelectedUpdateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllUpdates = () => {
    if (validSelectedIds.length === updates.length && updates.length > 0) {
      setSelectedUpdateIds(new Set());
    } else {
      setSelectedUpdateIds(new Set(updates.map((u) => u.id)));
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || disabled || isSearching) return;
    onSearchPackages(searchQuery.trim());
  };

  const filteredInstalled = useMemo(() => {
    const q = installedFilter.trim().toLowerCase();
    if (!q) return installed;
    return installed.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(q) ||
        pkg.id.toLowerCase().includes(q) ||
        pkg.version.toLowerCase().includes(q)
    );
  }, [installed, installedFilter]);

  const busy = disabled || isUpgrading || Boolean(installingId) || Boolean(uninstallingId);

  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#313244] pb-2">
        <h2 className="font-mono text-xs font-bold text-[#cba6f7]">
          [05] PKG MANAGER
        </h2>
        <span className="font-mono text-[10px] text-[#7f849c]">UniGet Mode</span>
      </div>

      {/* Sub-tabs */}
      <div className="grid grid-cols-3 border border-[#313244] bg-[#181825] p-0.5 font-mono text-[10px]">
        <button
          type="button"
          onClick={() => onChangeSubTab('updates')}
          className={`py-1.5 transition-colors cursor-pointer ${
            subTab === 'updates'
              ? 'bg-[#cba6f7] font-semibold text-[#11111b]'
              : 'text-[#a6adc8] hover:text-[#cdd6f4]'
          }`}
        >
          Updates{hasCheckedUpdates ? ` (${updates.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => onChangeSubTab('search')}
          className={`py-1.5 transition-colors cursor-pointer ${
            subTab === 'search'
              ? 'bg-[#cba6f7] font-semibold text-[#11111b]'
              : 'text-[#a6adc8] hover:text-[#cdd6f4]'
          }`}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => onChangeSubTab('installed')}
          className={`py-1.5 transition-colors cursor-pointer ${
            subTab === 'installed'
              ? 'bg-[#cba6f7] font-semibold text-[#11111b]'
              : 'text-[#a6adc8] hover:text-[#cdd6f4]'
          }`}
        >
          Installed{hasLoadedInstalled ? ` (${installed.length})` : ''}
        </button>
      </div>

      {!isTauri && (
        <div className="border border-[#fab387]/40 bg-[#fab387]/10 px-3 py-2 font-mono text-[10px] text-[#fab387]">
          WinGet ao vivo requer o executável desktop WinForge.exe no Windows.
        </div>
      )}

      {/* SUB-TAB 1: UPDATES */}
      {subTab === 'updates' && (
        <section className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={busy || isCheckingUpdates || !isTauri}
              className="flex items-center gap-1.5 border border-[#313244] bg-[#181825] px-2.5 py-1.5 font-mono text-[10px] font-medium text-[#cdd6f4] hover:border-[#cba6f7] hover:text-[#cba6f7] transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isCheckingUpdates ? (
                <Loader2 className="h-3 w-3 animate-spin text-[#cba6f7]" />
              ) : (
                <RefreshCw className="h-3 w-3 text-[#cba6f7]" />
              )}
              <span>{isCheckingUpdates ? 'Checando...' : 'Checar Updates'}</span>
            </button>

            <div className="flex items-center gap-1.5">
              {updates.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAllUpdates}
                  disabled={busy}
                  className="border border-[#313244] bg-[#181825] px-2 py-1.5 font-mono text-[10px] text-[#a6adc8] hover:text-[#cdd6f4] disabled:opacity-40 cursor-pointer"
                >
                  {validSelectedIds.length === updates.length ? 'Limpar' : 'Todos'}
                </button>
              )}

              <button
                type="button"
                onClick={() => onUpgradeSelected(validSelectedIds)}
                disabled={busy || validSelectedIds.length === 0 || !isTauri}
                className="tui-chamfer flex items-center gap-1.5 bg-[#a6e3a1] px-2.5 py-1.5 font-mono text-[10px] font-bold text-[#11111b] hover:bg-[#b7ebb3] transition-colors disabled:opacity-40 cursor-pointer"
              >
                {isUpgrading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                <span>UPDATE SELECTED ({validSelectedIds.length})</span>
              </button>
            </div>
          </div>

          {isCheckingUpdates ? (
            <div className="flex items-center justify-center gap-2 border border-[#313244] bg-[#181825] p-6 font-mono text-[11px] text-[#a6adc8]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#cba6f7]" />
              <span>Executando winget upgrade --include-unknown...</span>
            </div>
          ) : !hasCheckedUpdates ? (
            <div className="border border-[#313244] bg-[#181825]/70 p-4 text-center font-mono text-[11px] text-[#7f849c]">
              Clique em &quot;Checar Updates&quot; para consultar pacotes desatualizados via WinGet.
            </div>
          ) : updates.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 border border-[#a6e3a1]/30 bg-[#181825] p-5 text-center font-mono text-[11px] text-[#a6e3a1]">
              <PackageCheck className="h-4 w-4" />
              <span>Todos os pacotes WinGet estão atualizados!</span>
            </div>
          ) : (
            <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
              {updates.map((pkg) => {
                const checked = selectedUpdateIds.has(pkg.id);
                return (
                  <div
                    key={pkg.id}
                    onClick={() => !busy && toggleUpdateId(pkg.id)}
                    className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors ${
                      !busy ? 'cursor-pointer hover:bg-[#313244]/35' : 'opacity-60'
                    }`}
                  >
                    <div className="mt-0.5">
                      <TuiCheckbox
                        checked={checked}
                        onChange={() => toggleUpdateId(pkg.id)}
                        ariaLabel={`Selecionar atualização para ${pkg.name}`}
                        disabled={busy}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium text-[#cdd6f4]">
                        {pkg.name}
                      </span>
                      <span className="truncate font-mono text-[10px] text-[#89b4fa]">
                        {pkg.id}
                      </span>
                      <div className="flex items-center gap-1 font-mono text-[10px]">
                        <span className="text-[#7f849c]">{pkg.version || 'Unknown'}</span>
                        <ArrowRight className="h-2.5 w-2.5 text-[#6c7086]" />
                        <span className="font-semibold text-[#a6e3a1]">{pkg.available}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 2: SEARCH & INSTALL */}
      {subTab === 'search' && (
        <section className="flex flex-col gap-2.5">
          <form onSubmit={handleSearchSubmit} className="flex gap-1.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6c7086]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={busy || isSearching}
                placeholder='winget search (ex: obsidian, git, 7zip)'
                className="w-full border border-[#313244] bg-[#181825] py-1.5 pl-8 pr-2.5 font-mono text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={busy || isSearching || !searchQuery.trim() || !isTauri}
              className="flex items-center gap-1 border border-[#cba6f7] bg-[#cba6f7] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#11111b] hover:bg-[#d8b8ff] transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>Buscar</span>}
            </button>
          </form>

          {/* Add to profile.json toggle */}
          <div
            onClick={() => setAddToProfile((v) => !v)}
            className="flex cursor-pointer items-center gap-2 border border-[#313244] bg-[#181825] px-2.5 py-2"
          >
            <TuiCheckbox
              checked={addToProfile}
              onChange={setAddToProfile}
              ariaLabel="Adicionar pacote instalado automaticamente ao profile.json"
            />
            <div className="flex min-w-0 flex-col">
              <span className="font-mono text-[11px] font-medium text-[#cdd6f4]">
                Add to profile.json
              </span>
              <span className="font-mono text-[9px] text-[#7f849c]">
                Mantém o manifesto de pós-formatação atualizado ao instalar
              </span>
            </div>
          </div>

          {isSearching ? (
            <div className="flex items-center justify-center gap-2 border border-[#313244] bg-[#181825] p-6 font-mono text-[11px] text-[#a6adc8]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#cba6f7]" />
              <span>Buscando no repositório WinGet...</span>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="border border-[#313244] bg-[#181825]/70 p-4 text-center font-mono text-[11px] text-[#7f849c]">
              Digite o nome ou ID de um app e clique em Buscar para instalar via WinGet.
            </div>
          ) : (
            <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
              {searchResults.map((item) => {
                const inProfile = profilePackageIds.has(item.id.toLowerCase());
                const isInstallingThis = installingId === item.id;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-[#cdd6f4]">
                          {item.name}
                        </span>
                        {inProfile && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[9px] text-[#a6e3a1]">
                            <Check className="h-2.5 w-2.5" />
                            <span>perfil</span>
                          </span>
                        )}
                      </div>
                      <span className="truncate font-mono text-[10px] text-[#89b4fa]">
                        {item.id}
                      </span>
                      <span className="font-mono text-[9px] text-[#7f849c]">
                        v{item.version || '—'} · {item.source || 'winget'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onInstallPackage(item, addToProfile)}
                      disabled={busy || !isTauri}
                      className="flex shrink-0 items-center gap-1 border border-[#a6e3a1]/60 bg-[#a6e3a1]/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-[#a6e3a1] hover:bg-[#a6e3a1] hover:text-[#11111b] transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      {isInstallingThis ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      <span>{isInstallingThis ? '...' : 'INSTALL'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 3: INSTALLED */}
      {subTab === 'installed' && (
        <section className="flex flex-col gap-2.5">
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6c7086]" />
              <input
                type="text"
                value={installedFilter}
                onChange={(e) => setInstalledFilter(e.target.value)}
                placeholder="Filtrar pacotes instalados..."
                className="w-full border border-[#313244] bg-[#181825] py-1.5 pl-8 pr-2.5 font-mono text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={onLoadInstalled}
              disabled={busy || isLoadingInstalled || !isTauri}
              className="flex items-center gap-1 border border-[#313244] bg-[#181825] px-2.5 py-1.5 font-mono text-[10px] text-[#cdd6f4] hover:border-[#cba6f7] hover:text-[#cba6f7] transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isLoadingInstalled ? (
                <Loader2 className="h-3 w-3 animate-spin text-[#cba6f7]" />
              ) : (
                <RefreshCw className="h-3 w-3 text-[#cba6f7]" />
              )}
              <span>Listar</span>
            </button>
          </div>

          {isLoadingInstalled ? (
            <div className="flex items-center justify-center gap-2 border border-[#313244] bg-[#181825] p-6 font-mono text-[11px] text-[#a6adc8]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#cba6f7]" />
              <span>Executando winget list...</span>
            </div>
          ) : !hasLoadedInstalled ? (
            <div className="border border-[#313244] bg-[#181825]/70 p-4 text-center font-mono text-[11px] text-[#7f849c]">
              Clique em &quot;Listar&quot; para carregar os pacotes instalados via WinGet.
            </div>
          ) : filteredInstalled.length === 0 ? (
            <div className="border border-[#313244] bg-[#181825]/70 p-4 text-center font-mono text-[11px] text-[#7f849c]">
              Nenhum pacote corresponde ao filtro.
            </div>
          ) : (
            <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
              {filteredInstalled.map((pkg) => {
                const isRemoving = uninstallingId === pkg.id;
                const isConfirming = confirmUninstallId === pkg.id;
                return (
                  <div
                    key={`${pkg.id}_${pkg.version}`}
                    className="flex items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium text-[#cdd6f4]">
                        {pkg.name}
                      </span>
                      <span className="truncate font-mono text-[10px] text-[#89b4fa]">
                        {pkg.id}
                      </span>
                      <span className="font-mono text-[9px] text-[#7f849c]">
                        v{pkg.version || '—'}
                        {pkg.available ? (
                          <span className="text-[#fab387]"> -&gt; {pkg.available}</span>
                        ) : null}
                      </span>
                    </div>

                    {isConfirming ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmUninstallId(null);
                            onUninstallPackage(pkg);
                          }}
                          disabled={busy || !isTauri}
                          className="border border-[#f38ba8] bg-[#f38ba8] px-2 py-1 font-mono text-[10px] font-bold text-[#11111b] hover:bg-[#f38ba8]/90 disabled:opacity-40 cursor-pointer"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmUninstallId(null)}
                          className="border border-[#313244] px-1.5 py-1 font-mono text-[10px] text-[#a6adc8] hover:text-[#cdd6f4] cursor-pointer"
                        >
                          X
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmUninstallId(pkg.id)}
                        disabled={busy || !isTauri}
                        className="flex shrink-0 items-center gap-1 border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-2 py-1 font-mono text-[10px] font-semibold text-[#f38ba8] hover:bg-[#f38ba8] hover:text-[#11111b] transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        {isRemoving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        <span>{isRemoving ? '...' : 'UNINSTALL'}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
