import { useState, type ReactNode } from 'react'

/**
 * Click-to-edit field. Commits on blur, or on Enter for single-line inputs —
 * same interaction as the legacy lead drawer.
 */
export function InfoField({
  label,
  value,
  onEdit,
  inputType = 'text',
  multiline = false,
  editValue,
  options,
  readOnly = false,
}: {
  label: string
  value: ReactNode
  onEdit: (next: string) => void
  inputType?: string
  multiline?: boolean
  /** Raw value to seed the editor when the display value is formatted. */
  editValue?: string
  /** Renders a select instead of a text input. */
  options?: Array<{ value: string; label: string }>
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const baseline = editValue ?? (typeof value === 'string' ? value : '') ?? ''

  function startEdit() {
    if (readOnly) return
    setDraft(baseline)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    if (draft !== baseline) onEdit(draft)
  }

  if (editing) {
    return (
      <div className="info-field">
        <label>{label}</label>
        {options ? (
          <select
            className="select"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : multiline ? (
          <textarea
            className="input"
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />
        ) : (
          <input
            className="input"
            autoFocus
            type={inputType}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="info-field">
      <label>{label}</label>
      <div
        className={readOnly ? 'value' : 'value value-editable'}
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        title={readOnly ? undefined : 'Click to edit'}
        onClick={startEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') startEdit()
        }}
      >
        {value ?? <span className="muted small">—</span>}
      </div>
    </div>
  )
}
