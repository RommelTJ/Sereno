import { FieldLabel } from './SpendingForm.tsx'

// The curated emoji select — each form passes its own themed options list.
// The DB stores emoji as free TEXT; the options constrain only the UI.
function EmojiSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: { emoji: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label htmlFor={id} className="block">
      <FieldLabel text="Emoji" />
      <select
        id={id}
        className="mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.label} value={option.emoji}>
            {option.emoji} {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default EmojiSelect
