import { useState } from 'react'

// Destruction takes a deliberate pair of taps — touch-friendly without a
// native confirm dialog: the first tap arms, the second really deletes.
// Closing the form unmounts the button, so an armed state never survives
// a cancel or a reopen.
function DeleteButton({
  disabled,
  onDelete,
}: {
  disabled: boolean
  onDelete: () => void
}) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (armed ? onDelete() : setArmed(true))}
      className={`flex-1 cursor-pointer rounded-[11px] py-2.5 text-[13px] font-bold disabled:opacity-60 ${
        armed
          ? 'bg-red text-white'
          : 'border border-red bg-card text-red'
      }`}
    >
      {armed ? 'Tap again to delete' : 'Delete'}
    </button>
  )
}

export default DeleteButton
