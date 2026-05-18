import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">loomrun</div>
        <div className="auth-logo-sub">Admin Setup</div>
        <div className="auth-title">Platform Admin</div>
        <div className="auth-sub">
          Create a super admin account. Your email must be in the server's{' '}
          <code className="mono">SUPER_ADMIN_EMAILS</code> setting.
        </div>

        <form
          className="stack"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault()
            setErr(null)
            setLoading(true)
            try {
              await registerSuperAdmin({ email, password, name: name || undefined })
              nav('/')
            } catch (ex) {
              setErr((ex as Error).message)
            } finally {
              setLoading(false)
            }
          }}
        >
          <div className="form-field">
            <label className="input-label">Email (allowlisted) *</label>
            <input className="input" type="email" autoComplete="email" placeholder="admin@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div className="form-field">
            <label className="input-label">Password * (min 8)</label>
            <input className="input" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required style={{ width: '100%' }} />
          </div>
          <div className="form-field">
            <label className="input-label">Name</label>
            <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
          </div>

          {err && <p className="error">{err}</p>}

          <button type="submit" className="btn" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Registering…' : 'Register as super admin'}
          </button>

          <p className="muted small" style={{ textAlign: 'center' }}>
            <Link to="/login">Sign in</Link>
            {' · '}
            <Link to="/register">Tenant signup</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
