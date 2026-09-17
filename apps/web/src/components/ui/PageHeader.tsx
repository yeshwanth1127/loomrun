import type { ReactNode } from 'react'

type PageHeaderProps = {
  /** Usually a string; a node lets a page put an inline rename control in the title. */
  title: ReactNode
  badge?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  toolbar?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, badge, description, actions, toolbar, children }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div className="page-header-copy">
          <div className="page-title-row">
            <h1>{title}</h1>
            {badge != null && badge !== '' ? <span className="page-title-badge">{badge}</span> : null}
          </div>
          {description != null && description !== '' ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
      {toolbar ? <div className="page-header-toolbar">{toolbar}</div> : null}
      {children}
    </div>
  )
}
