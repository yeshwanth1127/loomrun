import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NoolrunWordmark } from '../components/react-bits/NoolrunWordmark'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { useAuth } from '../context/AuthContext'

export function RegisterPage() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [organization_name, setOrgName] = useState('')
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
          <p className="brand-tagline">
            Operations platform for garment manufacturers — from first enquiry to final dispatch.
          </p>
        </div>
      </div>

      {/* Right: Form panel */}
      <div className="login-panel">
        <div className="login-panel-theme">
          <ThemeToggle />
        </div>
        <div className="login-panel-inner">
          <div className="login-header">
            <h1 className="login-title">Book a walkthrough</h1>
            <p className="login-subtitle">Create a workspace. 14-day trial — no card required.</p>
          </div>

          <form
            className="login-form"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setErr(null)
              setLoading(true)
              try {
                await register({ email, password, name: name || undefined, organization_name })
                nav('/')
              } catch (ex) {
                setErr((ex as Error).message)
              } finally {
                setLoading(false)
              }
            }}
          >
            <div className="login-field">
              <label className="login-label">Organization name</label>
              <input
                className="login-input"
                placeholder="e.g. Fabblen Exports"
                value={organization_name}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </div>

            <div className="login-field">
              <label className="login-label">Email</label>
              <input
                className="login-input"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
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
              <label className="login-label">Your name <span className="login-label-hint">(optional)</span></label>
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
                  Creating workspace…
                </>
              ) : (
                'Create workspace'
              )}
            </button>

            <div className="login-links">
              <p className="login-link-text">
                Already have an account?{' '}
                <Link to="/login" className="login-link-primary">Sign in</Link>
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
