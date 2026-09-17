import { motion } from 'framer-motion'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NoolrunWordmark } from '../components/react-bits/NoolrunWordmark'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { useAuth } from '../context/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  return (
    <div className="login-split">
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

      <div className="login-panel">
        <div className="login-panel-theme">
          <ThemeToggle />
        </div>
        <motion.div
          className="login-panel-inner"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="login-header">
            <h1 className="login-title">Sign in</h1>
            <p className="login-subtitle">Continue to your workspace</p>
          </div>

          <form
            className="login-form"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setErr(null)
              setLoading(true)
              try {
                const user = await login(email, password)
                nav(user.is_super_admin ? '/platform' : '/')
              } catch (ex) {
                setErr((ex as Error).message)
              } finally {
                setLoading(false)
              }
            }}
          >
            <div className="login-field">
              <label htmlFor="email" className="login-label">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="login-input"
              />
            </div>

            <div className="login-field">
              <label htmlFor="password" className="login-label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="login-input"
              />
            </div>

            {err && (
              <div className="login-error-message">
                <span className="error-icon">⚠</span>
                <span>{err}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="login-button"
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>

            <div className="login-divider">
              <span>or</span>
            </div>

            <div className="login-links">
              <p className="login-link-text">
                No account?{' '}
                <Link to="/register" className="login-link-primary">Create workspace</Link>
              </p>
              <p className="login-link-text">
                <Link to="/register-super-admin" className="login-link-secondary">
                  Register as Super Admin
                </Link>
              </p>
            </div>
          </form>

          <div className="login-footer">
            <p className="login-footer-text">© 2024 Loomrun. All rights reserved.</p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
