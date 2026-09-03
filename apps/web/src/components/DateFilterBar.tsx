import { Calendar } from 'lucide-react'
import { todayIsoDate, useDateFilter } from '../context/DateFilterContext'

export function DateFilterBar({ compact = true }: { compact?: boolean }) {
  const { mode, date, isAll, setMode, setDate } = useDateFilter()

  return (
    <div className={`date-filter-bar${compact ? ' date-filter-bar--compact' : ''}`}>
      <div className="date-filter-bar-inner">
        <Calendar size={14} style={{ color: 'var(--muted-fg)', flexShrink: 0 }} />
        <span className="date-filter-label">Period</span>
        <select
          className="select date-filter-select"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'all' | 'date')}
          aria-label="Filter period"
        >
          <option value="all">All</option>
          <option value="date">By date</option>
        </select>
        <input
          className="input date-filter-date"
          type="date"
          value={date}
          max={todayIsoDate()}
          disabled={isAll}
          onChange={(e) => {
            setMode('date')
            setDate(e.target.value)
          }}
          aria-label="Filter date"
        />
      </div>
    </div>
  )
}
