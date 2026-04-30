import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Outlet, useNavigate, useLocation, NavLink } from 'react-router-dom'
import {
  Search, Layers, Plus, Sun, Moon, AlignJustify,
  Building2, ChevronRight, Folder, Package, FileText, Armchair,
} from 'lucide-react'
import { listProjects, type Project } from '../services/projectService'
import { listLogTypes, type LogType } from '../services/logService'

// ── Theme hook ────────────────────────────────────────────────────────────────

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('hx-theme')
    return (saved === 'dark' ? 'dark' : 'light')
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('hx-theme', theme)
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, toggle }
}

// ── Root layout ───────────────────────────────────────────────────────────────

export default function AppLayout() {
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hx-sidebar') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [logTypes, setLogTypes] = useState<LogType[]>([])

  useEffect(() => { localStorage.setItem('hx-sidebar', String(collapsed)) }, [collapsed])
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const handleToggleSidebar = () => {
    if (window.innerWidth < 1024) {
      setMobileOpen((m) => !m)
    } else {
      setCollapsed((c) => !c)
    }
  }

  // Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load data for sidebar + palette
  useEffect(() => {
    listProjects({ status: 'active', limit: 10 })
      .then((r) => setProjects(r.data.data.projects ?? []))
      .catch(() => {})
    listLogTypes()
      .then((r) => setLogTypes(r.data.data ?? []))
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        theme={theme}
        onToggleTheme={toggle}
        onOpenPalette={() => setPaletteOpen(true)}
        projects={projects}
        mobileOpen={mobileOpen}
      />
      <main className="flex-1 overflow-y-auto min-w-0">
        <Topbar collapsed={collapsed} onToggleSidebar={handleToggleSidebar} />
        <div className="animate-fade-up">
          <Outlet />
        </div>
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={projects}
        logTypes={logTypes}
      />
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean
  setCollapsed: (c: boolean | ((prev: boolean) => boolean)) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenPalette: () => void
  projects: Project[]
  mobileOpen: boolean
}

function Sidebar({ collapsed, theme, onToggleTheme, onOpenPalette, projects, mobileOpen }: SidebarProps) {
  const location = useLocation()

  const navItems = [
    { to: '/projects', label: 'Projects', Icon: Folder },
    { to: '/quotations', label: 'Quotations', Icon: FileText },
    { to: '/products', label: 'Products', Icon: Package },
    { to: '/furniture', label: 'Furniture Designer', Icon: Armchair },
    { to: '/log-types', label: 'Log Types', Icon: Layers },
  ]

  const pinnedProjects = projects.slice(0, 3)

  return (
    <aside
      className={`shrink-0 flex flex-col transition-all duration-200 fixed inset-y-0 left-0 lg:relative lg:inset-auto z-40 lg:z-auto ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      style={{
        width: collapsed ? 68 : 248,
        background: 'var(--bg-elev)',
        borderRight: '1px solid var(--line)',
      }}
    >
      {/* Brand */}
      <div
        className="h-14 px-3.5 flex items-center gap-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
          style={{ background: 'white', border: '1px solid var(--line-2)' }}
        >
          <img src="/logo.png" alt="HousExpert logo" className="w-full h-full object-contain" />
        </div>
        {!collapsed && (
          <div className="flex flex-col leading-none min-w-0">
            <span className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>HousExpert</span>
            <span className="text-[10.5px] mt-0.5" style={{ color: 'var(--ink-4)' }}>Site Operations</span>
          </div>
        )}
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="mx-3 mt-3">
          <button
            onClick={onOpenPalette}
            className="w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-[12.5px] transition-colors"
            style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)', color: 'var(--ink-3)' }}
          >
            <Search size={13} />
            <span>Search…</span>
            <span className="ml-auto flex items-center gap-0.5">
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
            </span>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pt-4 pb-3">
        <div className="space-y-0.5">
          {navItems.map(({ to, label, Icon }) => {
            const active = location.pathname.startsWith(to)
            return (
              <NavLink
                key={to}
                to={to}
                className="w-full flex items-center gap-2.5 px-2 h-8 rounded-md text-[13px] transition-colors"
                style={active
                  ? { background: 'var(--bg-sunken)', color: 'var(--ink)', fontWeight: 500 }
                  : { color: 'var(--ink-3)' }
                }
              >
                <Icon size={15} />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            )
          })}
        </div>

        {!collapsed && pinnedProjects.length > 0 && (
          <div className="mt-6">
            <div className="px-2 mb-1.5 eyebrow">Pinned</div>
            <div className="space-y-0.5">
              {pinnedProjects.map((p) => (
                <NavLink
                  key={p.project_id}
                  to={`/projects/${p.project_id}`}
                  className="w-full flex items-center gap-2 px-2 h-7 rounded-md text-[12.5px] transition-colors text-left hover-bg"
                  style={{ color: 'var(--ink-3)' }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: p.status === 'active' ? 'var(--ok)' : 'var(--ink-4)' }}
                  />
                  <span className="truncate">{p.name}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* User + theme */}
      <div className="p-2 shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-1.5 h-8 rounded-md flex-1 min-w-0">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--accent), oklch(0.6 0.2 300))' }}
            >
              AK
            </div>
            {!collapsed && (
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-[12px] font-medium truncate" style={{ color: 'var(--ink)' }}>Arvind Krishnan</span>
                <span className="text-[10.5px] truncate" style={{ color: 'var(--ink-4)' }}>Site Supervisor</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <button onClick={onToggleTheme} className="btn btn-ghost btn-sm btn-icon" title="Toggle theme">
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

// ── Topbar ────────────────────────────────────────────────────────────────────

function Topbar({ onToggleSidebar }: { collapsed: boolean; onToggleSidebar: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()

  // Build breadcrumb from path
  const crumbs = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean)
    const result: { label: string; to?: string }[] = []
    if (parts[0] === 'projects') {
      result.push({ label: 'Projects', to: '/projects' })
      if (parts[1] && parts[1] !== 'new') result.push({ label: parts[1], to: `/projects/${parts[1]}` })
      else if (parts[1] === 'new') result.push({ label: 'New project' })
      if (parts[2] === 'logs' && parts[3] === 'new') result.push({ label: 'New entry' })
    } else if (parts[0] === 'log-types') {
      result.push({ label: 'Log Types', to: '/log-types' })
      if (parts[1] === 'new') result.push({ label: 'New log type' })
      else if (parts[1]) result.push({ label: parts[1] })
    } else if (parts[0] === 'furniture') {
      result.push({ label: 'Furniture Designer', to: '/furniture' })
      if (parts[1] === 'new') result.push({ label: 'New design' })
      else if (parts[1]) result.push({ label: 'Edit design' })
    }
    return result
  }, [location.pathname])

  return (
    <div
      className="h-14 px-5 flex items-center gap-3 sticky top-0 z-20 shrink-0"
      style={{
        background: 'color-mix(in oklab, var(--bg) 88%, transparent)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <button onClick={onToggleSidebar} className="btn btn-ghost btn-sm btn-icon" title="Toggle sidebar">
        <AlignJustify size={14} />
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={11} style={{ color: 'var(--ink-4)' }} />}
            {c.to && i < crumbs.length - 1 ? (
              <button
                onClick={() => navigate(c.to!)}
                className="hover:underline transition-colors"
                style={{ color: 'var(--ink-3)' }}
              >
                {c.label}
              </button>
            ) : (
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{c.label}</span>
            )}
          </span>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>All systems operational</span>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ok)' }} />
      </div>
    </div>
  )
}

// ── Command Palette ───────────────────────────────────────────────────────────

interface PaletteProps {
  open: boolean
  onClose: () => void
  projects: Project[]
  logTypes: LogType[]
}

type PaletteItem = {
  section: string
  label: string
  hint?: string
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  action: () => void
  kbd?: string[]
}

function CommandPalette({ open, onClose, projects, logTypes }: PaletteProps) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        // toggle is handled by the parent
        window.dispatchEvent(new CustomEvent('open-palette'))
      }
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Listen for open event from sidebar
  useEffect(() => {
    const handler = () => {
      // Dispatched by search button in sidebar
    }
    window.addEventListener('open-palette', handler)
    return () => window.removeEventListener('open-palette', handler)
  }, [])

  useEffect(() => {
    if (open) {
      setQ('')
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [
      { section: 'Navigate', label: 'All projects', Icon: Folder, action: () => navigate('/projects') },
      { section: 'Navigate', label: 'All log types', Icon: Layers, action: () => navigate('/log-types') },
      { section: 'Actions', label: 'New project', Icon: Plus, action: () => navigate('/projects/new'), kbd: ['N', 'P'] },
      { section: 'Actions', label: 'New log type', Icon: Plus, action: () => navigate('/log-types/new'), kbd: ['N', 'T'] },
    ]
    projects.forEach((p) => out.push({
      section: 'Projects', label: p.name, hint: p.address.city,
      Icon: Building2, action: () => navigate(`/projects/${p.project_id}`),
    }))
    logTypes.forEach((lt) => out.push({
      section: 'Log types', label: lt.name, hint: `${lt.current_schema.length} fields`,
      Icon: Layers, action: () => navigate(`/log-types/${lt.id}`),
    }))
    return out
  }, [projects, logTypes, navigate])

  const filtered = useMemo(() =>
    q ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) : items,
    [items, q]
  )

  const grouped = filtered.reduce<Record<string, PaletteItem[]>>((m, it) => {
    (m[it.section] ??= []).push(it)
    return m
  }, {})

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
      <div
        className="absolute inset-0"
        style={{ background: 'color-mix(in oklab, var(--ink) 28%, transparent)' }}
        onClick={onClose}
      />
      <div
        className="relative card w-full max-w-xl overflow-hidden animate-fade-up"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-2.5 px-4 h-12"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <Search size={15} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects, log types, actions…"
            className="flex-1 bg-transparent outline-none text-[14px]"
            style={{ color: 'var(--ink)', border: 'none', padding: 0, fontFamily: 'inherit' }}
          />
          <button onClick={onClose} className="kbd" style={{ cursor: 'pointer' }}>Esc</button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
              No results for "{q}"
            </div>
          ) : (
            Object.entries(grouped).map(([section, arr]) => (
              <div key={section} className="py-1">
                <div className="px-4 pt-2 pb-1 eyebrow">{section}</div>
                {arr.map((it, i) => (
                  <button
                    key={i}
                    onClick={() => { it.action(); onClose() }}
                    className="w-full flex items-center gap-2.5 px-4 h-9 text-[13px] text-left transition-colors hover-bg"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    <it.Icon size={14} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                    <span style={{ color: 'var(--ink)' }}>{it.label}</span>
                    {it.hint && <span className="ml-auto text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{it.hint}</span>}
                    {it.kbd && (
                      <span className="ml-auto flex items-center gap-1">
                        {it.kbd.map((k) => <span key={k} className="kbd">{k}</span>)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
