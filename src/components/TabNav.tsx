import {
  Activity,
  Archive,
  Braces,
  FolderGit2,
  Layers,
  Package,
  Sliders,
  Zap,
} from 'lucide-react';
import { ModuleTab } from '../types/profile';

interface TabNavProps {
  activeTab: ModuleTab;
  onSelectTab: (tab: ModuleTab) => void;
  counts: {
    harvestActive: number;
    systemEnabled: number;
    systemTotal: number;
    packagesEnabled: number;
    packagesTotal: number;
    dotfilesEnabled: number;
    dotfilesTotal: number;
    jsonValid: boolean;
    updatesAvailable: number | null;
    cpuPct: number | null;
    awakeActive: boolean;
  };
}

/**
 * Compact 2x4 portrait TUI navigation bar in Catppuccin Macchiato style.
 */
export function TabNav({ activeTab, onSelectTab, counts }: TabNavProps) {
  const tabs: Array<{
    id: ModuleTab;
    code: string;
    label: string;
    title: string;
    meta: string;
    metaTone?: 'default' | 'ok' | 'err' | 'warn';
    Icon: typeof Archive;
  }> = [
    {
      id: 'harvest',
      code: '00',
      label: 'Harvest',
      title: '[00] HARVEST (PRE-FORMAT)',
      meta: `${counts.harvestActive}/6`,
      Icon: Archive,
    },
    {
      id: 'system',
      code: '01',
      label: 'System',
      title: '[01] SYSTEM & DEBLOAT',
      meta: `${counts.systemEnabled}/${counts.systemTotal}`,
      Icon: Sliders,
    },
    {
      id: 'packages',
      code: '02',
      label: 'Apps',
      title: '[02] PACKAGES (WINGET + PORTABLE + VSCODE)',
      meta: `${counts.packagesEnabled}/${counts.packagesTotal}`,
      Icon: Package,
    },
    {
      id: 'dotfiles',
      code: '03',
      label: 'Dots',
      title: '[03] DOTFILES & THEMES',
      meta: `${counts.dotfilesEnabled}/${counts.dotfilesTotal}`,
      Icon: FolderGit2,
    },
    {
      id: 'json',
      code: '04',
      label: 'JSON',
      title: '[04] JSON EDITOR',
      meta: counts.jsonValid ? 'OK' : 'ERR',
      metaTone: counts.jsonValid ? 'ok' : 'err',
      Icon: Braces,
    },
    {
      id: 'pkgmgr',
      code: '05',
      label: 'PkgMgr',
      title: '[05] PKG MANAGER (UNIGET MODE)',
      meta:
        counts.updatesAvailable === null
          ? 'Live'
          : counts.updatesAvailable > 0
          ? `${counts.updatesAvailable} upd`
          : 'OK',
      metaTone:
        counts.updatesAvailable === null
          ? 'default'
          : counts.updatesAvailable > 0
          ? 'warn'
          : 'ok',
      Icon: Layers,
    },
    {
      id: 'wintoys',
      code: '06',
      label: 'Wintoys',
      title: '[06] WINTOYS (TWEAKS & HEALTH)',
      meta: counts.cpuPct !== null ? `${counts.cpuPct}%` : 'Health',
      metaTone: counts.cpuPct !== null && counts.cpuPct > 85 ? 'warn' : 'default',
      Icon: Activity,
    },
    {
      id: 'powertools',
      code: '07',
      label: 'Tools',
      title: '[07] POWERTOOLS (AWAKE / PICKER / ENV)',
      meta: counts.awakeActive ? 'Awake' : 'Keys',
      metaTone: counts.awakeActive ? 'ok' : 'default',
      Icon: Zap,
    },
  ];

  return (
    <nav
      aria-label="Módulos do WinForge"
      className="grid shrink-0 grid-cols-4 border-t border-[#313244] bg-[#181825]"
    >
      {tabs.map((tab, idx) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.Icon;
        const isSecondRow = idx >= 4;
        return (
          <button
            key={tab.id}
            type="button"
            title={tab.title}
            onClick={() => onSelectTab(tab.id)}
            className={`group relative flex items-center justify-between gap-1 border-r border-[#313244]/70 px-2 py-1.5 font-mono transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-[#313244]/50 ${
              isSecondRow ? 'border-t border-t-[#313244]' : ''
            } ${
              isActive
                ? 'bg-[#1e1e2e] text-[#cba6f7] shadow-[inset_0_2px_0_0_#cba6f7]'
                : 'text-[#a6adc8] hover:bg-[#1e1e2e]/50 hover:text-[#cdd6f4]'
            }`}
          >
            <div className="flex min-w-0 items-center gap-1">
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate text-[10px] font-semibold leading-none">
                {tab.label}
              </span>
            </div>
            <span
              className={`shrink-0 tabular-nums text-[8px] leading-none ${
                tab.metaTone === 'err'
                  ? 'text-[#f38ba8]'
                  : tab.metaTone === 'warn'
                  ? 'text-[#fab387]'
                  : tab.metaTone === 'ok'
                  ? 'text-[#a6e3a1]'
                  : isActive
                  ? 'text-[#cdd6f4]'
                  : 'text-[#6c7086]'
              }`}
            >
              {tab.meta}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
