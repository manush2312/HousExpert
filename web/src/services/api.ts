import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE ?? '/api/v1'

// All API requests go to /api — Vite proxies this to http://localhost:8080 in dev.
// In production, set VITE_API_BASE in .env.
const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Where auth state lives in localStorage. Kept here so the auth service and the
// interceptor agree on the keys.
export const TOKEN_KEY = 'token'
export const REFRESH_TOKEN_KEY = 'refresh_token'
export const USER_KEY = 'auth_user'

function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

function redirectToLogin() {
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

// Attach the access token to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Silent token refresh ────────────────────────────────────────────────────
// When the short-lived access token expires the API returns 401. Instead of
// logging the user out, we transparently exchange the refresh token for a new
// access token and replay the failed request. Only if the refresh itself fails
// do we clear the session and bounce to /login.

// Single-flight: if several requests 401 at once, they all await one refresh
// call rather than firing a stampede of them.
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) throw new Error('no refresh token')

  // Use a bare axios call (not the `api` instance) so this request skips the
  // interceptors — no stale access-token header, no recursive refresh loop.
  const res = await axios.post(`${BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
  const data = res.data?.data
  if (!data?.access_token) throw new Error('malformed refresh response')

  // The backend rotates the refresh token on every use, so store the new pair.
  localStorage.setItem(TOKEN_KEY, data.access_token)
  if (data.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token)
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user))
  return data.access_token
}

// Retried requests are tagged so a second 401 doesn't loop forever.
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status
    const original = error.config as RetriableConfig | undefined
    const url = original?.url ?? ''
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh')

    // Only attempt a refresh for a genuine 401 on a normal request we haven't
    // already retried, and only when we actually have a refresh token.
    const canRefresh =
      status === 401 &&
      !isAuthCall &&
      original &&
      !original._retried &&
      Boolean(localStorage.getItem(REFRESH_TOKEN_KEY))

    if (canRefresh) {
      try {
        // Coalesce concurrent refreshes into one in-flight promise.
        refreshPromise = refreshPromise ?? refreshAccessToken()
        const newToken = await refreshPromise
        refreshPromise = null

        original._retried = true
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      } catch {
        refreshPromise = null
        clearSession()
        redirectToLogin()
        return Promise.reject(error)
      }
    }

    // 401 with no way to recover (refresh missing/expired) → end the session.
    if (status === 401 && !isAuthCall) {
      clearSession()
      redirectToLogin()
    }
    return Promise.reject(error)
  },
)

export default api
