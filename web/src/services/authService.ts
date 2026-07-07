import api, { TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from './api'

export type EmployeeRole = 'super_admin' | 'admin' | 'manager' | 'sales' | 'designer'

export interface AuthUser {
  id: string
  employee_id: string
  name: string
  email: string
  role: EmployeeRole
  status: 'active' | 'inactive'
}

interface AuthResult {
  access_token: string
  access_expires_at: string
  refresh_token: string
  refresh_expires_at: string
  user: AuthUser
}

// persistSession stores tokens + user so the session survives page reloads.
function persistSession(result: AuthResult) {
  localStorage.setItem(TOKEN_KEY, result.access_token)
  localStorage.setItem(REFRESH_TOKEN_KEY, result.refresh_token)
  localStorage.setItem(USER_KEY, JSON.stringify(result.user))
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await api.post<{ success: boolean; data: AuthResult }>('/auth/login', { email, password })
  persistSession(res.data.data)
  return res.data.data.user
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  try {
    if (refreshToken) await api.post('/auth/logout', { refresh_token: refreshToken })
  } catch {
    // Ignore network / already-revoked errors — we clear local state regardless.
  } finally {
    clearSession()
  }
}

export const getCurrentUser = () =>
  api.get<{ success: boolean; data: AuthUser }>('/auth/me')

export const registerUser = (payload: {
  name: string
  email: string
  password: string
  role?: EmployeeRole
  mobile?: string
  gender?: string
}) => api.post<{ success: boolean; data: AuthUser }>('/auth/register', payload)

export const forgotPassword = (email: string) =>
  api.post<{ success: boolean; data: { message: string; reset_token?: string } }>(
    '/auth/forgot-password',
    { email },
  )

export const resetPassword = (token: string, newPassword: string) =>
  api.post<{ success: boolean; data: { message: string } }>('/auth/reset-password', {
    token,
    new_password: newPassword,
  })

// ── Local session helpers ────────────────────────────────────────────────────

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function isAuthenticated(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY))
}
