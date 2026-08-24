const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

function getToken(): string | null {
  return localStorage.getItem('access_token')
}

function getRefreshToken(): string | null {
  return localStorage.getItem('refresh_token')
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem('access_token', access)
  localStorage.setItem('refresh_token', refresh)
}

export function clearTokens() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}

// Access tokens expire in ~60 min (see config.access_token_expire_minutes) but a session can
// stay open far longer than that, so any request can hit a live 401 mid-session. Concurrent
// 401s share one in-flight refresh instead of each racing their own (refresh tokens rotate,
// so a second call would invalidate the first's new token).
let refreshPromise: Promise<boolean> | null = null

export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = getRefreshToken()
      if (!refresh) return false
      try {
        const res = await fetch(`${base}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        })
        if (!res.ok) {
          clearTokens()
          return false
        }
        const data = (await res.json()) as { access_token: string; refresh_token: string }
        setTokens(data.access_token, data.refresh_token)
        return true
      } catch {
        return false
      }
    })()
  }
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

// Auth endpoints 401 for legitimate reasons (bad credentials, already-invalid refresh token) —
// never attempt a refresh-and-retry loop against them.
const NO_REFRESH_PREFIXES = ['/v1/auth/login', '/v1/auth/register', '/v1/auth/refresh']

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const body = options.json !== undefined ? JSON.stringify(options.json) : options.body
  const buildHeaders = () => {
    const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json')
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (options.json !== undefined) headers.set('Content-Type', 'application/json')
    return headers
  }

  let res = await fetch(`${base}${path}`, { ...options, headers: buildHeaders(), body })

  const canRefresh = getRefreshToken() && !NO_REFRESH_PREFIXES.some((p) => path.startsWith(p))
  if (res.status === 401 && canRefresh) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      res = await fetch(`${base}${path}`, { ...options, headers: buildHeaders(), body })
    }
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      const preview = text.replace(/\s+/g, ' ').slice(0, 80)
      if (res.status >= 500) {
        throw new Error('Server unavailable. Try again in a moment.')
      }
      throw new Error(`Unexpected response from server (${res.status}): ${preview}`)
    }
  }
  if (!res.ok) {
    if (res.status === 401) {
      clearTokens()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
    const msg = (data as { detail?: unknown })?.detail ?? res.statusText
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as T
}

// The chat endpoint streams the agent's reply as Server-Sent Events so text
// appears as it is written. `apiFetch` buffers the whole body, so streaming
// needs its own path — but it reuses the same token handling, including the
// one-shot refresh-and-retry on a 401.
export async function apiStream(
  path: string,
  options: { json?: unknown; signal?: AbortSignal } = {},
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const body = options.json !== undefined ? JSON.stringify(options.json) : undefined
  const buildHeaders = () => {
    const headers = new Headers()
    headers.set('Accept', 'text/event-stream')
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return headers
  }

  let res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: buildHeaders(),
    body,
    signal: options.signal,
  })

  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: buildHeaders(),
        body,
        signal: options.signal,
      })
    }
  }

  if (!res.ok || !res.body) {
    // The error arrives as a normal JSON body when the request fails before
    // the stream opens.
    const text = await res.text().catch(() => '')
    let detail = res.statusText
    try {
      const parsed = JSON.parse(text) as { detail?: unknown }
      if (typeof parsed.detail === 'string') detail = parsed.detail
    } catch {
      /* keep statusText */
    }
    if (res.status === 401) {
      clearTokens()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
    throw new Error(detail)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Frames are separated by a blank line; keep any partial tail for the
    // next chunk rather than parsing half an event.
    let split = buffer.indexOf('\n\n')
    while (split !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) {
        try {
          onEvent(JSON.parse(data) as Record<string, unknown>)
        } catch {
          /* ignore a frame we cannot parse rather than killing the stream */
        }
      }
      split = buffer.indexOf('\n\n')
    }
  }
}

// Multipart upload (Brain documents). Same auth handling, no JSON body.
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const buildHeaders = () => {
    const headers = new Headers()
    headers.set('Accept', 'application/json')
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    // Content-Type is deliberately unset so the browser adds the boundary.
    return headers
  }

  let res = await fetch(`${base}${path}`, { method: 'POST', headers: buildHeaders(), body: form })
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      res = await fetch(`${base}${path}`, { method: 'POST', headers: buildHeaders(), body: form })
    }
  }

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const msg = (data as { detail?: unknown })?.detail ?? res.statusText
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as T
}
