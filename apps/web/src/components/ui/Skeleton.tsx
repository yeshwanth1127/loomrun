export function Skeleton({ className, height }: { className?: string; height?: string }) {
  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={{ height: height ?? '1rem' }}
    />
  )
}

export function MetricSkeleton() {
  return (
    <div className="metrics-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="metric-card" style={{ minHeight: 120, opacity: 0.4 }} />
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: '30%' }}>
              <Skeleton height="0.75rem" />
            </th>
            <th style={{ width: '20%' }}>
              <Skeleton height="0.75rem" />
            </th>
            <th style={{ width: '20%' }}>
              <Skeleton height="0.75rem" />
            </th>
            <th style={{ width: '30%' }}>
              <Skeleton height="0.75rem" />
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              <td>
                <Skeleton height="0.875rem" />
              </td>
              <td>
                <Skeleton height="0.875rem" />
              </td>
              <td>
                <Skeleton height="0.875rem" />
              </td>
              <td>
                <Skeleton height="0.875rem" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function KanbanSkeleton() {
  return (
    <div className="kanban-board">
      {Array.from({ length: 8 }).map((_, colIdx) => (
        <div key={colIdx} className="kanban-col">
          <div className="kanban-col-header">
            <div className="kanban-col-title">
              <Skeleton height="0.75rem" />
            </div>
            <div className="kanban-col-count">
              <Skeleton height="0.65rem" />
            </div>
          </div>
          <div className="kanban-col-body">
            {Array.from({ length: 3 }).map((_, cardIdx) => (
              <div
                key={cardIdx}
                className="kanban-card"
                style={{ minHeight: 60, opacity: 0.4 }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
