import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isAuthenticated } from '../services/authService'

// RequireAuth guards protected routes. If there's no token, it redirects to
// /login and remembers where the user was headed so we can return them there.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}
