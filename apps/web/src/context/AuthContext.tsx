import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch, clearTokens, refreshAccessToken, setTokens } from '../lib/api'

export type OrgSummary = {
  membership_id: string
  role: string
  organization: {
    id: string
    name: string
    slug: string
    plan: string
    suspended: boolean
    is_trial?: boolean
    trial_active?: boolean
    trial_expired?: boolean
    trial_ends_at?: string | null
    trial_days?: number
    days_left?: number | null
  }
}

export type Me = {
  id: string
  email: string
  name: string | null
  is_super_admin: boolean
  organizations: OrgSummary[]
}

type AuthState = {
  me: Me | null
  loading: boolean
  orgId: string | null
  setOrgId: (id: string | null) => void
  login: (email: string, password: string) => Promise<Me>
  register: (p: {
    email: string
    password: string
    name?: string
    organization_name: string
  }) => Promise<void>
  registerSuperAdmin: (p: { email: string; password: string; name?: string }) => Promise<void>
  logout: () => void
  reloadMe: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const ORG_KEY = 'loomrun_active_org'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgIdState] = useState<string | null>(() => localStorage.getItem(ORG_KEY))

  const setOrgId = useCallback((id: string | null) => {
    setOrgIdState(id)
    if (id) localStorage.setItem(ORG_KEY, id)
    else localStorage.removeItem(ORG_KEY)
  }, [])

  const reloadMe = useCallback(async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      setMe(null)
      setLoading(false)
      return
    }
    try {
      const m = await apiFetch<Me>('/v1/auth/me')
      setMe(m)
      const saved = localStorage.getItem(ORG_KEY)
      if (saved && m.organizations.some((o) => o.organization.id === saved)) {
        setOrgId(saved)
      } else if (m.organizations.length) {
        const first = m.organizations[0].organization.id
        setOrgId(first)
      } else {
        setOrgId(null)
      }
    } catch {
      const ok = await refreshAccessToken()
      if (ok) {
        const m = await apiFetch<Me>('/v1/auth/me')
        setMe(m)
        const saved = localStorage.getItem(ORG_KEY)
        if (saved && m.organizations.some((o) => o.organization.id === saved)) {
          setOrgId(saved)
        } else if (m.organizations.length) {
          setOrgId(m.organizations[0].organization.id)
        } else {
          setOrgId(null)
        }
      } else {
        setMe(null)
        clearTokens()
      }
    } finally {
      setLoading(false)
    }
  }, [setOrgId])

  useEffect(() => {
    void reloadMe()
  }, [reloadMe])

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiFetch<{ access_token: string; refresh_token: string }>('/v1/auth/login', {
        method: 'POST',
        json: { email, password },
      })
      setTokens(data.access_token, data.refresh_token)
      const m = await apiFetch<Me>('/v1/auth/me')
      setMe(m)
      if (m.organizations.length) setOrgId(m.organizations[0].organization.id)
      else setOrgId(null)
      return m
    },
    [setOrgId],
  )

  const register = useCallback(
    async (p: { email: string; password: string; name?: string; organization_name: string }) => {
      const data = await apiFetch<{ access_token: string; refresh_token: string }>('/v1/auth/register', {
        method: 'POST',
        json: p,
      })
      setTokens(data.access_token, data.refresh_token)
      const m = await apiFetch<Me>('/v1/auth/me')
      setMe(m)
      if (m.organizations.length) setOrgId(m.organizations[0].organization.id)
      else setOrgId(null)
    },
    [setOrgId],
  )

  const registerSuperAdmin = useCallback(
    async (p: { email: string; password: string; name?: string }) => {
      const data = await apiFetch<{ access_token: string; refresh_token: string }>(
        '/v1/auth/register-super-admin',
        {
          method: 'POST',
          json: p,
        },
      )
      setTokens(data.access_token, data.refresh_token)
      const m = await apiFetch<Me>('/v1/auth/me')
      setMe(m)
      setOrgId(null)
    },
    [setOrgId],
  )

  const logout = useCallback(() => {
    clearTokens()
    setMe(null)
    setOrgId(null)
  }, [setOrgId])

  const value = useMemo(
    () => ({
      me,
      loading,
      orgId,
      setOrgId,
      login,
      register,
      registerSuperAdmin,
      logout,
      reloadMe,
    }),
    [me, loading, orgId, setOrgId, login, register, registerSuperAdmin, logout, reloadMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
