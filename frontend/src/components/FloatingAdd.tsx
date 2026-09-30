import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type AddKind = 'spending' | 'income'

const CHOICES: { kind: AddKind; label: string }[] = [
  { kind: 'spending', label: 'Add spending' },
  { kind: 'income', label: 'Add income' },
]

// The add-forms for a view too narrow to give them a column of their own:
// a floating button opens a two-item menu, and the chosen form opens in a
// panel — a bottom sheet on phones, a card docked bottom-right from md up.
// The panel is non-modal: no backdrop, so the page behind it stays usable
// and a new entry can be watched landing in Activity. Closing unmounts
// the form, so a half-filled one is discarded and reopening starts blank.
// renderForm gets the close callback to call once an add succeeds.
function FloatingAdd({
  renderForm,
}: {
  renderForm: (kind: AddKind, close: () => void) => ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [open, setOpen] = useState<AddKind | null>(null)
  const close = () => setOpen(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (open) {
    const label = CHOICES.find((choice) => choice.kind === open)?.label
    return (
      <div
        role="dialog"
        aria-label={label}
        className="fixed inset-x-0 bottom-0 z-10 max-h-[85dvh] overflow-y-auto md:inset-x-auto md:right-4 md:bottom-4 md:max-h-[calc(100dvh-2rem)] md:w-[420px]"
      >
        {renderForm(open, close)}
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="absolute top-1.5 right-1.5 flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-input text-muted"
        >
          ✕
        </button>
      </div>
    )
  }

  // The panel takes the button's corner, so the button only shows while
  // no form is open.
  return (
    <>
      {menuOpen && (
        <div className="fixed right-4 bottom-[88px] z-10 flex flex-col items-end gap-2">
          {CHOICES.map((choice) => (
            <button
              key={choice.kind}
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setOpen(choice.kind)
              }}
              className="min-h-[44px] cursor-pointer rounded-pill border border-card-border bg-card px-4 text-[13.5px] font-bold"
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label="Add"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((isOpen) => !isOpen)}
        className="fixed right-4 bottom-4 z-10 flex size-14 min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full bg-sidebar text-white"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={`size-6 transition-transform ${menuOpen ? 'rotate-45' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </>
  )
}

export default FloatingAdd
