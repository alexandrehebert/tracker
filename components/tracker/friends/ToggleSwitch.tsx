'use client';

export function ToggleSwitch({
  checked,
  onToggle,
  label,
  disabled = false,
  pending = false,
}: {
  checked: boolean;
  onToggle: (nextValue: boolean) => void;
  label: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onToggle(!checked)}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-100 transition hover:border-cyan-400/40 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${checked ? 'bg-emerald-500/90' : 'bg-slate-700'}`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
      <span className="font-medium">{pending ? 'Saving…' : checked ? 'On' : 'Off'}</span>
    </button>
  );
}
