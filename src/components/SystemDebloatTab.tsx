import React, { useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Plus,
  Rocket,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  AutostartTask,
  ExternalScript,
  QuickMaintenanceAction,
  SystemTweak,
} from '../types/profile';
import { TuiCheckbox } from './TuiCheckbox';

interface SystemDebloatTabProps {
  createRestorePoint: boolean;
  tweaks: SystemTweak[];
  scripts: ExternalScript[];
  autostartTasks: AutostartTask[];
  isTauri: boolean;
  runningMaintenance: QuickMaintenanceAction | null;
  disabled: boolean;
  onToggleRestorePoint: (enabled: boolean) => void;
  onToggleTweak: (id: string) => void;
  onDeleteTweak: (id: string) => void;
  onAddTweak: (tweak: SystemTweak) => void;
  onToggleScript: (id: string) => void;
  onToggleScriptInteractive: (id: string) => void;
  onDeleteScript: (id: string) => void;
  onAddScript: (script: ExternalScript) => void;
  onToggleAutostart: (index: number) => void;
  onToggleAutostartAdmin: (index: number) => void;
  onAddAutostart: (task: AutostartTask) => void;
  onDeleteAutostart: (index: number) => void;
  onScanStartupTasks?: () => Promise<void>;
  onDeployAutostartTasks?: () => Promise<void>;
  onRunQuickMaintenance: (action: QuickMaintenanceAction) => void;
}

export function SystemDebloatTab({
  createRestorePoint,
  tweaks,
  scripts,
  autostartTasks,
  isTauri,
  runningMaintenance,
  disabled,
  onToggleRestorePoint,
  onToggleTweak,
  onDeleteTweak,
  onAddTweak,
  onToggleScript,
  onToggleScriptInteractive,
  onDeleteScript,
  onAddScript,
  onToggleAutostart,
  onToggleAutostartAdmin,
  onAddAutostart,
  onDeleteAutostart,
  onScanStartupTasks,
  onDeployAutostartTasks,
  onRunQuickMaintenance,
}: SystemDebloatTabProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [entryType, setEntryType] = useState<'tweak' | 'script' | 'autostart'>('tweak');
  const [label, setLabel] = useState('');
  const [idInput, setIdInput] = useState('');
  const [command, setCommand] = useState('');
  const [interactive, setInteractive] = useState(false);
  const [autoArgs, setAutoArgs] = useState('');
  const [autoAdmin, setAutoAdmin] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLabel = label.trim();
    const cleanCommand = command.trim();

    if (entryType === 'autostart') {
      if (!cleanLabel || !cleanCommand) {
        setFormError('Informe o nome da tarefa e o caminho do executável (exe_path).');
        return;
      }
      onAddAutostart({
        name: cleanLabel,
        exe_path: cleanCommand,
        args: autoArgs.trim(),
        run_as_admin: autoAdmin,
        enabled: true,
      });
      setLabel('');
      setCommand('');
      setAutoArgs('');
      setAutoAdmin(true);
      setFormError(null);
      setShowAddForm(false);
      return;
    }

    if (!cleanLabel || !cleanCommand) {
      setFormError('Informe um título e o comando PowerShell/Registro.');
      return;
    }

    const generatedId =
      idInput
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_') ||
      cleanLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 28) ||
      `custom_${Date.now()}`;

    if (entryType === 'tweak') {
      onAddTweak({
        id: generatedId,
        label: cleanLabel,
        command: cleanCommand,
        enabled: true,
      });
    } else {
      onAddScript({
        id: generatedId,
        label: cleanLabel,
        command: cleanCommand,
        interactive,
        enabled: true,
      });
    }

    setLabel('');
    setIdInput('');
    setCommand('');
    setInteractive(false);
    setFormError(null);
    setShowAddForm(false);
  };

  const enabledTweaksCount = tweaks.filter((t) => t.enabled).length;
  const enabledScriptsCount = scripts.filter((s) => s.enabled).length;
  const enabledAutostartsCount = autostartTasks.filter((a) => a.enabled !== false).length;

  return (
    <div className="flex flex-col gap-4 p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#313244] pb-2">
        <h2 className="font-mono text-xs font-bold text-[#cba6f7]">
          [01] SYSTEM &amp; DEBLOAT
        </h2>
        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          disabled={disabled}
          className="flex items-center gap-1 border border-[#cba6f7] bg-[#cba6f7]/10 px-2.5 py-1 font-mono text-[11px] font-medium text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#11111b] transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
        >
          {showAddForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          <span>{showAddForm ? 'Fechar' : 'Novo'}</span>
        </button>
      </div>

      {/* Stage 0 Restore Point */}
      <div
        onClick={() => !disabled && onToggleRestorePoint(!createRestorePoint)}
        className={`flex items-start gap-2.5 border border-[#313244] bg-[#181825] p-3 transition-colors ${
          disabled ? 'opacity-60' : 'cursor-pointer hover:border-[#a6e3a1]/50'
        }`}
      >
        <div className="mt-0.5">
          <TuiCheckbox
            checked={createRestorePoint}
            onChange={onToggleRestorePoint}
            ariaLabel="Criar Ponto de Restauração do Windows no Estágio 0"
            disabled={disabled}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#cdd6f4]">
            <Shield className="h-3.5 w-3.5 shrink-0 text-[#a6e3a1]" />
            <span>Criar Ponto de Restauração (Estágio 0)</span>
          </div>
          <p className="truncate font-mono text-[10px] text-[#7f849c]">
            Checkpoint-Computer -RestorePointType MODIFY_SETTINGS
          </p>
        </div>
      </div>

      {/* Quick Maintenance Panel */}
      <section className="flex flex-col gap-2 border border-[#313244] bg-[#181825] p-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#cba6f7]">
            <Wrench className="h-3 w-3" />
            <span>QUICK MAINTENANCE</span>
          </h3>
          <span className="font-mono text-[9px] text-[#7f849c]">Dia a dia</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onRunQuickMaintenance('clean_temp_winget')}
            disabled={disabled || Boolean(runningMaintenance) || !isTauri}
            className="flex items-center justify-center gap-1.5 border border-[#313244] bg-[#1e1e2e] px-2.5 py-2 font-mono text-[10px] font-semibold text-[#a6e3a1] hover:border-[#a6e3a1] hover:bg-[#a6e3a1]/10 transition-colors disabled:opacity-40 cursor-pointer"
          >
            {runningMaintenance === 'clean_temp_winget' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            <span>%TEMP% + WinGet</span>
          </button>

          <button
            type="button"
            onClick={() => onRunQuickMaintenance('sfc_scannow')}
            disabled={disabled || Boolean(runningMaintenance) || !isTauri}
            className="flex items-center justify-center gap-1.5 border border-[#313244] bg-[#1e1e2e] px-2.5 py-2 font-mono text-[10px] font-semibold text-[#89b4fa] hover:border-[#89b4fa] hover:bg-[#89b4fa]/10 transition-colors disabled:opacity-40 cursor-pointer"
          >
            {runningMaintenance === 'sfc_scannow' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            <span>sfc /scannow</span>
          </button>
        </div>
      </section>

      {/* Add Form */}
      {showAddForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2.5 border border-[#cba6f7]/60 bg-[#181825] p-3"
        >
          <div className="grid grid-cols-3 border border-[#313244] bg-[#1e1e2e] p-0.5">
            <button
              type="button"
              onClick={() => setEntryType('tweak')}
              className={`py-1 font-mono text-[10px] transition-colors cursor-pointer ${
                entryType === 'tweak'
                  ? 'bg-[#cba6f7] font-semibold text-[#11111b]'
                  : 'text-[#a6adc8]'
              }`}
            >
              Tweak
            </button>
            <button
              type="button"
              onClick={() => setEntryType('script')}
              className={`py-1 font-mono text-[10px] transition-colors cursor-pointer ${
                entryType === 'script'
                  ? 'bg-[#cba6f7] font-semibold text-[#11111b]'
                  : 'text-[#a6adc8]'
              }`}
            >
              Script
            </button>
            <button
              type="button"
              onClick={() => setEntryType('autostart')}
              className={`py-1 font-mono text-[10px] transition-colors cursor-pointer ${
                entryType === 'autostart'
                  ? 'bg-[#cba6f7] font-semibold text-[#11111b]'
                  : 'text-[#a6adc8]'
              }`}
            >
              Autostart
            </button>
          </div>

          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              entryType === 'tweak'
                ? 'Descrição (ex: Mostrar extensões)'
                : entryType === 'script'
                ? 'Descrição (ex: Chris Titus WinUtil)'
                : 'Nome da tarefa (ex: GlazeWM)'
            }
            className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
          />

          {entryType !== 'autostart' && (
            <input
              type="text"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              placeholder="ID único (opcional)"
              className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[11px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
            />
          )}

          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={
              entryType === 'autostart'
                ? 'exe_path (ex: C:\\Program Files\\GlazeWM\\glazewm.exe)'
                : 'Comando PowerShell / reg add ...'
            }
            className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[11px] text-[#a6e3a1] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
          />

          {entryType === 'autostart' && (
            <>
              <input
                type="text"
                value={autoArgs}
                onChange={(e) => setAutoArgs(e.target.value)}
                placeholder="Argumentos (opcional, ex: --minimized)"
                className="border border-[#313244] bg-[#1e1e2e] px-2.5 py-1.5 font-mono text-[11px] text-[#cdd6f4] placeholder:text-[#6c7086] focus:border-[#cba6f7] focus:outline-none"
              />
              <div
                onClick={() => setAutoAdmin((v) => !v)}
                className="flex cursor-pointer items-center gap-2 text-[11px] text-[#fab387]"
              >
                <TuiCheckbox
                  checked={autoAdmin}
                  onChange={setAutoAdmin}
                  ariaLabel="Executar tarefa como Administrador (/rl highest)"
                />
                <span className="font-mono">Executar como Admin (/rl highest)</span>
              </div>
            </>
          )}

          {entryType === 'script' && (
            <div
              onClick={() => setInteractive((v) => !v)}
              className="flex cursor-pointer items-center gap-2 text-[11px] text-[#fab387]"
            >
              <TuiCheckbox
                checked={interactive}
                onChange={setInteractive}
                ariaLabel="Executar em janela interativa"
              />
              <span className="font-mono">Abrir janela PowerShell interativa</span>
            </div>
          )}

          {formError && <p className="font-mono text-[11px] text-[#f38ba8]">{formError}</p>}

          <button
            type="submit"
            className="w-full bg-[#cba6f7] py-1.5 font-mono text-xs font-semibold text-[#11111b] hover:bg-[#d8b8ff] cursor-pointer"
          >
            Adicionar ao Perfil
          </button>
        </form>
      )}

      {/* System Tweaks */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-mono text-[11px] font-semibold text-[#a6adc8]">
            TWEAKS DE REGISTRO
          </h3>
          <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
            {enabledTweaksCount}/{tweaks.length} ativos
          </span>
        </div>

        {tweaks.length === 0 ? (
          <div className="border border-[#313244] bg-[#181825]/60 p-4 text-center font-mono text-[11px] text-[#7f849c]">
            Nenhum tweak configurado. Clique em &quot;Novo&quot; ou importe um profile.json.
          </div>
        ) : (
          <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
            {tweaks.map((tweak) => (
              <div
                key={tweak.id}
                onClick={() => !disabled && onToggleTweak(tweak.id)}
                className={`flex items-start justify-between gap-2 px-3 py-2.5 transition-colors ${
                  tweak.enabled ? '' : 'opacity-60'
                } ${!disabled ? 'cursor-pointer hover:bg-[#313244]/30' : ''}`}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5">
                    <TuiCheckbox
                      checked={tweak.enabled}
                      onChange={() => onToggleTweak(tweak.id)}
                      ariaLabel={`Ativar tweak ${tweak.label}`}
                      disabled={disabled}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-medium text-[#cdd6f4]">{tweak.label}</span>
                    <code className="truncate font-mono text-[10px] text-[#7f849c]">
                      {tweak.command}
                    </code>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTweak(tweak.id);
                  }}
                  disabled={disabled}
                  title="Remover tweak"
                  className="p-1 text-[#6c7086] hover:text-[#f38ba8] disabled:opacity-30 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* External Scripts */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-mono text-[11px] font-semibold text-[#a6adc8]">
            SCRIPTS EXTERNOS
          </h3>
          <span className="font-mono text-[10px] text-[#7f849c] tabular-nums">
            {enabledScriptsCount}/{scripts.length} ativos
          </span>
        </div>

        {scripts.length === 0 ? (
          <div className="border border-[#313244] bg-[#181825]/60 p-4 text-center font-mono text-[11px] text-[#7f849c]">
            Nenhum script externo cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
            {scripts.map((script) => (
              <div
                key={script.id}
                onClick={() => !disabled && onToggleScript(script.id)}
                className={`flex flex-col gap-2 px-3 py-2.5 transition-colors ${
                  script.enabled ? '' : 'opacity-60'
                } ${!disabled ? 'cursor-pointer hover:bg-[#313244]/30' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5">
                      <TuiCheckbox
                        checked={script.enabled}
                        onChange={() => onToggleScript(script.id)}
                        ariaLabel={`Ativar script ${script.label}`}
                        disabled={disabled}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs font-medium text-[#cdd6f4]">
                        {script.label}
                      </span>
                      <code className="truncate font-mono text-[10px] text-[#89b4fa]">
                        {script.command}
                      </code>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteScript(script.id);
                    }}
                    disabled={disabled}
                    title="Remover script"
                    className="p-1 text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between pl-6">
                  {script.interactive ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#fab387]">
                      <AlertTriangle className="h-3 w-3" />
                      <span>INTERACTIVE SHELL</span>
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-[#6c7086]">
                      execução oculta
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleScriptInteractive(script.id);
                    }}
                    disabled={disabled}
                    className={`flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] cursor-pointer ${
                      script.interactive
                        ? 'border-[#fab387]/50 text-[#fab387]'
                        : 'border-[#313244] text-[#7f849c] hover:text-[#cdd6f4]'
                    }`}
                  >
                    <TerminalSquare className="h-2.5 w-2.5" />
                    <span>{script.interactive ? 'Interativo' : 'Oculto'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Autostart Elevado (Task Scheduler - schtasks /sc onlogon) */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#a6adc8]">
            <Rocket className="h-3 w-3 text-[#cba6f7]" />
            <span>AUTOSTART ELEVADO</span>
            <span className="text-[10px] font-normal text-[#7f849c] tabular-nums">
              ({enabledAutostartsCount}/{autostartTasks.length})
            </span>
          </h3>
          <div className="flex items-center gap-1">
            {onScanStartupTasks && (
              <button
                type="button"
                onClick={() => void onScanStartupTasks()}
                disabled={!isTauri || disabled}
                title="Escanear atalhos em %APPDATA%\\...\\Startup"
                className="border border-[#313244] bg-[#181825] px-1.5 py-0.5 font-mono text-[9px] text-[#89b4fa] hover:border-[#89b4fa] disabled:opacity-40 cursor-pointer"
              >
                Scan Startup
              </button>
            )}
            {onDeployAutostartTasks && enabledAutostartsCount > 0 && (
              <button
                type="button"
                onClick={() => void onDeployAutostartTasks()}
                disabled={!isTauri || disabled}
                title="Agendar tarefas ativas agora via schtasks /create /sc onlogon"
                className="border border-[#a6e3a1]/60 bg-[#a6e3a1]/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#a6e3a1] hover:bg-[#a6e3a1] hover:text-[#11111b] disabled:opacity-40 cursor-pointer"
              >
                Agendar
              </button>
            )}
          </div>
        </div>

        {autostartTasks.length === 0 ? (
          <div className="border border-[#313244] bg-[#181825]/60 p-4 text-center font-mono text-[11px] text-[#7f849c]">
            Nenhuma tarefa de inicialização configurada. O HARVEST sugere itens da pasta Startup automaticamente.
          </div>
        ) : (
          <div className="divide-y divide-[#313244] border border-[#313244] bg-[#181825]">
            {autostartTasks.map((task, idx) => {
              const isEnabled = task.enabled !== false;
              return (
                <div
                  key={`${task.name}_${idx}`}
                  onClick={() => !disabled && onToggleAutostart(idx)}
                  className={`flex flex-col gap-1.5 px-3 py-2.5 transition-colors ${
                    isEnabled ? '' : 'opacity-60'
                  } ${!disabled ? 'cursor-pointer hover:bg-[#313244]/30' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="mt-0.5">
                        <TuiCheckbox
                          checked={isEnabled}
                          onChange={() => onToggleAutostart(idx)}
                          ariaLabel={`Ativar autostart ${task.name}`}
                          disabled={disabled}
                        />
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-xs font-medium text-[#cdd6f4]">
                          {task.name}
                        </span>
                        <code className="truncate font-mono text-[10px] text-[#a6e3a1]">
                          {task.exe_path}
                          {task.args ? ` ${task.args}` : ''}
                        </code>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteAutostart(idx);
                      }}
                      disabled={disabled}
                      title="Remover tarefa autostart"
                      className="shrink-0 p-1 text-[#6c7086] hover:text-[#f38ba8] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pl-6">
                    <span className="font-mono text-[10px] text-[#6c7086]">
                      /sc onlogon {task.run_as_admin ? '/rl highest' : ''}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleAutostartAdmin(idx);
                      }}
                      disabled={disabled}
                      className={`flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] cursor-pointer ${
                        task.run_as_admin
                          ? 'border-[#fab387]/50 bg-[#fab387]/10 text-[#fab387]'
                          : 'border-[#313244] text-[#7f849c] hover:text-[#cdd6f4]'
                      }`}
                    >
                      <ShieldAlert className="h-2.5 w-2.5" />
                      <span>{task.run_as_admin ? 'Admin' : 'Padrão'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
