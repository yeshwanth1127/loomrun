import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function RowActions({
  label = 'Actions',
  children,
}: {
  label?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    function updateCoords() {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    updateCoords()
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', updateCoords)
    window.addEventListener('scroll', updateCoords, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updateCoords)
      window.removeEventListener('scroll', updateCoords, true)
    }
  }, [open])

  return (
    <div className="row-actions" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown size={13} style={{ marginLeft: 2 }} />
      </button>
      {/* Portalled to <body>: table containers carry a lingering transform from
          their fade-up animation, which would otherwise make this fixed menu
          position against the container and get clipped by its overflow. */}
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            className="row-actions-menu"
            role="menu"
            style={{ top: coords.top, right: coords.right }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  )
}
