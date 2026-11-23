import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Loader2,
  Minus,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { RuntimeStatus } from '../types/profile';

interface WindowTitleBarProps {
  profileName: string;
  author: string;
  runtime: RuntimeStatus;
  alwaysOnTop: boolean;
  isMinimizedPreview: boolean;
  isRunning: boolean;
  isScanning: boolean;
  isHarvesting: boolean;
  onStartDragging: () => void;
  onToggleAlwaysOnTop: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onUpdateProfileMeta: (name: string, author: string) => void;
  onImportFile: (file: File) => void;
  onImportNative: () => void;
  onExportProfile: () => void;
  onScanSystem: () => void;
  onReplaySplash: () => void;
}

export function WindowTitleBar({
  profileName,
  author,
  runtime,
  alwaysOnTop,
  isMinimizedPreview,
  isRunning,
  isScanning,
  isHarvesting,
  onStartDragging,
  onToggleAlwaysOnTop,
  onMinimize,
  onClose,
  onUpdateProfileMeta,
  onImportFile,
  onImportNative,
  onExportProfile,
  onScanSystem,
  onReplaySplash,
}: WindowTitleBarProps) {
  const busy = isRunning || isScanning || isHarvesting;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [draftName, setDraftName] = useState(profileName);
  const [draftAuthor, setDraftAuthor] = useState(author);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const startEditing = () => {
    setDraftName(profileName);
    setDraftAuthor(author);
    setEditingMeta(true);
    setMenuOpen(false);
  };

  const commitMeta = () => {
    const cleanName = draftName.trim() || 'Novo Perfil';
    const cleanAuthor = draftAuthor.trim();
    onUpdateProfileMeta(cleanName, cleanAuthor);
    setEditingMeta(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportFile(file);
      e.target.value = '';
    }
  };

  const handleImportClick = () => {
    setMenuOpen(false);
    if (runtime.isTauri) {
      onImportNative();
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <header className="shrink-0 border-b border-[#313244] bg-[#181825] select-none">
      {/* Row 1: Frameless Window Titlebar (Drag region + Pin + Options + Minimize + Close) */}
      <div className="flex h-10 items-center justify-between px-3">
        <div
          data-tauri-drag-region
          onMouseDown={(e) => {
            if (e.button === 0) onStartDragging();
          }}
          className="flex min-w-0 flex-1 items-center gap-2 pr-2 cursor-move"
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#cba6f7]/60 bg-[#1e1e2e] text-[#cba6f7]">
            <Terminal className="h-3.5 w-3.5" />
          </div>
          <span className="font-mono text-xs font-bold tracking-tight text-[#cdd6f4] whitespace-nowrap">
            WinForge
          </span>
          <span className="text-[#45475a]" aria-hidden="true">·</span>
          <span
            title={
              runtime.isTauri
                ? runtime.isAdmin
                  ? 'Privilégios elevados (IsUserAnAdmin = true)'
                  : 'Requer execução como Administrador'
                : 'Runtime desktop Tauri v2 offline'
            }
            className={`inline-flex items-center gap-1 font-mono text-[10px] whitespace-nowrap ${
              runtime.isAdmin
                ? 'text-[#a6e3a1]'
                : runtime.isTauri
                ? 'text-[#fab387]'
                : 'text-[#7f849c]'
            }`}
          >
            {runtime.isAdmin ? (
              <ShieldCheck className="h-3 w-3 shrink-0" />
            ) : (
              <ShieldAlert className="h-3 w-3 shrink-0" />
            )}
            <span>
              {!runtime.isTauri ? 'OFFLINE' : runtime.isAdmin ? 'ADMIN' : 'USER'}
            </span>
          </span>
        </div>

        {/* Window Controls & Options */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleAlwaysOnTop}
            title={alwaysOnTop ? 'Desafixar do topo' : 'Fixar janela no topo (Always on Top)'}
            className={`flex h-7 w-7 items-center justify-center border transition-colors cursor-pointer ${
              alwaysOnTop
                ? 'border-[#cba6f7]/60 bg-[#cba6f7]/15 text-[#cba6f7]'
                : 'border-transparent text-[#7f849c] hover:border-[#313244] hover:bg-[#1e1e2e] hover:text-[#cdd6f4]'
            }`}
          >
            {alwaysOnTop ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>

          {/* Options Dropdown */}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title="Opções do manifesto e utilitários"
              className={`flex h-7 w-7 items-center justify-center border transition-colors cursor-pointer ${
                menuOpen
                  ? 'border-[#cba6f7]/60 bg-[#1e1e2e] text-[#cba6f7]'
                  : 'border-transparent text-[#a6adc8] hover:border-[#313244] hover:bg-[#1e1e2e] hover:text-[#cdd6f4]'
              }`}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 w-56 border border-[#313244] bg-[#181825] py-1 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onScanSystem();
                  }}
                  disabled={busy || !runtime.isTauri}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-xs text-[#fab387] hover:bg-[#313244]/60 disabled:opacity-40 cursor-pointer"
                >
                  {isScanning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ScanSearch className="h-3.5 w-3.5" />
                  )}
                  <span>Capturar Setup Atual</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={handleImportClick}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-xs text-[#cdd6f4] hover:bg-[#313244]/60 disabled:opacity-40 cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5 text-[#a6adc8]" />
                  <span>Importar profile.json</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportProfile();
                  }}
                  disabled={isScanning}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-xs text-[#cba6f7] hover:bg-[#313244]/60 disabled:opacity-40 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Exportar profile.json</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={startEditing}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-xs text-[#cdd6f4] hover:bg-[#313244]/60 disabled:opacity-40 cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5 text-[#a6adc8]" />
                  <span>Renomear Perfil</span>
                </button>

                <div className="my-1 border-t border-[#313244]" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onReplaySplash();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-xs text-[#a6adc8] hover:bg-[#313244]/60 hover:text-[#cdd6f4] cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#cba6f7]" />
                  <span>Exibir Tela Inicial</span>
                </button>
              </div>
            )}
          </div>

          <span className="mx-0.5 h-4 w-px bg-[#313244]" aria-hidden="true" />

          <button
            type="button"
            onClick={onMinimize}
            title={isMinimizedPreview ? 'Restaurar card' : 'Minimizar'}
            aria-label="Minimizar janela"
            className="flex h-7 w-7 items-center justify-center border border-transparent text-[#a6adc8] hover:border-[#313244] hover:bg-[#1e1e2e] hover:text-[#cdd6f4] transition-colors cursor-pointer"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Fechar WinForge"
            aria-label="Fechar janela"
            className="flex h-7 w-7 items-center justify-center border border-transparent text-[#a6adc8] hover:border-[#f38ba8]/50 hover:bg-[#f38ba8]/15 hover:text-[#f38ba8] transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Row 2: Compact Active Profile Strip */}
      {!isMinimizedPreview && (
        <div className="flex items-center justify-between gap-2 border-t border-[#313244]/70 bg-[#1e1e2e]/60 px-3 py-1.5">
          {editingMeta ? (
            <div className="flex flex-1 items-center gap-1.5">
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitMeta();
                  if (e.key === 'Escape') setEditingMeta(false);
                }}
                aria-label="Nome do perfil"
                className="h-6 min-w-0 flex-1 border border-[#cba6f7] bg-[#181825] px-2 font-mono text-[11px] text-[#cdd6f4] focus:outline-none"
                autoFocus
              />
              <input
                type="text"
                value={draftAuthor}
                onChange={(e) => setDraftAuthor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitMeta();
                  if (e.key === 'Escape') setEditingMeta(false);
                }}
                aria-label="Autor do perfil"
                placeholder="Autor"
                className="h-6 w-20 border border-[#313244] bg-[#181825] px-2 font-mono text-[11px] text-[#a6adc8] focus:border-[#cba6f7] focus:outline-none"
              />
              <button
                type="button"
                onClick={commitMeta}
                title="Salvar"
                className="flex h-6 w-6 items-center justify-center border border-[#a6e3a1]/50 bg-[#181825] text-[#a6e3a1] hover:bg-[#a6e3a1]/15 cursor-pointer"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setEditingMeta(false)}
                title="Cancelar"
                className="flex h-6 w-6 items-center justify-center border border-[#313244] bg-[#181825] text-[#a6adc8] cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-mono">
                <span className="truncate font-semibold text-[#cdd6f4]">{profileName}</span>
                {author && (
                  <>
                    <span className="text-[#585b70]" aria-hidden="true">·</span>
                    <span className="truncate text-[#7f849c]">{author}</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={startEditing}
                  disabled={busy}
                  title="Renomear perfil"
                  className="p-0.5 text-[#6c7086] hover:text-[#cba6f7] transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleImportClick}
                  disabled={busy}
                  title="Importar JSON"
                  className="flex items-center gap-1 border border-[#313244] bg-[#181825] px-2 py-0.5 font-mono text-[10px] text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
                >
                  <Upload className="h-2.5 w-2.5" />
                  <span>Import</span>
                </button>
                <button
                  type="button"
                  onClick={onExportProfile}
                  disabled={isScanning}
                  title="Exportar JSON"
                  className="flex items-center gap-1 border border-[#cba6f7]/50 bg-[#cba6f7]/10 px-2 py-0.5 font-mono text-[10px] text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
                >
                  <Download className="h-2.5 w-2.5" />
                  <span>Export</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />
    </header>
  );
}
