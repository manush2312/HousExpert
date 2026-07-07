import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { getStoredUser, type EmployeeRole } from '../services/authService'

// RequireRole guards a route to specific roles. It assumes RequireAuth has
// already ensured the user is logged in; here we only check the role. Users
// without permission are sent back to the app home rather than shown the page.
export default function RequireRole({
  allow,
  children,
}: {
  allow: EmployeeRole[]
  children: ReactNode
}) {
  const user = getStoredUser()
  if (!user || !allow.includes(user.role)) {
    return <Navigate to="/projects" replace />
  }
  return <>{children}</>
}
