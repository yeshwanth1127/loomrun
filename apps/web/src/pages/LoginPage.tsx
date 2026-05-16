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

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">F</div>
        <div className="auth-title">Welcome back</div>
        <div className="auth-sub"></div>

        <form
          className="stack"
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
          <div className="form-field">
            <label className="input-label">Email</label>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-field">
            <label className="input-label">Password</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>

          {err && <p className="error">{err}</p>}

          <button type="submit" className="btn" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="muted small" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
            No account? <Link to="/register">Register workspace</Link>
            {' · '}
            <Link to="/register-super-admin">Super admin</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
