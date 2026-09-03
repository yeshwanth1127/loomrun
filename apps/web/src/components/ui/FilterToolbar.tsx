import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'

type FilterToolbarProps = {
  /** When true (default), collapse behind a Filters button if more than forceCollapseAt controls. */
  collapsible?: boolean
  /** Always show the toggle when collapsible. Default: collapse when children count is high. */
  defaultOpen?: boolean
  children: ReactNode
  /** Extra actions always visible next to the toggle (e.g. Clear). */
  trailing?: ReactNode
  className?: string
}

export function FilterToolbar({
  collapsible = true,
  defaultOpen = false,
  children,
  trailing,
  className = '',
}: FilterToolbarProps) {
  const [open, setOpen] = useState(defaultOpen)

  if (!collapsible) {
    return (
      <div className={`filter-toolbar filter-toolbar-inline ${className}`.trim()}>
        {children}
        {trailing}
      </div>
    )
  }

  return (
    <div className={`filter-toolbar${open ? ' filter-toolbar--open' : ''} ${className}`.trim()}>
      <div className="row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-sm btn-secondary filter-toolbar-toggle${open ? ' active' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <SlidersHorizontal size={14} />
          Filters
          <ChevronDown
            size={14}
            style={{
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 0.15s ease',
            }}
          />
        </button>
        {trailing}
      </div>
      <div className="filter-toolbar-panel" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
