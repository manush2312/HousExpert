import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { login, isAuthenticated } from '../../services/authService'
import LoadingButton from '../../components/LoadingButton'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  // Already signed in? Skip the login screen.
  if (isAuthenticated()) {
    return <Navigate to="/projects" replace />
  }

  // Where to send the user after login — back to where they were headed, or projects.
  const from = (location.state as { from?: string })?.from ?? '/projects'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Unable to sign in. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100svh] items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="card w-full max-w-sm p-7" style={{ boxShadow: 'var(--shadow-lg)' }}>
        {/* Brand */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden mb-3"
            style={{ background: 'white', border: '1px solid var(--line-2)' }}
          >
            <img src="/logo.png" alt="HousExpert logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Sign in to HousExpert
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: 'var(--ink-4)' }}>
            Site Operations Portal
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Email</label>
            <input
              type="email"
              className="input input-lg w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@housexpert.com"
              autoComplete="email"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Password</label>
            <input
              type="password"
              className="input input-lg w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div
              className="text-[12.5px] rounded-lg px-3 py-2"
              style={{ background: 'color-mix(in oklab, var(--danger, oklch(0.6 0.2 25)) 12%, transparent)', color: 'var(--danger, oklch(0.5 0.2 25))' }}
            >
              {error}
            </div>
          )}

          <LoadingButton
            type="submit"
            className="btn btn-primary w-full justify-center"
            loading={loading}
            loadingText="Signing in…"
            leadingIcon={<LogIn size={14} />}
          >
            Sign in
          </LoadingButton>

          <div className="text-center pt-1">
            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              className="text-[12px] hover:underline"
              style={{ color: 'var(--ink-4)' }}
            >
              Forgot password?
            </button>
            {showForgot && (
              <p className="text-[12px] mt-2 rounded-lg px-3 py-2" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                Password resets are handled by an administrator. Please contact your
                admin, who can set a new password for you from the Team page.
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
