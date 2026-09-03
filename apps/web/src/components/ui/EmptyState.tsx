import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type EmptyStateProps = {
  icon?: LucideIcon
  title?: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      {Icon ? <Icon size={28} strokeWidth={1.5} /> : null}
      {title ? <p className="empty-state-title">{title}</p> : null}
      {description != null && description !== '' ? (
        typeof description === 'string' ? <p>{description}</p> : description
      ) : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}
