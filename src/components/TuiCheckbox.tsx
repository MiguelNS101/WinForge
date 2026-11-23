import { Check } from 'lucide-react';

interface TuiCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}

export function TuiCheckbox({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: TuiCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cba6f7] ${
        checked
          ? 'border-[#cba6f7] bg-[#cba6f7] text-[#11111b]'
          : 'border-[#585b70] bg-[#181825] text-transparent hover:border-[#cba6f7]/70'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <Check className="h-3 w-3 stroke-[3]" />
    </button>
  );
}
