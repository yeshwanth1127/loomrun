import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="login-card">
          {/* Header Section */}
          <div className="login-header">
            <div className="login-logo-wrapper">
              <div className="login-logo">L</div>
            </div>
            <h1 className="login-title">Welcome back</h1>
            <p className="login-subtitle">Sign in to manage your textile operations</p>
          </div>

          {/* Form Section */}
          <form
            className="login-form"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setErr(null)
              setLoading(true)
              try {
                await login(email, password)
                nav('/')
              } catch (ex) {
                setErr((ex as Error).message)
              } finally {
                setLoading(false)
              }
            }}
          >
            {/* Email Field */}
            <div className={`login-field ${focusedField === 'email' ? 'focused' : ''}`}>
              <label htmlFor="email" className="login-label">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                required
                className="login-input"
              />
            </div>

            {/* Password Field */}
            <div className={`login-field ${focusedField === 'password' ? 'focused' : ''}`}>
              <label htmlFor="password" className="login-label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                required
                className="login-input"
              />
            </div>

            {/* Error Message */}
            {err && (
              <div className="login-error-message">
                <span className="error-icon">⚠</span>
                <span>{err}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className={`login-button ${loading ? 'loading' : ''}`}
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

            {/* Divider */}
            <div className="login-divider">
              <span>or</span>
            </div>

            {/* Links Section */}
            <div className="login-links">
              <p className="login-link-text">
                No account? <Link to="/register" className="login-link-primary">Create workspace</Link>
              </p>
              <p className="login-link-text">
                <Link to="/register-super-admin" className="login-link-secondary">Register as Super Admin</Link>
              </p>
            </div>
          </form>

          {/* Footer */}
          <div className="login-footer">
            <p className="login-footer-text">© 2024 Loomrun. All rights reserved.</p>
          </div>
        </div>
      </div>

      {/* Background Decoration */}
      <div className="login-background">
        <div className="gradient-blob blob-1"></div>
        <div className="gradient-blob blob-2"></div>
      </div>
    </div>
  )
}
