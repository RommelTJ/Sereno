// The quiet per-row action button — Edit, Archive, Deactivate — shared by
// the Settings cards and the fund cards.
function GhostButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[8px] border border-input-border bg-card px-3 py-1 text-[11.5px] font-semibold text-muted"
    >
      {label}
    </button>
  )
}

export default GhostButton
