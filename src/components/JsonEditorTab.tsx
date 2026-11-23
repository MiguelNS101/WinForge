import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import { WinForgeProfile } from '../types/profile';
import { validateProfileJson } from '../utils/profileValidator';

interface JsonEditorTabProps {
  profile: WinForgeProfile;
  disabled: boolean;
  onApplyProfile: (updated: WinForgeProfile) => void;
  onValidityChange: (isValid: boolean) => void;
}

export function JsonEditorTab({
  profile,
  disabled,
  onApplyProfile,
  onValidityChange,
}: JsonEditorTabProps) {
  const serializedProfile = useMemo(() => JSON.stringify(profile, null, 2), [profile]);
  const [rawText, setRawText] = useState(serializedProfile);
  const [copied, setCopied] = useState(false);
  const [appliedFlash, setAppliedFlash] = useState(false);

  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setRawText(serializedProfile);
  }, [serializedProfile]);

  const validation = useMemo(() => validateProfileJson(rawText), [rawText]);
  const isDirty = rawText !== serializedProfile;

  useEffect(() => {
    onValidityChange(validation.valid);
  }, [validation.valid, onValidityChange]);

  const lineCount = useMemo(() => rawText.split('\n').length, [rawText]);

  const handleScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleFormat = () => {
    if (validation.valid && validation.parsed) {
      setRawText(JSON.stringify(validation.parsed, null, 2));
    }
  };

  const handleRevert = () => {
    setRawText(serializedProfile);
  };

  const handleApply = () => {
    if (!validation.valid || !validation.parsed || disabled) return;
    onApplyProfile(validation.parsed);
    setAppliedFlash(true);
    window.setTimeout(() => setAppliedFlash(false), 1400);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard fallback ignored silently
    }
  };

  return (
    <div className="flex h-full flex-col gap-2.5 p-3.5">
      {/* Header + Status */}
      <div className="flex items-center justify-between border-b border-[#313244] pb-2">
        <h2 className="font-mono text-xs font-bold text-[#cba6f7]">[04] JSON EDITOR</h2>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          {validation.valid ? (
            <span className="flex items-center gap-1 text-[#a6e3a1]">
              <CheckCircle2 className="h-3 w-3" />
              <span>VÁLIDO</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[#f38ba8]">
              <AlertCircle className="h-3 w-3" />
              <span>ERRO</span>
            </span>
          )}
          <span className="text-[#585b70]" aria-hidden="true">·</span>
          <span className="tabular-nums text-[#7f849c]">{lineCount}L</span>
        </div>
      </div>

      {/* Compact Action Toolbar */}
      <div className="flex items-center justify-between gap-1.5 border border-[#313244] bg-[#181825] p-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleFormat}
            disabled={!validation.valid || disabled}
            title="Formatar JSON"
            className="flex items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-[10px] text-[#cdd6f4] hover:border-[#cba6f7] hover:text-[#cba6f7] transition-colors disabled:opacity-40 cursor-pointer"
          >
            <Wand2 className="h-3 w-3" />
            <span>Fmt</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            title="Copiar JSON"
            className="flex items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-[10px] text-[#cdd6f4] hover:border-[#cba6f7] hover:text-[#cba6f7] transition-colors cursor-pointer"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[#a6e3a1]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            <span>{copied ? 'OK' : 'Copiar'}</span>
          </button>

          <button
            type="button"
            onClick={handleRevert}
            disabled={!isDirty || disabled}
            title="Reverter alterações"
            className="flex items-center gap-1 border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-[10px] text-[#a6adc8] hover:border-[#fab387] hover:text-[#fab387] transition-colors disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleApply}
          disabled={!validation.valid || !isDirty || disabled}
          className="flex items-center gap-1 border border-[#cba6f7] bg-[#cba6f7] px-2.5 py-1 font-mono text-[10px] font-semibold text-[#11111b] hover:bg-[#cba6f7]/90 transition-colors disabled:opacity-40 cursor-pointer"
        >
          <Check className="h-3 w-3" />
          <span>{appliedFlash ? 'Aplicado!' : 'Aplicar'}</span>
        </button>
      </div>

      {/* Validation Error / Warning Strip */}
      {!validation.valid && validation.error && (
        <div className="flex items-start gap-2 border border-[#f38ba8]/60 bg-[#f38ba8]/10 px-2.5 py-2 font-mono text-[10px] text-[#f38ba8]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{validation.error}</span>
        </div>
      )}

      {validation.valid && validation.warnings.length > 0 && (
        <div className="flex flex-col gap-0.5 border border-[#fab387]/50 bg-[#fab387]/10 px-2.5 py-1.5 font-mono text-[10px] text-[#fab387]">
          {validation.warnings.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
      )}

      {/* Raw Monospace Code Editor with Slim Line Gutter */}
      <div className="relative flex min-h-[260px] flex-1 overflow-hidden border border-[#313244] bg-[#11111b]">
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="w-9 shrink-0 select-none overflow-hidden border-r border-[#313244] bg-[#181825] py-2.5 pr-2 text-right font-mono text-[11px] leading-5 text-[#585b70] tabular-nums"
        >
          {Array.from({ length: lineCount }, (_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          onScroll={handleScroll}
          disabled={disabled}
          spellCheck={false}
          aria-label="Editor raw profile.json"
          className="h-full w-full resize-none bg-transparent p-2.5 font-mono text-[11px] leading-5 text-[#cdd6f4] focus:outline-none disabled:opacity-60"
        />
      </div>
    </div>
  );
}
