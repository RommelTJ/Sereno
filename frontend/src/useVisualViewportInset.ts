import { useEffect, useState } from 'react'

export interface ViewportInset {
  // How far the visible area's bottom edge sits above the window's —
  // the height the on-screen keyboard covers.
  bottom: number
  // The height still visible above the keyboard.
  height: number
}

// iOS Safari keeps position: fixed elements on the layout viewport, which
// the on-screen keyboard does not shrink, so a bottom sheet lands behind
// the keyboard. The visual viewport is what the user can actually see.
function read(): ViewportInset {
  const viewport = window.visualViewport
  if (!viewport) return { bottom: 0, height: window.innerHeight }
  return {
    bottom: Math.max(
      0,
      window.innerHeight - viewport.height - viewport.offsetTop,
    ),
    height: viewport.height,
  }
}

export function useVisualViewportInset(): ViewportInset {
  const [inset, setInset] = useState(read)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setInset(read())
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
