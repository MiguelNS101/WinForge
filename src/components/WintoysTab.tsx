import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Clock,
  Cpu,
  HardDrive,
  ImageOff,
  Loader2,
  MemoryStick,
  Network,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Wifi,
} from 'lucide-react';
import { tauriBridge } from '../services/tauriBridge';
import {
  SystemHealthReport,
  WintoysRepairId,
  WintoysTweakState,
} from '../types/profile';

interface WintoysTabProps {
  isTauri: boolean;
  disabled: boolean;
  onLog: (level: 'INFO' | 'OK' | 'WARN' | 'ERR', message: string) => void;
  onCpuUpdate?: (cpuPct: number | null) => void;
}

const DEFAULT_TWEAKS_CATALOG: WintoysTweakState[] = [
  {
    id: 'classic_context_menu',
    category: 'Explorer',
    label: 'Menu de Contexto Clássico Win11',
    description: 'Restaura o menu completo ao clicar com o botão direito',
    enabled: false,
  },
  {
    id: 'show_file_extensions',
    category: 'Explorer',
    label: 'Mostrar Extensões de Arquivo',
    description: 'Exibe .exe, .json, .reg no Explorador (HideFileExt=0)',
    enabled: false,
  },
  {
    id: 'show_hidden_files',
    category: 'Explorer',
    label: 'Mostrar Arquivos Ocultos',
    description: 'Exibe pastas e arquivos ocultos do sistema (Hidden=1)',
    enabled: false,
  },
  {
    id: 'disable_bing_start',
    category: 'Privacy',
    label: 'Desativar Bing & Sugestões no Iniciar',
    description: 'Remove busca web/Bing e sugestões na barra Iniciar',
    enabled: false,
  },
  {
    id: 'disable_telemetry_ads',
    category: 'Privacy',
    label: 'Desativar ID de Anúncios',
    description: 'Desativa AdvertisingInfo (HKCU AdvertisingInfo=0)',
    enabled: false,
  },
  {
    id: 'disable_mouse_accel',
    category: 'Performance',
    label: 'Desativar Aceleração do Mouse',
    description: 'Desativa aprimorar precisão do ponteiro (MouseSpeed=0)',
    enabled: false,
  },
  {
    id: 'ultimate_performance_plan',
    category: 'Performance',
    label: 'Plano Desempenho Máximo',
    description: 'Ativa Ultimate Performance via powercfg (reversível)',
    enabled: false,
  },
  {
    id: 'service_diagtrack',
    category: 'Services',
    label: 'Desativar Telemetria (DiagTrack)',
    description: 'Para e desativa o serviço Connected User Experiences',
    enabled: false,
  },
  {
    id: 'service_sysmain',
    category: 'Services',
    label: 'Desativar SysMain (Superfetch)',
    description: 'Para e desativa pré-carregamento em disco/RAM',
    enabled: false,
  },
  {
    id: 'service_wuauserv',
    category: 'Services',
    label: 'Pausar Windows Update (wuauserv)',
    description: 'Desativa temporariamente o serviço wuauserv',
    enabled: false,
  },
];

function formatBytesGb(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m`;
}

export function WintoysTab({ isTauri, disabled, onLog, onCpuUpdate }: WintoysTabProps) {
  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [tweaks, setTweaks] = useState<WintoysTweakState[]>(DEFAULT_TWEAKS_CATALOG);
  const [categoryFilter, setCategoryFilter] = useState<string>('Todos');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningRepair, setRunningRepair] = useState<WintoysRepairId | null>(null);

  const fetchLiveTelemetry = async () => {
    if (!isTauri) return;
    setLoadingHealth(true);
    try {
      const report = await tauriBridge.getSystemHealth();
      setHealth(report);
      onCpuUpdate?.(Math.round(report.cpuUsagePct));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('WARN', `Telemetria Wintoys indisponível: ${msg}`);
    } finally {
      setLoadingHealth(false);
    }
  };

  const fetchLiveTweaks = async () => {
    if (!isTauri) return;
    try {
      const live = await tauriBridge.getWintoysTweaksStatus();
      setTweaks(live);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('WARN', `Erro ao ler registro Wintoys: ${msg}`);
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    void fetchLiveTelemetry();
    void fetchLiveTweaks();

    const timer = window.setInterval(() => {
      void tauriBridge
        .getSystemHealth()
        .then((report) => {
          setHealth(report);
          onCpuUpdate?.(Math.round(report.cpuUsagePct));
        })
        .catch(() => undefined);
    }, 3000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri]);

  const handleToggleTweak = async (tweak: WintoysTweakState) => {
    if (!isTauri || disabled || togglingId) return;
    setTogglingId(tweak.id);
    try {
      const updated = await tauriBridge.applyWintoysTweak(tweak.id, !tweak.enabled);
      setTweaks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (tweak.category === 'Services') {
        void fetchLiveTelemetry();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('ERR', `Falha ao aplicar tweak "${tweak.label}": ${msg}`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleRunRepair = async (repairId: WintoysRepairId) => {
    if (!isTauri || disabled || runningRepair) return;
    setRunningRepair(repairId);
    try {
      await tauriBridge.runWintoysRepair(repairId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog('ERR', `Falha no reparo ${repairId}: ${msg}`);
    } finally {
      setRunningRepair(null);
    }
  };

  const categories = ['Todos', 'Explorer', 'Privacy', 'Performance', 'Services'];
  const filteredTweaks = useMemo(() => {
    if (categoryFilter === 'Todos') return tweaks;
    return tweaks.filter((t) => t.category === categoryFilter);
  }, [tweaks, categoryFilter]);

  const ramPct =
    health && health.ramTotalBytes > 0
      ? Math.round((health.ramUsedBytes / health.ramTotalBytes) * 100)
      : 0;
  const cpuPct = health ? Math.min(100, Math.round(health.cpuUsagePct)) : 0;

  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#313244] pb-2">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-[#cba6f7]" />
          <h2 className="font-mono text-xs font-bold text-[#cba6f7]">
            [06] WINTOYS
          </h2>
        </div>
        <button
          type="button"
          onClick={() => {
            void fetchLiveTelemetry();
            void fetchLiveTweaks();
          }}
          disabled={!isTauri || loadingHealth}
          className="flex items-center gap-1 border border-[#313244] bg-[#181825] px-2 py-1 font-mono text-[10px] text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] disabled:opacity-40 cursor-pointer"
        >
          <RefreshCw className={`h-2.5 w-2.5 ${loadingHealth ? 'animate-spin' : ''}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {!isTauri && (
        <div className="border border-[#fab387]/40 bg-[#fab387]/10 px-3 py-2 font-mono text-[10px] text-[#fab387]">
          Telemetria nativa e leitura do Registro do Windows requerem o WinForge.exe no Windows.
        </div>
      )}

      {/* Telemetry Cards: CPU & RAM */}
      <section className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5 border border-[#313244] bg-[#181825] p-2.5">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="flex items-center gap-1 text-[#a6adc8]">
              <Cpu className="h-3 w-3 text-[#89b4fa]" />
              CPU
            </span>
            <span className="font-bold text-[#cdd6f4] tabular-nums">
              {health ? `${cpuPct}%` : '—'}
            </span>
          </div>
          <div className="h-1.5 w-full bg-[#313244]">
            <div
              className="h-full bg-[#89b4fa] transition-all duration-300"
              style={{ width: `${cpuPct}%` }}
            />
          </div>
          <span className="font-mono text-[9px] text-[#6c7086]">
            {health ? `${health.cpuCores} threads` : 'Aguardando Win32'}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 border border-[#313244] bg-[#181825] p-2.5">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="flex items-center gap-1 text-[#a6adc8]">
              <MemoryStick className="h-3 w-3 text-[#cba6f7]" />
              RAM
            </span>
            <span className="font-bold text-[#cdd6f4] tabular-nums">
              {health ? `${ramPct}%` : '—'}
            </span>
          </div>
          <div className="h-1.5 w-full bg-[#313244]">
            <div
              className="h-full bg-[#cba6f7] transition-all duration-300"
              style={{ width: `${ramPct}%` }}
            />
          </div>
          <span className="truncate font-mono text-[9px] text-[#6c7086] tabular-nums">
            {health
              ? `${formatBytesGb(health.ramUsedBytes)} / ${formatBytesGb(health.ramTotalBytes)}`
              : '— / —'}
          </span>
        </div>
      </section>

      {/* Uptime & Disks */}
      {health && (
        <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-2.5">
          <div className="flex items-center justify-between border-b border-[#313244] pb-1.5 font-mono text-[10px]">
            <span className="flex items-center gap-1.5 text-[#a6adc8]">
              <Clock className="h-3 w-3 text-[#a6e3a1]" />
              Uptime
            </span>
            <span className="font-semibold text-[#a6e3a1] tabular-nums">
              {formatUptime(health.uptimeSecs)}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {health.disks.slice(0, 4).map((disk) => {
              const pct =
                disk.totalBytes > 0 ? Math.round((disk.usedBytes / disk.totalBytes) * 100) : 0;
              return (
                <div key={disk.mountPoint} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="flex items-center gap-1 text-[#cdd6f4]">
                      <HardDrive className="h-3 w-3 text-[#fab387]" />
                      {disk.mountPoint} {disk.name ? `(${disk.name})` : ''}
                    </span>
                    <span className="text-[9px] text-[#7f849c] tabular-nums">
                      {formatBytesGb(disk.usedBytes)} / {formatBytesGb(disk.totalBytes)} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1 w-full bg-[#313244]">
                    <div
                      className={`h-full ${pct > 88 ? 'bg-[#f38ba8]' : 'bg-[#fab387]'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Critical Services status row */}
          <div className="grid grid-cols-3 gap-1.5 border-t border-[#313244] pt-2">
            {health.services.map((svc) => (
              <div
                key={svc.name}
                className="flex flex-col gap-0.5 border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono"
              >
                <span className="truncate text-[9px] font-semibold text-[#cdd6f4]">
                  {svc.name}
                </span>
                <span
                  className={`text-[8px] font-bold ${
                    svc.running
                      ? 'text-[#a6e3a1]'
                      : svc.disabled
                      ? 'text-[#fab387]'
                      : 'text-[#7f849c]'
                  }`}
                >
                  {svc.disabled ? 'DISABLED' : svc.state}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick Repairs */}
      <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[#cba6f7]">
            <Shield className="h-3 w-3" />
            REPARO RÁPIDO
          </span>
          <span className="font-mono text-[9px] text-[#6c7086]">Sistema &amp; Rede</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => handleRunRepair('flush_dns')}
            disabled={!isTauri || disabled || Boolean(runningRepair)}
            className="flex flex-col items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2 py-2 font-mono text-[9px] font-semibold text-[#a6e3a1] hover:border-[#a6e3a1] transition-colors disabled:opacity-40 cursor-pointer"
          >
            {runningRepair === 'flush_dns' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            <span>Flush DNS</span>
          </button>

          <button
            type="button"
            onClick={() => handleRunRepair('rebuild_icon_cache')}
            disabled={!isTauri || disabled || Boolean(runningRepair)}
            className="flex flex-col items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2 py-2 font-mono text-[9px] font-semibold text-[#fab387] hover:border-[#fab387] transition-colors disabled:opacity-40 cursor-pointer"
          >
            {runningRepair === 'rebuild_icon_cache' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImageOff className="h-3.5 w-3.5" />
            )}
            <span>Icon Cache</span>
          </button>

          <button
            type="button"
            onClick={() => handleRunRepair('reset_network')}
            disabled={!isTauri || disabled || Boolean(runningRepair)}
            className="flex flex-col items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2 py-2 font-mono text-[9px] font-semibold text-[#89b4fa] hover:border-[#89b4fa] transition-colors disabled:opacity-40 cursor-pointer"
          >
            {runningRepair === 'reset_network' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Network className="h-3.5 w-3.5" />
            )}
            <span>Reset Net</span>
          </button>
        </div>
      </section>

      {/* Reversible Tweaks Grid */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#a6adc8]">
            <SlidersHorizontal className="h-3 w-3 text-[#cba6f7]" />
            TWEAKS REVERSÍVEIS (LIVE)
          </h3>
          <span className="font-mono text-[9px] text-[#6c7086]">Registro Real</span>
        </div>

        {/* Category Filter Bar */}
        <div className="grid grid-cols-5 border border-[#313244] bg-[#181825] p-0.5 font-mono text-[9px]">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`py-1 transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-[#cba6f7] font-bold text-[#11111b]'
                  : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              {cat === 'Performance' ? 'Perf' : cat}
            </button>
          ))}
        </div>

        <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
          {filteredTweaks.map((tweak) => {
            const busy = togglingId === tweak.id;
            return (
              <div
                key={tweak.id}
                onClick={() => handleToggleTweak(tweak)}
                className={`flex items-center justify-between gap-2.5 px-3 py-2.5 transition-colors ${
                  isTauri && !disabled ? 'cursor-pointer hover:bg-[#313244]/30' : 'opacity-75'
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-[#cdd6f4]">
                      {tweak.label}
                    </span>
                    <span className="shrink-0 font-mono text-[8px] uppercase text-[#7f849c]">
                      [{tweak.category}]
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-[#7f849c]">
                    {tweak.description}
                  </span>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={tweak.enabled}
                  disabled={!isTauri || disabled || busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleToggleTweak(tweak);
                  }}
                  className={`flex h-5 w-10 shrink-0 items-center border px-0.5 font-mono text-[8px] font-bold transition-colors cursor-pointer disabled:opacity-40 ${
                    tweak.enabled
                      ? 'justify-end border-[#a6e3a1] bg-[#a6e3a1]/20 text-[#a6e3a1]'
                      : 'justify-start border-[#45475a] bg-[#1e1e2e] text-[#6c7086]'
                  }`}
                >
                  {busy ? (
                    <Loader2 className="mx-auto h-3 w-3 animate-spin text-[#cba6f7]" />
                  ) : (
                    <span
                      className={`h-3.5 w-3.5 ${
                        tweak.enabled ? 'bg-[#a6e3a1]' : 'bg-[#6c7086]'
                      }`}
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
