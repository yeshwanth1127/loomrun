import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">loomrun</div>
        <div className="auth-logo-sub">Textile Operations</div>
        <div className="auth-title">Create workspace</div>
        <div className="auth-sub">Set up your textile production hub</div>

        <form
          className="stack"
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
          <div className="form-field">
            <label className="input-label">Organization name *</label>
            <input className="input" placeholder="e.g. Fabblen Exports" value={organization_name} onChange={(e) => setOrgName(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div className="form-field">
            <label className="input-label">Email *</label>
            <input className="input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div className="form-field">
            <label className="input-label">Password * (min 8)</label>
            <input className="input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required style={{ width: '100%' }} />
          </div>
          <div className="form-field">
            <label className="input-label">Your name</label>
            <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
          </div>

          {err && <p className="error">{err}</p>}

          <button type="submit" className="btn" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Creating workspace…' : 'Create workspace'}
          </button>

          <p className="muted small" style={{ textAlign: 'center' }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
