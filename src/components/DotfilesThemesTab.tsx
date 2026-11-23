import React, { useState } from 'react';
import {
  ArrowRight,
  FileCode2,
  FolderGit2,
  Loader2,
  Plus,
  RefreshCw,
  Skull,
  Trash2,
  X,
} from 'lucide-react';
import {
  DotfileMapping,
  DotfilesConfig,
  RegistryFile,
  ReverseSyncResult,
} from '../types/profile';
import { TuiCheckbox } from './TuiCheckbox';

interface DotfilesThemesTabProps {
  dotfiles: DotfilesConfig;
  registryFiles: RegistryFile[];
  isTauri: boolean;
  isSyncingReverse: boolean;
  lastSyncResult: ReverseSyncResult | null;
  disabled: boolean;
  onUpdateRepoUrl: (url: string) => void;
  onToggleMapping: (id: string) => void;
  onAddMapping: (mapping: DotfileMapping) => void;
  onDeleteMapping: (id: string) => void;
  onToggleRegistryFile: (id: string) => void;
  onAddRegistryFile: (reg: RegistryFile) => void;
  onDeleteRegistryFile: (id: string) => void;
  onSyncReverse: () => void;
}

function renderEnvHighlightedPath(pathStr: string) {
  const parts = pathStr.split(/(%[A-Z0-9_]+%)/gi);
  return parts.map((part, idx) =>
    /^%[A-Z0-9_]+%$/i.test(part) ? (
      <span key={idx} className="text-[#cba6f7] font-medium">
        {part}
      </span>
    ) : (
      <span key={idx}>{part}</span>
    )
  );
}

export function DotfilesThemesTab({
  dotfiles,
  registryFiles,
  isTauri,
  isSyncingReverse,
  lastSyncResult,
  disabled,
  onUpdateRepoUrl,
  onToggleMapping,
  onAddMapping,
  onDeleteMapping,
  onToggleRegistryFile,
  onAddRegistryFile,
  onDeleteRegistryFile,
  onSyncReverse,
}: DotfilesThemesTabProps) {
  const [showAddMap, setShowAddMap] = useState(false);
  const [mapLabel, setMapLabel] = useState('');
  const [mapSource, setMapSource] = useState('');
  const [mapTarget, setMapTarget] = useState('%USERPROFILE%\\.config\\');
  const [mapKill, setMapKill] = useState('');

  const [showAddReg, setShowAddReg] = useState(false);
  const [regLabel, setRegLabel] = useState('');
  const [regPath, setRegPath] = useState('./');

  const handleAddMappingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapLabel.trim() || !mapSource.trim() || !mapTarget.trim()) return;
    const id =
      mapLabel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 24) || `map_${Date.now()}`;

    onAddMapping({
      id,
      label: mapLabel.trim(),
      source: mapSource.trim(),
      target: mapTarget.trim(),
      kill_process: mapKill.trim(),
      enabled: true,
    });

    setMapLabel('');
    setMapSource('');
    setMapTarget('%USERPROFILE%\\.config\\');
    setMapKill('');
    setShowAddMap(false);
  };

  const handleAddRegSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regLabel.trim() || !regPath.trim()) return;
    const id =
      regLabel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 24) || `reg_${Date.now()}`;

    onAddRegistryFile({
      id,
      label: regLabel.trim(),
      path: regPath.trim(),
      enabled: true,
    });

    setRegLabel('');
    setRegPath('./');
    setShowAddReg(false);
  };

  return (
    <div className="flex flex-col gap-4 p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#313244] pb-2">
        <h2 className="font-mono text-xs font-bold text-[#cba6f7]">
          [03] DOTFILES &amp; THEMES
        </h2>
        <span className="font-mono text-[10px] text-[#7f849c]">Estágios 3 &amp; 4</span>
      </div>

      {/* Git Repository URL Panel */}
      <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-[#cba6f7]" />
          <label htmlFor="dotfiles-repo-url" className="font-mono text-[11px] font-semibold text-[#cdd6f4]">
            dotfiles.repo_url
          </label>
        </div>

        <input
          id="dotfiles-repo-url"
          type="url"
          value={dotfiles.repo_url}
          onChange={(e) => onUpdateRepoUrl(e.target.value)}
          disabled={disabled}
          placeholder="https://github.com/usuario/dotfiles.git"
          className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#89b4fa] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
        />

        <p className="font-mono text-[10px] text-[#7f849c]">
          Vars: <span className="text-[#cba6f7]">%USERPROFILE%</span> ·{' '}
          <span className="text-[#cba6f7]">%APPDATA%</span> ·{' '}
          <span className="text-[#cba6f7]">%LOCALAPPDATA%</span>
        </p>

        {/* Reverse Sync Action */}
        <div className="mt-1 flex flex-col gap-1.5 border-t border-[#313244] pt-2.5">
          <button
            type="button"
            onClick={onSyncReverse}
            disabled={disabled || isSyncingReverse || !isTauri}
            className="tui-chamfer flex w-full items-center justify-center gap-2 bg-[#cba6f7] px-3 py-2 font-mono text-[11px] font-bold text-[#11111b] hover:bg-[#d8b8ff] transition-colors disabled:opacity-45 cursor-pointer"
          >
            {isSyncingReverse ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{isSyncingReverse ? 'SINCRONIZANDO...' : 'SYNC TO REPO / VAULT'}</span>
          </button>
          <p className="font-mono text-[9px] text-[#7f849c]">
            Copia configs atuais (YASB, Flow, Terminal, .ssh + Windhawk .reg) p/ bundle e faz git commit/push se configurado.
          </p>

          {lastSyncResult && (
            <div className="border border-[#a6e3a1]/35 bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[10px] text-[#cdd6f4]">
              <div className="text-[#a6e3a1]">
                Sync OK: {lastSyncResult.copiedDotfiles} dotfile(s) · {lastSyncResult.copiedVaultFiles} vault · Windhawk .reg {lastSyncResult.exportedWindhawkReg ? 'OK' : 'N/A'}
              </div>
              <div className="truncate text-[9px] text-[#89b4fa]">
                {lastSyncResult.gitMessage}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Dotfile Mappings Section */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h3 className="text-xs font-semibold text-[#cdd6f4]">Mapeamentos</h3>
            <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
              {dotfiles.mappings.filter((m) => m.enabled).length}/{dotfiles.mappings.length}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowAddMap((v) => !v)}
            disabled={disabled}
            className="flex items-center gap-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#cba6f7] hover:border-[#cba6f7] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
          >
            {showAddMap ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            <span>{showAddMap ? 'Fechar' : 'Novo Mapa'}</span>
          </button>
        </div>

        {showAddMap && (
          <form
            onSubmit={handleAddMappingSubmit}
            className="flex flex-col gap-2 border border-[#cba6f7]/60 bg-[#181825] p-3"
          >
            <input
              type="text"
              value={mapLabel}
              onChange={(e) => setMapLabel(e.target.value)}
              placeholder="Nome (ex: Fastfetch Config)"
              className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={mapSource}
                onChange={(e) => setMapSource(e.target.value)}
                placeholder="source (ex: fastfetch/*)"
                className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
                required
              />
              <input
                type="text"
                value={mapKill}
                onChange={(e) => setMapKill(e.target.value)}
                placeholder="kill_process (opcional)"
                className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#fab387] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              />
            </div>
            <input
              type="text"
              value={mapTarget}
              onChange={(e) => setMapTarget(e.target.value)}
              placeholder="target (ex: %USERPROFILE%\.config\fastfetch)"
              className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              required
            />
            <button
              type="submit"
              className="border border-[#cba6f7] bg-[#cba6f7] py-1.5 font-mono text-xs font-semibold text-[#11111b] hover:bg-[#cba6f7]/90 transition-colors cursor-pointer"
            >
              Adicionar Mapeamento
            </button>
          </form>
        )}

        {dotfiles.mappings.length === 0 ? (
          <div className="border border-[#313244] bg-[#181825] p-4 text-center font-mono text-[11px] text-[#7f849c]">
            Nenhum mapeamento de dotfile configurado.
          </div>
        ) : (
          <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
            {dotfiles.mappings.map((mapping) => (
              <div
                key={mapping.id}
                onClick={() => !disabled && onToggleMapping(mapping.id)}
                className={`flex flex-col gap-1.5 px-3 py-2.5 transition-colors ${
                  mapping.enabled ? '' : 'opacity-55'
                } ${!disabled ? 'cursor-pointer hover:bg-[#313244]/35' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5">
                      <TuiCheckbox
                        checked={mapping.enabled}
                        onChange={() => onToggleMapping(mapping.id)}
                        ariaLabel={`Ativar mapeamento ${mapping.label}`}
                        disabled={disabled}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-[#cdd6f4]">
                          {mapping.label}
                        </span>
                        {mapping.kill_process && (
                          <span
                            title="Processo encerrado via taskkill antes de copiar"
                            className="inline-flex items-center gap-1 border border-[#fab387]/40 bg-[#fab387]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#fab387]"
                          >
                            <Skull className="h-2.5 w-2.5" />
                            <span>{mapping.kill_process}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
                        <span className="text-[#a6e3a1] break-all">{mapping.source}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-[#6c7086]" />
                        <span className="break-all text-[#bac2de]">
                          {renderEnvHighlightedPath(mapping.target)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteMapping(mapping.id);
                    }}
                    disabled={disabled}
                    title="Remover mapeamento"
                    className="shrink-0 p-1 text-[#6c7086] hover:text-[#f38ba8] transition-colors disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Registry Files (.reg) Section */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h3 className="text-xs font-semibold text-[#cdd6f4]">Arquivos .reg</h3>
            <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
              {registryFiles.filter((r) => r.enabled).length}/{registryFiles.length}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowAddReg((v) => !v)}
            disabled={disabled}
            className="flex items-center gap-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#cba6f7] hover:border-[#cba6f7] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
          >
            {showAddReg ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            <span>{showAddReg ? 'Fechar' : 'Add .reg'}</span>
          </button>
        </div>

        {showAddReg && (
          <form
            onSubmit={handleAddRegSubmit}
            className="flex flex-col gap-2 border border-[#cba6f7]/60 bg-[#181825] p-3"
          >
            <input
              type="text"
              value={regLabel}
              onChange={(e) => setRegLabel(e.target.value)}
              placeholder="Descrição (ex: Windhawk Taskbar Theme)"
              className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              required
            />
            <input
              type="text"
              value={regPath}
              onChange={(e) => setRegPath(e.target.value)}
              placeholder="Caminho (ex: ./windhawk.reg)"
              className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#89b4fa] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              required
            />
            <button
              type="submit"
              className="border border-[#cba6f7] bg-[#cba6f7] py-1.5 font-mono text-xs font-semibold text-[#11111b] hover:bg-[#cba6f7]/90 transition-colors cursor-pointer"
            >
              Adicionar .reg
            </button>
          </form>
        )}

        {registryFiles.length === 0 ? (
          <div className="border border-[#313244] bg-[#181825] p-4 text-center font-mono text-[11px] text-[#7f849c]">
            Nenhum arquivo .reg cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
            {registryFiles.map((reg) => (
              <div
                key={reg.id}
                onClick={() => !disabled && onToggleRegistryFile(reg.id)}
                className={`flex items-center justify-between gap-2.5 px-3 py-2.5 transition-colors ${
                  reg.enabled ? '' : 'opacity-55'
                } ${!disabled ? 'cursor-pointer hover:bg-[#313244]/35' : ''}`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <TuiCheckbox
                    checked={reg.enabled}
                    onChange={() => onToggleRegistryFile(reg.id)}
                    ariaLabel={`Ativar importação de ${reg.label}`}
                    disabled={disabled}
                  />
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#cba6f7]" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium text-[#cdd6f4]">
                      {reg.label}
                    </span>
                    <span className="truncate font-mono text-[10px] text-[#89b4fa]">
                      {reg.path}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteRegistryFile(reg.id);
                  }}
                  disabled={disabled}
                  title="Remover arquivo .reg"
                  className="shrink-0 p-1 text-[#6c7086] hover:text-[#f38ba8] transition-colors disabled:opacity-30 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
