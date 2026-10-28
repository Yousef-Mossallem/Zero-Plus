// frontend/src/pages/policies/blocks.tsx
import { Toggle } from '../../components/ui/kit'
export { Section } from '../../components/ui/Section'

export function ToggleRow({
  label,
  hint,
  checked,
  modified,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  modified: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl border border-white/6 bg-white/2 px-4 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-white">
          {label}
          {modified && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Changed" />}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}
