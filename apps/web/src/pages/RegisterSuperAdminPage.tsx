import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NoolrunWordmark } from '../components/react-bits/NoolrunWordmark'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { useAuth } from '../context/AuthContext'

export function RegisterSuperAdminPage() {
  const { registerSuperAdmin } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  return (
    <div className="login-split">
      {/* Left: Brand panel */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="brand-logo-wrap">
            <NoolrunWordmark size="auth" />
          </div>
          <div className="brand-accent-line" />
          <p className="brand-tagline">platform administration</p>
        </div>
      </div>

      {/* Right: Form panel */}
      <div className="login-panel">
        <div className="login-panel-theme">
          <ThemeToggle />
        </div>
        <div className="login-panel-inner">
          <div className="login-header">
            <h1 className="login-title">Platform Admin</h1>
            <p className="login-subtitle">
              Your email must be in the server's{' '}
              <code className="login-code">SUPER_ADMIN_EMAILS</code> allowlist.
            </p>
          </div>

          <form
            className="login-form"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setErr(null)
              setLoading(true)
              try {
                await registerSuperAdmin({ email, password, name: name || undefined })
                nav('/platform')
              } catch (ex) {
                setErr((ex as Error).message)
              } finally {
                setLoading(false)
              }
            }}
          >
            <div className="login-field">
              <label className="login-label">Email <span className="login-label-hint">(allowlisted)</span></label>
              <input
                className="login-input"
                type="email"
                autoComplete="email"
                placeholder="admin@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="login-field">
              <label className="login-label">Password <span className="login-label-hint">(min 8)</span></label>
              <input
                className="login-input"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            <div className="login-field">
              <label className="login-label">Name <span className="login-label-hint">(optional)</span></label>
              <input
                className="login-input"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {err && (
              <div className="login-error-message">
                <span className="error-icon">⚠</span>
                <span>{err}</span>
              </div>
            )}

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Registering…
                </>
              ) : (
                'Register as super admin'
              )}
            </button>

            <div className="login-links">
              <p className="login-link-text">
                <Link to="/login" className="login-link-primary">Sign in</Link>
                {' · '}
                <Link to="/register" className="login-link-secondary">Tenant signup</Link>
              </p>
            </div>
          </form>

          <div className="login-footer">
            <p className="login-footer-text">© 2024 Loomrun. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
