import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FlaskConical,
  Play,
  RotateCcw,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react';
import {
  LogEntry,
  LogLevel,
  PipelineProgressEvent,
  ProvisionFinishedEvent,
} from '../types/profile';

interface TerminalConsoleProps {
  logs: LogEntry[];
  progressState: PipelineProgressEvent;
  lastFinished: ProvisionFinishedEvent | null;
  dryRun: boolean;
  isTauri: boolean;
  onToggleDryRun: () => void;
  onExecute: () => void;
  onAbort: () => void;
  onClearLogs: () => void;
  onRetryFailedItems: () => void;
}

const LEVEL_STYLES: Record<LogLevel, string> = {
  INFO: 'text-[#89b4fa]',
  OK: 'text-[#a6e3a1]',
  WARN: 'text-[#fab387]',
  ERR: 'text-[#f38ba8]',
};

/**
 * Compact mobile-card docked console: collapsible log drawer, DRY-RUN MODE toggle switch,
 * RETRY FAILED ITEMS orange banner when failures occur, and EXECUTE PROVISIONING CTA.
 */
export function TerminalConsole({
  logs,
  progressState,
  lastFinished,
  dryRun,
  isTauri,
  onToggleDryRun,
  onExecute,
  onAbort,
  onClearLogs,
  onRetryFailedItems,
}: TerminalConsoleProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const isRunning = progressState.status === 'running';
  const failedCount = lastFinished
    ? Math.max(lastFinished.failureCount ?? 0, lastFinished.failed_count ?? 0)
    : 0;
  const hasRetryableFailures =
    !isRunning &&
    Boolean(lastFinished) &&
    failedCount > 0 &&
    Boolean(lastFinished?.failedProfile || lastFinished?.failedReportPath);

  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

  // Auto-open log drawer when provisioning starts
  useEffect(() => {
    if (isRunning) {
      setDrawerOpen(true);
    }
  }, [isRunning]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (el && drawerOpen) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, drawerOpen]);

  const handleCopyLogs = async () => {
    const content = logs
      .map((l) => `${l.timestamp} [S${l.stage}] [${l.level}] ${l.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <section
      aria-label="Console de execução em tempo real"
      className="flex shrink-0 flex-col border-t border-[#313244] bg-[#181825]"
    >
      {/* Thin hairline progress bar at top of docked console */}
      <div className="h-[2px] w-full bg-[#11111b]">
        <div
          className={`h-full transition-all duration-200 ${
            progressState.status === 'error'
              ? 'bg-[#f38ba8]'
              : progressState.status === 'completed'
              ? failedCount > 0
                ? 'bg-[#fab387]'
                : 'bg-[#a6e3a1]'
              : progressState.status === 'aborted'
              ? 'bg-[#fab387]'
              : 'bg-[#cba6f7]'
          }`}
          style={{ width: `${progressState.progress}%` }}
        />
      </div>

      {/* Collapsible Log Drawer Header Strip */}
      <div className="flex items-center justify-between gap-2 border-b border-[#313244]/80 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left font-mono text-[11px] text-[#a6adc8] hover:text-[#cdd6f4] transition-colors cursor-pointer"
        >
          <TerminalIcon className="h-3 w-3 shrink-0 text-[#cba6f7]" />
          <span className="shrink-0 font-semibold text-[#cdd6f4]">
            LOGS ({logs.length})
          </span>
          <span className="text-[#45475a]" aria-hidden="true">·</span>
          <span className="truncate text-[10px] text-[#7f849c]">
            {latestLog
              ? `[${latestLog.level}] ${latestLog.message}`
              : isTauri
              ? 'Tauri IPC pronto'
              : 'Desktop Offline'}
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {progressState.progress > 0 && (
            <span className="mr-1 font-mono text-[10px] font-semibold text-[#cba6f7] tabular-nums">
              {progressState.progress}%
            </span>
          )}
          <button
            type="button"
            onClick={handleCopyLogs}
            disabled={logs.length === 0}
            title="Copiar logs"
            className="flex h-6 w-6 items-center justify-center border border-[#313244] bg-[#1e1e2e] text-[#a6adc8] hover:text-[#cdd6f4] disabled:opacity-35 cursor-pointer"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[#a6e3a1]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={onClearLogs}
            disabled={logs.length === 0 || isRunning}
            title="Limpar logs"
            className="flex h-6 w-6 items-center justify-center border border-[#313244] bg-[#1e1e2e] text-[#a6adc8] hover:text-[#f38ba8] disabled:opacity-35 cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            title={drawerOpen ? 'Recolher logs' : 'Abrir logs'}
            className="flex h-6 w-6 items-center justify-center border border-[#313244] bg-[#1e1e2e] text-[#a6adc8] hover:border-[#cba6f7] hover:text-[#cba6f7] cursor-pointer"
          >
            {drawerOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Expandable Live Stream Log Body */}
      {drawerOpen && (
        <div
          ref={logContainerRef}
          className="h-44 overflow-y-auto border-b border-[#313244] bg-[#11111b] px-3 py-2 font-mono text-[11px] leading-4"
        >
          {logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-[#585b70]">
              <span>Aguardando execução do pipeline.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {logs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-1.5 break-words">
                  <span className="shrink-0 text-[10px] text-[#585b70] tabular-nums">
                    {entry.timestamp}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-semibold ${LEVEL_STYLES[entry.level]}`}
                  >
                    [{entry.level}]
                  </span>
                  <span
                    className={
                      entry.level === 'ERR'
                        ? 'text-[#f38ba8]'
                        : entry.level === 'WARN'
                        ? 'text-[#fab387]'
                        : entry.level === 'OK'
                        ? 'text-[#cdd6f4]'
                        : 'text-[#bac2de]'
                    }
                  >
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prominent Orange RETRY FAILED ITEMS bar when failures occur */}
      {hasRetryableFailures && (
        <div className="flex items-center justify-between gap-2 border-b border-[#fab387]/40 bg-[#fab387]/10 px-3 py-2">
          <span className="font-mono text-[11px] text-[#fab387] tabular-nums">
            {lastFinished?.successCount ?? 0} OK · {failedCount} falha(s)
          </span>
          <button
            type="button"
            onClick={onRetryFailedItems}
            title="Carrega failed_report.json e reexecuta apenas os itens que falharam"
            className="tui-chamfer flex h-7 items-center gap-1.5 bg-[#fab387] px-3 font-mono text-[11px] font-bold tracking-wide text-[#11111b] hover:bg-[#fbc4a1] active:translate-y-[1px] transition-all whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>RETRY FAILED ITEMS ({failedCount})</span>
          </button>
        </div>
      )}

      {/* Compact Primary Action Row: DRY-RUN MODE switch + EXECUTE PROVISIONING */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          role="switch"
          aria-checked={dryRun}
          onClick={onToggleDryRun}
          disabled={isRunning}
          title="DRY-RUN MODE: valida bundle, URLs portáteis e IDs do WinGet sem alterar nada"
          className={`flex h-8 items-center gap-2 border px-2.5 font-mono text-[11px] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer ${
            dryRun
              ? 'border-[#fab387] bg-[#fab387]/12 text-[#fab387]'
              : 'border-[#313244] bg-[#1e1e2e] text-[#a6adc8] hover:border-[#fab387]/60 hover:text-[#cdd6f4]'
          }`}
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-3.5 w-6 shrink-0 items-center border transition-colors ${
              dryRun
                ? 'border-[#fab387] bg-[#fab387]/30'
                : 'border-[#585b70] bg-[#11111b]'
            }`}
          >
            <span
              className={`inline-block h-2 w-2 transition-transform duration-150 ${
                dryRun
                  ? 'translate-x-3 bg-[#fab387]'
                  : 'translate-x-0.5 bg-[#7f849c]'
              }`}
            />
          </span>
          <span className="font-semibold">DRY-RUN</span>
        </button>

        {isRunning ? (
          <button
            type="button"
            onClick={onAbort}
            className="flex h-8 flex-1 items-center justify-center gap-2 border border-[#f38ba8] bg-[#f38ba8]/15 px-3 font-mono text-xs font-semibold text-[#f38ba8] hover:bg-[#f38ba8] hover:text-[#11111b] transition-colors whitespace-nowrap cursor-pointer"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>ABORT</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onExecute}
            className={`tui-chamfer flex h-8 flex-1 items-center justify-center gap-2 px-3 font-mono text-xs font-bold tracking-wide text-[#11111b] active:translate-y-[1px] transition-all whitespace-nowrap cursor-pointer ${
              dryRun
                ? 'bg-[#fab387] hover:bg-[#fbc4a1]'
                : 'bg-[#cba6f7] hover:bg-[#d8b8ff]'
            }`}
          >
            {dryRun ? (
              <FlaskConical className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            <span>{dryRun ? 'RUN DRY-RUN' : 'EXECUTE PROVISIONING'}</span>
          </button>
        )}
      </div>
    </section>
  );
}
