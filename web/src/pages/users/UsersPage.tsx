import { useEffect, useState } from 'react'
import { UserPlus, KeyRound, Power, PowerOff } from 'lucide-react'
import Modal from '../../components/Modal'
import LoadingButton from '../../components/LoadingButton'
import { getStoredUser, type EmployeeRole } from '../../services/authService'
import {
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  type Employee,
} from '../../services/employeeService'

const ROLES: EmployeeRole[] = ['super_admin', 'admin', 'manager', 'sales', 'designer']
const ROLE_LABELS: Record<EmployeeRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Sales',
  designer: 'Designer',
}

function errMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function UsersPage() {
  const currentUser = getStoredUser()
  const [users, setUsers] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [resetFor, setResetFor] = useState<Employee | null>(null)

  const load = () => {
    setLoading(true)
    listUsers()
      .then((r) => setUsers(r.data.data ?? []))
      .catch((err) => setError(errMessage(err, 'Failed to load users')))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleRoleChange = async (user: Employee, role: EmployeeRole) => {
    setBusyId(user.id)
    try {
      const r = await updateUser(user.id, { role })
      setUsers((prev) => prev.map((u) => (u.id === user.id ? r.data.data : u)))
    } catch (err) {
      setError(errMessage(err, 'Failed to update role'))
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleStatus = async (user: Employee) => {
    const next = user.status === 'active' ? 'inactive' : 'active'
    setBusyId(user.id)
    try {
      const r = await updateUser(user.id, { status: next })
      setUsers((prev) => prev.map((u) => (u.id === user.id ? r.data.data : u)))
    } catch (err) {
      setError(errMessage(err, 'Failed to change status'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>Team</h1>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-4)' }}>Manage who can access HousExpert and what they can do.</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <UserPlus size={14} /> Add user
        </button>
      </div>

      {error && (
        <div className="text-[12.5px] rounded-lg px-3 py-2 mb-4"
          style={{ background: 'color-mix(in oklab, var(--danger, oklch(0.6 0.2 25)) 12%, transparent)', color: 'var(--danger, oklch(0.5 0.2 25))' }}>
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ color: 'var(--ink-2)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-4)' }} className="text-left text-[11.5px]">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last login</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center" style={{ color: 'var(--ink-4)' }}>Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center" style={{ color: 'var(--ink-4)' }}>No users yet.</td></tr>
              ) : (
                users.map((user) => {
                  const isSelf = user.id === currentUser?.id
                  const rowBusy = busyId === user.id
                  return (
                    <tr key={user.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                        {user.name}{isSelf && <span className="ml-1.5 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>(you)</span>}
                      </td>
                      <td className="px-4 py-2.5">{user.email}</td>
                      <td className="px-4 py-2.5">
                        <select
                          className="input"
                          style={{ padding: '3px 8px', fontSize: 12 }}
                          value={user.role}
                          disabled={rowBusy}
                          onChange={(e) => handleRoleChange(user, e.target.value as EmployeeRole)}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[12px]">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: user.status === 'active' ? 'var(--ok)' : 'var(--ink-4)' }} />
                          {user.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ink-3)' }}>{formatDate(user.last_login_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setResetFor(user)}
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Reset password"
                            disabled={rowBusy}
                          >
                            <KeyRound size={13} />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(user)}
                            className="btn btn-ghost btn-sm btn-icon"
                            title={isSelf ? "You can't deactivate yourself" : user.status === 'active' ? 'Deactivate' : 'Activate'}
                            disabled={rowBusy || isSelf}
                          >
                            {user.status === 'active' ? <PowerOff size={13} /> : <Power size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && (
        <AddUserModal
          onClose={() => setAddOpen(false)}
          onCreated={(u) => { setUsers((prev) => [u, ...prev]); setAddOpen(false) }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
        />
      )}
    </div>
  )
}

// ── Add user modal ──────────────────────────────────────────────────────────

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: Employee) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<EmployeeRole>('sales')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const r = await createUser({ name: name.trim(), email: email.trim(), password, role })
      onCreated(r.data.data)
    } catch (err) {
      setError(errMessage(err, 'Failed to create user'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} panelClassName="max-w-md">
      <div className="card p-6">
        <h2 className="text-[15px] font-semibold mb-4" style={{ color: 'var(--ink)' }}>Add user</h2>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name">
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Email">
            <input type="email" className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Starter password">
            <input type="text" className="input w-full" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ chars, letters and numbers" required />
          </Field>
          <Field label="Role">
            <select className="input w-full" value={role} onChange={(e) => setRole(e.target.value as EmployeeRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          {error && <div className="text-[12.5px]" style={{ color: 'var(--danger, oklch(0.5 0.2 25))' }}>{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
            <LoadingButton type="submit" className="btn btn-primary btn-sm" loading={saving} loadingText="Creating…">Create user</LoadingButton>
          </div>
        </form>
      </div>
    </Modal>
  )
}

// ── Reset password modal ────────────────────────────────────────────────────

function ResetPasswordModal({ user, onClose }: { user: Employee; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await resetUserPassword(user.id, password)
      setDone(true)
    } catch (err) {
      setError(errMessage(err, 'Failed to reset password'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} panelClassName="max-w-md">
      <div className="card p-6">
        <h2 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Reset password</h2>
        <p className="text-[12.5px] mb-4" style={{ color: 'var(--ink-4)' }}>
          Set a new password for <span style={{ color: 'var(--ink-2)' }}>{user.name}</span>. This signs them out of all sessions.
        </p>
        {done ? (
          <div className="space-y-4">
            <div className="text-[12.5px] rounded-lg px-3 py-2" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}>
              Password updated. Share the new password with {user.name} securely.
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="btn btn-primary btn-sm">Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="New password">
              <input type="text" className="input w-full" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ chars, letters and numbers" required autoFocus />
            </Field>
            {error && <div className="text-[12.5px]" style={{ color: 'var(--danger, oklch(0.5 0.2 25))' }}>{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
              <LoadingButton type="submit" className="btn btn-primary btn-sm" loading={saving} loadingText="Saving…">Set password</LoadingButton>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  )
}
