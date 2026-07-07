import api from './api'
import type { AuthUser, EmployeeRole } from './authService'

// A full employee record as returned by the admin user-management endpoints.
// (AuthUser is the lighter shape stored for the logged-in user.)
export interface Employee extends AuthUser {
  mobile?: string
  gender?: string
  last_login_at?: string
  created_at?: string
  updated_at?: string
}

export const listUsers = () =>
  api.get<{ success: boolean; data: Employee[] }>('/auth/users')

// Creating a user reuses the existing admin-only registration endpoint.
export const createUser = (payload: {
  name: string
  email: string
  password: string
  role: EmployeeRole
  mobile?: string
}) => api.post<{ success: boolean; data: Employee }>('/auth/register', payload)

export const updateUser = (
  id: string,
  payload: { name?: string; mobile?: string; role?: EmployeeRole; status?: 'active' | 'inactive' },
) => api.put<{ success: boolean; data: Employee }>(`/auth/users/${id}`, payload)

export const resetUserPassword = (id: string, newPassword: string) =>
  api.post<{ success: boolean; data: { message: string; user: Employee } }>(
    `/auth/users/${id}/reset-password`,
    { new_password: newPassword },
  )
