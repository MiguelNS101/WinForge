import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  FileArchive,
  Package,
  Pencil,
  Plus,
  Puzzle,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { PortableApp, WingetPackage } from '../types/profile';
import { TuiCheckbox } from './TuiCheckbox';

interface PackagesTabProps {
  packages: WingetPackage[];
  portableApps: PortableApp[];
  vscodeExtensions: string[];
  disabled: boolean;
  onTogglePackage: (id: string) => void;
  onToggleMany: (ids: string[], enabled: boolean) => void;
  onAddPackage: (pkg: WingetPackage) => void;
  onDeletePackage: (id: string) => void;
  onTogglePortableApp: (id: string) => void;
  onTogglePortableAddToPath: (id: string) => void;
  onAddPortableApp: (app: PortableApp) => void;
  onUpdatePortableApp: (app: PortableApp) => void;
  onDeletePortableApp: (id: string) => void;
  onAddVscodeExtensions: (ids: string[]) => void;
  onDeleteVscodeExtension: (id: string) => void;
  onClearVscodeExtensions: () => void;
}

type PackagesSubTab = 'winget' | 'portable' | 'vscode';

export function PackagesTab({
  packages,
  portableApps,
  vscodeExtensions,
  disabled,
  onTogglePackage,
  onToggleMany,
  onAddPackage,
  onDeletePackage,
  onTogglePortableApp,
  onTogglePortableAddToPath,
  onAddPortableApp,
  onUpdatePortableApp,
  onDeletePortableApp,
  onAddVscodeExtensions,
  onDeleteVscodeExtension,
  onClearVscodeExtensions,
}: PackagesTabProps) {
  const [subTab, setSubTab] = useState<PackagesSubTab>('winget');

  // WinGet state
  const [showAddWinget, setShowAddWinget] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Utilitários');
  const [newPreCmd, setNewPreCmd] = useState('');
  const [newPostCmd, setNewPostCmd] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Portable ZIP Apps state
  const [showAddPortable, setShowAddPortable] = useState(false);
  const [portableName, setPortableName] = useState('');
  const [portableUrl, setPortableUrl] = useState('');
  const [portableExtractTo, setPortableExtractTo] = useState('C:\\Tools\\');
  const [portableAddToPath, setPortableAddToPath] = useState(true);
  const [portablePreCmd, setPortablePreCmd] = useState('');
  const [portablePostCmd, setPortablePostCmd] = useState('');
  const [portableError, setPortableError] = useState<string | null>(null);

  const [editingPortableId, setEditingPortableId] = useState<string | null>(null);
  const [editPortableName, setEditPortableName] = useState('');
  const [editPortableUrl, setEditPortableUrl] = useState('');
  const [editPortableExtractTo, setEditPortableExtractTo] = useState('');
  const [editPortablePreCmd, setEditPortablePreCmd] = useState('');
  const [editPortablePostCmd, setEditPortablePostCmd] = useState('');

  // VS Code Extensions state
  const [newExtensionInput, setNewExtensionInput] = useState('');
  const [extensionError, setExtensionError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    packages.forEach((p) => set.add(p.category || 'Geral'));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [packages]);

  const filteredPackages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return packages.filter((pkg) => {
      const matchesCategory =
        selectedCategory === 'ALL' || (pkg.category || 'Geral') === selectedCategory;
      const matchesSearch =
        !q ||
        pkg.name.toLowerCase().includes(q) ||
        pkg.id.toLowerCase().includes(q) ||
        pkg.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [packages, searchQuery, selectedCategory]);

  const groupedPackages = useMemo(() => {
    const groups = new Map<string, WingetPackage[]>();
    filteredPackages.forEach((pkg) => {
      const cat = pkg.category || 'Geral';
      const existing = groups.get(cat) ?? [];
      existing.push(pkg);
      groups.set(cat, existing);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredPackages]);

  const filteredIds = useMemo(() => filteredPackages.map((p) => p.id), [filteredPackages]);
  const allFilteredSelected =
    filteredPackages.length > 0 && filteredPackages.every((p) => p.enabled);

  const enabledWingetCount = packages.filter((p) => p.enabled).length;
  const enabledPortablesCount = portableApps.filter((a) => a.enabled).length;

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = newId.trim();
    if (!cleanId) {
      setAddError('Digite um WinGet Package ID (ex: Mozilla.Firefox).');
      return;
    }
    if (packages.some((p) => p.id.toLowerCase() === cleanId.toLowerCase())) {
      setAddError(`O pacote "${cleanId}" já está listado neste perfil.`);
      return;
    }

    const inferredName =
      newName.trim() ||
      cleanId
        .split('.')
        .slice(-1)[0]
        .replace(/[-_]/g, ' ');

    onAddPackage({
      id: cleanId,
      name: inferredName,
      category: newCategory.trim() || 'Utilitários',
      enabled: true,
      ...(newPreCmd.trim() ? { pre_cmd: newPreCmd.trim() } : {}),
      ...(newPostCmd.trim() ? { post_cmd: newPostCmd.trim() } : {}),
    });

    setNewId('');
    setNewName('');
    setNewPreCmd('');
    setNewPostCmd('');
    setAddError(null);
    setShowAddWinget(false);
  };

  const handleAddPortable = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = portableUrl.trim();
    const cleanDest = portableExtractTo.trim();
    if (!cleanUrl) {
      setPortableError('Informe a URL direta do arquivo .zip.');
      return;
    }
    if (!cleanDest || cleanDest === 'C:\\Tools\\') {
      setPortableError('Informe a pasta destino (ex: C:\\Tools\\ripgrep).');
      return;
    }

    const inferredName =
      portableName.trim() ||
      cleanDest.split(/[\\/]/).filter(Boolean).pop() ||
      'Portable App';
    const baseId =
      inferredName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || 'portable';
    const uniqueId = portableApps.some((a) => a.id === baseId)
      ? `${baseId}_${Date.now().toString(36).slice(-4)}`
      : baseId;

    onAddPortableApp({
      id: uniqueId,
      name: inferredName,
      zip_url: cleanUrl,
      extract_to: cleanDest,
      add_to_path: portableAddToPath,
      enabled: true,
      ...(portablePreCmd.trim() ? { pre_cmd: portablePreCmd.trim() } : {}),
      ...(portablePostCmd.trim() ? { post_cmd: portablePostCmd.trim() } : {}),
    });

    setPortableName('');
    setPortableUrl('');
    setPortableExtractTo('C:\\Tools\\');
    setPortableAddToPath(true);
    setPortablePreCmd('');
    setPortablePostCmd('');
    setPortableError(null);
    setShowAddPortable(false);
  };

  const startEditPortable = (app: PortableApp) => {
    setEditingPortableId(app.id);
    setEditPortableName(app.name);
    setEditPortableUrl(app.zip_url);
    setEditPortableExtractTo(app.extract_to);
    setEditPortablePreCmd(app.pre_cmd ?? '');
    setEditPortablePostCmd(app.post_cmd ?? '');
  };

  const commitEditPortable = (app: PortableApp) => {
    const cleanName = editPortableName.trim() || app.name;
    const cleanUrl = editPortableUrl.trim() || app.zip_url;
    const cleanDest = editPortableExtractTo.trim() || app.extract_to;
    const pre = editPortablePreCmd.trim() || undefined;
    const post = editPortablePostCmd.trim() || undefined;
    onUpdatePortableApp({
      ...app,
      name: cleanName,
      zip_url: cleanUrl,
      extract_to: cleanDest,
      pre_cmd: pre,
      post_cmd: post,
    });
    setEditingPortableId(null);
  };

  const handleAddExtensions = (e: React.FormEvent) => {
    e.preventDefault();
    const tokens = newExtensionInput
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      setExtensionError('Digite pelo menos um ID (ex: ms-python.python).');
      return;
    }

    const existingLower = new Set(vscodeExtensions.map((x) => x.toLowerCase()));
    const fresh = tokens.filter((t) => !existingLower.has(t.toLowerCase()));

    if (fresh.length === 0) {
      setExtensionError('Todas as extensões informadas já estão na lista.');
      return;
    }

    onAddVscodeExtensions(fresh);
    setNewExtensionInput('');
    setExtensionError(null);
  };

  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      {/* Header + Contextual Add Button */}
      <div className="flex items-center justify-between border-b border-[#313244] pb-2">
        <h2 className="font-mono text-xs font-bold text-[#cba6f7]">
          [02] PACKAGES &amp; APPS
        </h2>

        {subTab === 'winget' && (
          <button
            type="button"
            onClick={() => setShowAddWinget((v) => !v)}
            disabled={disabled}
            className="flex items-center gap-1 border border-[#cba6f7] bg-[#cba6f7]/10 px-2.5 py-1 font-mono text-[11px] font-medium text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
          >
            {showAddWinget ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            <span>{showAddWinget ? 'Fechar' : 'Add ID'}</span>
          </button>
        )}

        {subTab === 'portable' && (
          <button
            type="button"
            onClick={() => setShowAddPortable((v) => !v)}
            disabled={disabled}
            className="flex items-center gap-1 border border-[#cba6f7] bg-[#cba6f7]/10 px-2.5 py-1 font-mono text-[11px] font-medium text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
          >
            {showAddPortable ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            <span>{showAddPortable ? 'Fechar' : 'Add ZIP'}</span>
          </button>
        )}

        {subTab === 'vscode' && vscodeExtensions.length > 0 && (
          <button
            type="button"
            onClick={onClearVscodeExtensions}
            disabled={disabled}
            className="font-mono text-[11px] text-[#7f849c] hover:text-[#f38ba8] transition-colors disabled:opacity-40 cursor-pointer"
          >
            Limpar ({vscodeExtensions.length})
          </button>
        )}
      </div>

      {/* Segmented Sub-Tab Switcher for Compact Portrait Navigation */}
      <div className="grid grid-cols-3 border border-[#313244] bg-[#181825] font-mono text-[11px]">
        <button
          type="button"
          onClick={() => setSubTab('winget')}
          className={`flex items-center justify-center gap-1.5 border-r border-[#313244] py-2 transition-colors cursor-pointer ${
            subTab === 'winget'
              ? 'bg-[#cba6f7]/15 text-[#cba6f7] font-semibold'
              : 'text-[#a6adc8] hover:text-[#cdd6f4]'
          }`}
        >
          <Package className="h-3 w-3 shrink-0" />
          <span className="truncate">WinGet</span>
          <span className="text-[10px] opacity-80 tabular-nums">
            {enabledWingetCount}/{packages.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('portable')}
          className={`flex items-center justify-center gap-1.5 border-r border-[#313244] py-2 transition-colors cursor-pointer ${
            subTab === 'portable'
              ? 'bg-[#cba6f7]/15 text-[#cba6f7] font-semibold'
              : 'text-[#a6adc8] hover:text-[#cdd6f4]'
          }`}
        >
          <FileArchive className="h-3 w-3 shrink-0" />
          <span className="truncate">ZIP</span>
          <span className="text-[10px] opacity-80 tabular-nums">
            {enabledPortablesCount}/{portableApps.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('vscode')}
          className={`flex items-center justify-center gap-1.5 py-2 transition-colors cursor-pointer ${
            subTab === 'vscode'
              ? 'bg-[#cba6f7]/15 text-[#cba6f7] font-semibold'
              : 'text-[#a6adc8] hover:text-[#cdd6f4]'
          }`}
        >
          <Puzzle className="h-3 w-3 shrink-0" />
          <span className="truncate">VS Code</span>
          <span className="text-[10px] opacity-80 tabular-nums">
            {vscodeExtensions.length}
          </span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* SUB-TAB 1: WINGET PACKAGES                                           */}
      {/* ==================================================================== */}
      {subTab === 'winget' && (
        <div className="flex flex-col gap-3">
          {showAddWinget && (
            <form
              onSubmit={handleQuickAdd}
              className="flex flex-col gap-2 border border-[#cba6f7]/60 bg-[#181825] p-3"
            >
              <span className="font-mono text-[10px] font-semibold text-[#cba6f7]">
                ADICIONAR PACOTE WINGET
              </span>

              <input
                type="text"
                value={newId}
                onChange={(e) => {
                  setNewId(e.target.value);
                  if (addError) setAddError(null);
                }}
                disabled={disabled}
                placeholder="WinGet ID (ex: Mozilla.Firefox)"
                aria-label="ID do pacote WinGet"
                className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={disabled}
                  placeholder="Nome (opcional)"
                  aria-label="Nome de exibição do pacote"
                  className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
                />
                <input
                  type="text"
                  list="winget-categories"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  disabled={disabled}
                  placeholder="Categoria"
                  aria-label="Categoria do pacote"
                  className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
                />
                <datalist id="winget-categories">
                  {categories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newPreCmd}
                  onChange={(e) => setNewPreCmd(e.target.value)}
                  disabled={disabled}
                  placeholder="pre_cmd (opcional)"
                  aria-label="Comando PowerShell pré-instalação"
                  className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[10px] text-[#fab387] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
                />
                <input
                  type="text"
                  value={newPostCmd}
                  onChange={(e) => setNewPostCmd(e.target.value)}
                  disabled={disabled}
                  placeholder="post_cmd (opcional)"
                  aria-label="Comando PowerShell pós-instalação"
                  className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[10px] text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
                />
              </div>

              {addError && <p className="font-mono text-[11px] text-[#f38ba8]">{addError}</p>}

              <button
                type="submit"
                disabled={disabled}
                className="flex items-center justify-center gap-1.5 border border-[#cba6f7] bg-[#cba6f7] py-1.5 font-mono text-xs font-semibold text-[#11111b] hover:bg-[#cba6f7]/90 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Adicionar Pacote</span>
              </button>
            </form>
          )}

          {/* Search + Bulk Actions */}
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#6c7086]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar nome, ID ou categoria..."
                aria-label="Buscar pacotes WinGet"
                className="w-full border border-[#313244] bg-[#181825] py-1.5 pr-8 pl-8 font-mono text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpar busca"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-[#7f849c] hover:text-[#cdd6f4] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onToggleMany(filteredIds, true)}
                  disabled={disabled || filteredIds.length === 0 || allFilteredSelected}
                  className="flex items-center gap-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#cdd6f4] hover:border-[#a6e3a1] hover:text-[#a6e3a1] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
                >
                  <CheckSquare className="h-3 w-3" />
                  <span>Marcar</span>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleMany(filteredIds, false)}
                  disabled={
                    disabled ||
                    filteredIds.length === 0 ||
                    filteredPackages.every((p) => !p.enabled)
                  }
                  className="flex items-center gap-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#a6adc8] hover:border-[#fab387] hover:text-[#fab387] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
                >
                  <Square className="h-3 w-3" />
                  <span>Desmarcar</span>
                </button>
              </div>
              <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
                {filteredPackages.length} exibidos
              </span>
            </div>
          </div>

          {/* Horizontal Scroll Category Filter Strip */}
          {categories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedCategory('ALL')}
                className={`shrink-0 border px-2 py-1 font-mono text-[10px] transition-colors whitespace-nowrap cursor-pointer ${
                  selectedCategory === 'ALL'
                    ? 'border-[#cba6f7] bg-[#cba6f7]/15 text-[#cba6f7]'
                    : 'border-[#313244] bg-[#181825] text-[#a6adc8] hover:text-[#cdd6f4]'
                }`}
              >
                Todas ({packages.length})
              </button>
              {categories.map((cat) => {
                const catItems = packages.filter((p) => (p.category || 'Geral') === cat);
                const enabledInCat = catItems.filter((p) => p.enabled).length;
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`shrink-0 border px-2 py-1 font-mono text-[10px] transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                      active
                        ? 'border-[#cba6f7] bg-[#cba6f7]/15 text-[#cba6f7]'
                        : 'border-[#313244] bg-[#181825] text-[#a6adc8] hover:text-[#cdd6f4]'
                    }`}
                  >
                    {cat} ({enabledInCat}/{catItems.length})
                  </button>
                );
              })}
            </div>
          )}

          {/* Compact Single-Column Grouped Package List */}
          {groupedPackages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 border border-[#313244] bg-[#181825] py-8 px-4 text-center">
              <Package className="h-5 w-5 text-[#585b70]" />
              <p className="font-mono text-[11px] text-[#a6adc8]">
                {packages.length === 0
                  ? 'Nenhum pacote WinGet no manifesto. Use "Add ID" ou "Capturar Setup".'
                  : 'Nenhum pacote corresponde ao filtro atual.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {groupedPackages.map(([category, items]) => {
                const enabledCount = items.filter((i) => i.enabled).length;
                const catIds = items.map((i) => i.id);
                const allCatEnabled = enabledCount === items.length;

                return (
                  <section key={category} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between px-0.5">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-xs font-semibold text-[#cdd6f4]">{category}</h3>
                        <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
                          {enabledCount}/{items.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onToggleMany(catIds, !allCatEnabled)}
                        className="font-mono text-[10px] text-[#a6adc8] hover:text-[#cba6f7] transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        {allCatEnabled ? 'Desmarcar grupo' : 'Marcar grupo'}
                      </button>
                    </div>

                    <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
                      {items.map((pkg) => (
                        <div
                          key={pkg.id}
                          onClick={() => !disabled && onTogglePackage(pkg.id)}
                          className={`flex items-center justify-between gap-2.5 px-3 py-2 transition-colors ${
                            pkg.enabled ? '' : 'opacity-55'
                          } ${!disabled ? 'cursor-pointer hover:bg-[#313244]/35' : ''}`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <TuiCheckbox
                              checked={pkg.enabled}
                              onChange={() => onTogglePackage(pkg.id)}
                              ariaLabel={`Selecionar pacote ${pkg.name}`}
                              disabled={disabled}
                            />
                            <div className="flex min-w-0 flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-medium text-[#cdd6f4]">
                                  {pkg.name}
                                </span>
                                {pkg.pre_cmd && (
                                  <span
                                    title={`pre_cmd: ${pkg.pre_cmd}`}
                                    className="shrink-0 font-mono text-[9px] text-[#fab387]"
                                  >
                                    [pre]
                                  </span>
                                )}
                                {pkg.post_cmd && (
                                  <span
                                    title={`post_cmd: ${pkg.post_cmd}`}
                                    className="shrink-0 font-mono text-[9px] text-[#a6e3a1]"
                                  >
                                    [post]
                                  </span>
                                )}
                              </div>
                              <span className="truncate font-mono text-[10px] text-[#7f849c]">
                                {pkg.id}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeletePackage(pkg.id);
                            }}
                            disabled={disabled}
                            title={`Remover ${pkg.name}`}
                            className="shrink-0 p-1 text-[#6c7086] hover:text-[#f38ba8] transition-colors disabled:opacity-20 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* SUB-TAB 2: PORTABLE ZIP APPS (portable_apps)                         */}
      {/* ==================================================================== */}
      {subTab === 'portable' && (
        <div className="flex flex-col gap-3">
          {showAddPortable && (
            <form
              onSubmit={handleAddPortable}
              className="flex flex-col gap-2 border border-[#cba6f7]/60 bg-[#181825] p-3"
            >
              <span className="font-mono text-[10px] font-semibold text-[#cba6f7]">
                NOVO PORTABLE ZIP APP
              </span>

              <input
                type="text"
                value={portableName}
                onChange={(e) => setPortableName(e.target.value)}
                disabled={disabled}
                placeholder="Nome (ex: Ripgrep)"
                aria-label="Nome do app portátil"
                className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
              />

              <input
                type="url"
                value={portableUrl}
                onChange={(e) => {
                  setPortableUrl(e.target.value);
                  if (portableError) setPortableError(null);
                }}
                disabled={disabled}
                placeholder="URL do .zip (https://.../tool.zip)"
                aria-label="URL do arquivo ZIP portátil"
                className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
              />

              <input
                type="text"
                value={portableExtractTo}
                onChange={(e) => {
                  setPortableExtractTo(e.target.value);
                  if (portableError) setPortableError(null);
                }}
                disabled={disabled}
                placeholder="Pasta destino (ex: C:\Tools\ripgrep)"
                aria-label="Pasta de destino para extração"
                className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={portablePreCmd}
                  onChange={(e) => setPortablePreCmd(e.target.value)}
                  disabled={disabled}
                  placeholder="pre_cmd (opcional)"
                  aria-label="Hook pré-instalação"
                  className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[10px] text-[#fab387] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
                />
                <input
                  type="text"
                  value={portablePostCmd}
                  onChange={(e) => setPortablePostCmd(e.target.value)}
                  disabled={disabled}
                  placeholder="post_cmd (opcional)"
                  aria-label="Hook pós-instalação"
                  className="w-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[10px] text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
                />
              </div>

              <label
                onClick={() => !disabled && setPortableAddToPath((v) => !v)}
                className={`flex items-center gap-2 py-0.5 text-xs text-[#cdd6f4] select-none ${
                  disabled ? 'opacity-50' : 'cursor-pointer'
                }`}
              >
                <TuiCheckbox
                  checked={portableAddToPath}
                  onChange={setPortableAddToPath}
                  ariaLabel="Adicionar pasta extraída ao PATH do usuário"
                  disabled={disabled}
                />
                <span className="font-mono text-[11px]">Add to PATH (User)</span>
              </label>

              {portableError && (
                <p className="font-mono text-[11px] text-[#f38ba8]">{portableError}</p>
              )}

              <button
                type="submit"
                disabled={disabled}
                className="flex items-center justify-center gap-1.5 border border-[#cba6f7] bg-[#cba6f7] py-1.5 font-mono text-xs font-semibold text-[#11111b] hover:bg-[#cba6f7]/90 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Adicionar Portable ZIP</span>
              </button>
            </form>
          )}

          {portableApps.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border border-[#313244] bg-[#181825] px-4 py-8 text-center">
              <FileArchive className="h-5 w-5 text-[#585b70]" />
              <p className="font-mono text-[11px] text-[#7f849c]">
                Nenhum app portátil (.zip) configurado. Clique em &quot;Add ZIP&quot; para baixar, extrair e opcionalmente adicionar ao PATH.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
              {portableApps.map((app) => {
                const isEditing = editingPortableId === app.id;
                return (
                  <div
                    key={app.id}
                    className={`flex flex-col gap-2 px-3 py-2.5 transition-colors ${
                      app.enabled ? '' : 'opacity-55'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={editPortableName}
                          onChange={(e) => setEditPortableName(e.target.value)}
                          placeholder="Nome"
                          className="border border-[#cba6f7] bg-[#1e1e2e] px-2.5 py-1.5 text-xs text-[#cdd6f4] focus:outline-none"
                        />
                        <input
                          type="url"
                          value={editPortableUrl}
                          onChange={(e) => setEditPortableUrl(e.target.value)}
                          placeholder="URL .zip"
                          className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
                        />
                        <input
                          type="text"
                          value={editPortableExtractTo}
                          onChange={(e) => setEditPortableExtractTo(e.target.value)}
                          placeholder="Pasta destino"
                          className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-xs text-[#a6e3a1] focus:border-[#cba6f7] focus:outline-none"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={editPortablePreCmd}
                            onChange={(e) => setEditPortablePreCmd(e.target.value)}
                            placeholder="pre_cmd (opcional)"
                            className="border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-[10px] text-[#fab387] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
                          />
                          <input
                            type="text"
                            value={editPortablePostCmd}
                            onChange={(e) => setEditPortablePostCmd(e.target.value)}
                            placeholder="post_cmd (opcional)"
                            className="border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-[10px] text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingPortableId(null)}
                            className="flex items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2.5 py-1 font-mono text-[11px] text-[#a6adc8] hover:text-[#cdd6f4] cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                            <span>Cancelar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => commitEditPortable(app)}
                            className="flex items-center gap-1 border border-[#a6e3a1]/60 bg-[#a6e3a1]/15 px-2.5 py-1 font-mono text-[11px] text-[#a6e3a1] hover:bg-[#a6e3a1] hover:text-[#11111b] cursor-pointer"
                          >
                            <Check className="h-3 w-3" />
                            <span>Salvar</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-start gap-2.5">
                            <div className="mt-0.5">
                              <TuiCheckbox
                                checked={app.enabled}
                                onChange={() => onTogglePortableApp(app.id)}
                                ariaLabel={`Ativar app portátil ${app.name}`}
                                disabled={disabled}
                              />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-medium text-[#cdd6f4]">
                                  {app.name}
                                </span>
                                {app.pre_cmd && (
                                  <span
                                    title={`pre_cmd: ${app.pre_cmd}`}
                                    className="shrink-0 font-mono text-[9px] text-[#fab387]"
                                  >
                                    [pre]
                                  </span>
                                )}
                                {app.post_cmd && (
                                  <span
                                    title={`post_cmd: ${app.post_cmd}`}
                                    className="shrink-0 font-mono text-[9px] text-[#a6e3a1]"
                                  >
                                    [post]
                                  </span>
                                )}
                              </div>
                              <span className="truncate font-mono text-[10px] text-[#89b4fa]">
                                {app.zip_url}
                              </span>
                              <span className="truncate font-mono text-[10px] text-[#a6e3a1]">
                                → {app.extract_to}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditPortable(app)}
                              disabled={disabled}
                              title={`Editar ${app.name}`}
                              className="p-1 text-[#7f849c] hover:text-[#cba6f7] transition-colors disabled:opacity-30 cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeletePortableApp(app.id)}
                              disabled={disabled}
                              title={`Remover ${app.name}`}
                              className="p-1 text-[#6c7086] hover:text-[#f38ba8] transition-colors disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-[#313244]/50 pt-1.5 pl-6">
                          <label
                            onClick={() => !disabled && onTogglePortableAddToPath(app.id)}
                            className={`flex items-center gap-1.5 font-mono text-[10px] select-none ${
                              app.add_to_path ? 'text-[#a6e3a1]' : 'text-[#7f849c]'
                            } ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
                          >
                            <TuiCheckbox
                              checked={app.add_to_path}
                              onChange={() => onTogglePortableAddToPath(app.id)}
                              ariaLabel={`Adicionar ${app.name} ao PATH`}
                              disabled={disabled}
                            />
                            <span>Add to PATH</span>
                          </label>
                          <span className="font-mono text-[9px] text-[#585b70]">
                            Expand-Archive
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* SUB-TAB 3: VS CODE EXTENSIONS (vscode_extensions)                    */}
      {/* ==================================================================== */}
      {subTab === 'vscode' && (
        <div className="flex flex-col gap-3">
          <form onSubmit={handleAddExtensions} className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newExtensionInput}
                onChange={(e) => {
                  setNewExtensionInput(e.target.value);
                  if (extensionError) setExtensionError(null);
                }}
                disabled={disabled}
                placeholder="ex: ms-python.python, esbenp.prettier-vscode"
                aria-label="Adicionar extensão do VS Code"
                className="min-w-0 flex-1 border border-[#313244] bg-[#181825] px-2.5 py-1.5 font-mono text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={disabled}
                className="flex items-center gap-1 border border-[#cba6f7] bg-[#cba6f7]/15 px-3 py-1.5 font-mono text-xs font-medium text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>
            {extensionError && (
              <p className="font-mono text-[11px] text-[#f38ba8]">{extensionError}</p>
            )}
          </form>

          {vscodeExtensions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border border-[#313244] bg-[#181825] px-4 py-8 text-center">
              <Puzzle className="h-5 w-5 text-[#585b70]" />
              <p className="font-mono text-[11px] text-[#7f849c]">
                Nenhuma extensão VS Code configurada. Adicione IDs acima ou colete automaticamente em [00] Harvest.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
              {vscodeExtensions.map((ext) => (
                <div
                  key={ext}
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-[#313244]/30 transition-colors"
                >
                  <span className="truncate font-mono text-xs text-[#cdd6f4]">{ext}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteVscodeExtension(ext)}
                    disabled={disabled}
                    title={`Remover extensão ${ext}`}
                    className="shrink-0 p-1 text-[#6c7086] hover:text-[#f38ba8] transition-colors disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
