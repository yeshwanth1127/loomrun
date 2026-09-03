import {
  inOneHourLocal,
  tomorrowAt10Local,
} from '../lib/followUp'

export type CallbackPreset = '1h' | 'tomorrow' | 'custom'

export function CallbackScheduleFields({
  date,
  time,
  preset,
  onChange,
}: {
  date: string
  time: string
  preset: CallbackPreset
  onChange: (next: { date: string; time: string; preset: CallbackPreset }) => void
}) {
  return (
    <div className="callback-schedule">
      <div className="callback-schedule-title">Schedule follow-up</div>
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <button
          type="button"
          className={`btn btn-sm ${preset === '1h' ? '' : 'btn-ghost'}`}
          onClick={() => {
            const p = inOneHourLocal()
            onChange({ date: p.date, time: p.time, preset: '1h' })
          }}
        >
          In 1 hour
        </button>
        <button
          type="button"
          className={`btn btn-sm ${preset === 'tomorrow' ? '' : 'btn-ghost'}`}
          onClick={() => {
            const p = tomorrowAt10Local()
            onChange({ date: p.date, time: p.time, preset: 'tomorrow' })
          }}
        >
          Tomorrow 10:00
        </button>
        <button
          type="button"
          className={`btn btn-sm ${preset === 'custom' ? '' : 'btn-ghost'}`}
          onClick={() => onChange({ date, time, preset: 'custom' })}
        >
          Custom
        </button>
      </div>
      <div className="row" style={{ gap: '0.75rem' }}>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="input-label">Date *</label>
          <input
            className="input"
            type="date"
            required
            value={date}
            onChange={(e) => onChange({ date: e.target.value, time, preset: 'custom' })}
            style={{ width: '100%' }}
          />
        </div>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="input-label">Time (default 10:00)</label>
          <input
            className="input"
            type="time"
            value={time}
            onChange={(e) => onChange({ date, time: e.target.value, preset: 'custom' })}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  )
}
