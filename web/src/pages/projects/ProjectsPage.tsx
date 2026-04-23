import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive,
  ArrowUpRight,
  Download,
  Folder,
  Grid3X3,
  List,
  MapPin,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react'
import SearchableSelect from '../../components/SearchableSelect'
import { archiveProject, listProjects, restoreProject, type Project } from '../../services/projectService'

type SortKey = 'updated' | 'progress' | 'budget' | 'az'
type ViewMode = 'grid' | 'table'
type Tone = 'accent' | 'ok' | 'warn'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'archived'>('active')
  const [cityFilter, setCityFilter] = useState('all')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<ViewMode>('grid')
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const res = await listProjects({ include_archived: true })
      setProjects(res.data.data.projects ?? [])
      setTotal(res.data.data.total ?? 0)
      setLastRefreshedAt(new Date())
    } catch {
      setProjects([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProjects() }, [])

  const cities = useMemo(
    () => ['all', ...Array.from(new Set(projects.map((p) => p.address.city))).sort((a, b) => a.localeCompare(b))],
    [projects],
  )

  useEffect(() => {
    if (cityFilter !== 'all' && !cities.includes(cityFilter)) setCityFilter('all')
  }, [cities, cityFilter])

  const filtered = useMemo(() => {
    let rows = projects.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (cityFilter !== 'all' && p.address.city !== cityFilter) return false
      if (q && !(p.name.toLowerCase().includes(q.toLowerCase()) || p.project_id.toLowerCase().includes(q.toLowerCase()))) return false
      return true
    })

    if (sort === 'updated') rows = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    if (sort === 'progress') rows = [...rows].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    if (sort === 'budget') rows = [...rows].sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0))
    if (sort === 'az') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name))

    return sortArchivedProjectsLast(rows)
  }, [projects, q, statusFilter, cityFilter, sort])

  const totals = useMemo(() => {
    const active = projects.filter((p) => p.status === 'active')
    const budget = active.reduce((sum, p) => sum + (p.budget ?? 0), 0)
    const spent = active.reduce((sum, p) => sum + (p.spent ?? 0), 0)
    const units = active.reduce((sum, p) => sum + (p.units ?? 0), 0)
    const avgProgress = active.length > 0
      ? active.reduce((sum, p) => sum + (p.progress ?? 0), 0) / active.length
      : 0

    return { active: active.length, budget, spent, units, avgProgress }
  }, [projects])

  const handleProjectAction = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()

    try {
      if (project.status === 'archived') {
        if (!confirm(`Restore "${project.name}"? It will become active again.`)) return
        await restoreProject(project.project_id)
      } else {
        if (!confirm(`Archive "${project.name}"? It will stay visible here with an archived tag.`)) return
        await archiveProject(project.project_id)
      }
      fetchProjects()
    } catch {
      alert(project.status === 'archived' ? 'Failed to restore project' : 'Failed to archive project')
    }
  }

  const cityCount = Math.max(cities.length - 1, 0)
  const refreshedLabel = lastRefreshedAt ? 'just now' : 'pending'

  return (
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-7">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight numeral" style={{ color: 'var(--ink)' }}>
            Projects
          </h1>
          <p className="text-[13.5px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
            {loading
              ? 'Loading projects…'
              : `${total} total, ${totals.active} active across ${cityCount} ${cityCount === 1 ? 'city' : 'cities'} - last refreshed ${refreshedLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="btn btn-outline">
            <Download size={15} />
            Export
          </button>
          <button onClick={() => navigate('/projects/new')} className="btn btn-accent">
            <Plus size={15} />
            New project
          </button>
        </div>
      </div>

      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
          <KpiCard
            label="Active projects"
            value={String(totals.active)}
            hint="+ refreshed from live backend"
            spark={[2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, Math.max(totals.active, 1)]}
          />
          <KpiCard
            label="Total budget"
            value={totals.budget > 0 ? fmtCr(totals.budget) : '—'}
            hint={totals.spent > 0 ? `${fmtCr(totals.spent)} committed` : 'across active projects'}
            spark={[40, 42, 44, 46, 48, 50, 52, 56, 60, 64, 68, Math.max(Math.round(totals.budget), 1)]}
            tone="ok"
          />
          <KpiCard
            label="Units under construction"
            value={totals.units > 0 ? fmtCount(totals.units) : '—'}
            hint="across towers and villas"
            spark={[180, 200, 220, 260, 280, 320, 360, 400, 440, 480, 520, Math.max(totals.units, 1)]}
            tone="warn"
          />
          <KpiCard
            label="Average progress"
            value={`${Math.round(totals.avgProgress * 100)}%`}
            hint="across active projects"
            spark={[12, 16, 18, 22, 24, 29, 32, 36, 41, 44, 48, Math.max(Math.round(totals.avgProgress * 100), 1)]}
          />
        </div>
      )}

      <div className="card px-3 py-2.5 mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--ink-4)' }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or project ID…"
            className="input h-8"
            style={{ paddingLeft: 32 }}
          />
        </div>

        <Segmented
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as typeof statusFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'On hold' },
            { value: 'archived', label: 'Archived' },
          ]}
        />

        <SearchableSelect
          value={cityFilter}
          onChange={setCityFilter}
          options={cities.map((city) => ({ value: city, label: city === 'all' ? 'All cities' : city }))}
          placeholder="All cities"
          searchPlaceholder="Search cities…"
          className="h-8"
          style={{ width: 160 }}
        />

        <SearchableSelect
          value={sort}
          onChange={(value) => setSort(value as SortKey)}
          options={[
            { value: 'updated', label: 'Last updated' },
            { value: 'progress', label: 'Progress' },
            { value: 'budget', label: 'Budget' },
            { value: 'az', label: 'Name A-Z' },
          ]}
          placeholder="Sort by"
          searchPlaceholder="Search sort options…"
          className="h-8"
          style={{ width: 170 }}
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{filtered.length} results</span>
          <Segmented
            value={view}
            onChange={(value) => setView(value as ViewMode)}
            iconOnly
            options={[
              { value: 'grid', label: 'Grid', icon: Grid3X3 },
              { value: 'table', label: 'Table', icon: List },
            ]}
          />
        </div>
      </div>

      {loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="skeleton h-3 w-28" />
                  <div className="skeleton h-3 w-3" />
                </div>
                <div className="skeleton h-8 w-24" />
                <div className="skeleton h-3 w-32" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="skeleton h-3 w-16" />
                  <div className="skeleton h-5 w-14 rounded-full" />
                </div>
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
                <div className="flex gap-1">
                  <div className="skeleton h-5 w-10 rounded-md" />
                  <div className="skeleton h-5 w-10 rounded-md" />
                </div>
                <div className="skeleton h-3 w-full mt-4" />
                <div className="skeleton h-2 w-full" />
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}
          >
            <Folder size={20} />
          </div>
          <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>
            No projects match your filters
          </p>
          <p className="mt-1 max-w-xs text-[13px]" style={{ color: 'var(--ink-3)' }}>
            Clear filters to see all projects, or start a new one.
          </p>
          <button onClick={() => navigate('/projects/new')} className="btn btn-accent mt-5">
            <Plus size={15} />
            New project
          </button>
        </div>
      )}

      {!loading && filtered.length > 0 && view === 'grid' && (
        <ProjectsGrid rows={filtered} onProjectAction={handleProjectAction} />
      )}

      {!loading && filtered.length > 0 && view === 'table' && (
        <ProjectsTable rows={filtered} onProjectAction={handleProjectAction} />
      )}
    </div>
  )
}

function KpiCard({ label, value, hint, spark, tone = 'accent' }: {
  label: string
  value: string
  hint: string
  spark: number[]
  tone?: Tone
}) {
  const sparkColor = { accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)' }[tone]

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <span className="eyebrow">{label}</span>
        <ArrowUpRight size={12} style={{ color: 'var(--ink-4)' }} />
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-[26px] font-semibold numeral leading-none" style={{ color: 'var(--ink)' }}>
            {value}
          </div>
          <div className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
            {hint}
          </div>
        </div>
        <div className="shrink-0">
          <Sparkbars data={spark} color={sparkColor} />
        </div>
      </div>
    </div>
  )
}

function Sparkbars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1)

  return (
    <svg width="58" height="28" viewBox="0 0 58 28" fill="none" aria-hidden="true">
      {data.slice(-12).map((value, index) => {
        const height = Math.max(2, Math.round((value / max) * 24))
        const x = index * 5
        const y = 28 - height
        return (
          <rect
            key={index}
            x={x}
            y={y}
            width="3"
            height={height}
            rx="1.5"
            fill={index === data.slice(-12).length - 1 ? color : `color-mix(in oklab, ${color} 42%, transparent)`}
          />
        )
      })}
    </svg>
  )
}

function Segmented({
  value,
  onChange,
  options,
  iconOnly = false,
}: {
  value: string
  onChange: (next: string) => void
  options: Array<{ value: string; label: string; icon?: typeof Grid3X3 }>
  iconOnly?: boolean
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg p-0.5"
      style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}
    >
      {options.map((option) => {
        const Icon = option.icon
        const active = value === option.value

        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={iconOnly
              ? 'flex h-6 w-7 items-center justify-center rounded-md transition-all'
              : 'rounded-md px-2.5 h-6 text-[11.5px] font-medium transition-all'}
            style={active
              ? { background: 'var(--bg-elev)', color: 'var(--ink)', boxShadow: 'var(--shadow-sm)' }
              : { color: 'var(--ink-3)' }}
            title={iconOnly ? option.label : undefined}
            aria-label={iconOnly ? option.label : undefined}
          >
            {Icon ? <Icon size={13} /> : option.label}
          </button>
        )
      })}
    </div>
  )
}

function ProjectsGrid({
  rows,
  onProjectAction,
}: {
  rows: Project[]
  onProjectAction: (e: React.MouseEvent, project: Project) => void
}) {
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((project) => (
        <div
          key={project.project_id}
          onClick={() => navigate(`/projects/${project.project_id}`)}
          className="group card cursor-pointer p-5 transition-all hover:-translate-y-0.5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
          onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
          onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="numeral text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
              {project.project_id}
            </span>
            <StatusPill status={project.status} />
          </div>

          <h3 className="truncate text-[15px] font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
            {project.name}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            <MapPin size={11} />
            <span className="truncate">
              {project.address.city}, {project.address.state}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-1">
            {project.bhk_configs.map((cfg) => (
              <span
                key={cfg.bhk_type}
                className="rounded px-1.5 py-0.5 text-[10.5px] font-medium"
                style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}
              >
                {cfg.bhk_type}
              </span>
            ))}
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span style={{ color: 'var(--ink-4)' }}>Progress</span>
              <span className="numeral font-medium" style={{ color: 'var(--ink-2)' }}>
                {Math.round((project.progress ?? 0) * 100)}%
              </span>
            </div>
            <Progress value={project.progress ?? 0} />
          </div>

          <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {(project.budget ?? 0) > 0 && (
                <span className="numeral" style={{ color: 'var(--ink-2)' }}>{fmtCr(project.budget ?? 0)}</span>
              )}
              {(project.budget ?? 0) > 0 && (project.units ?? 0) > 0 && <span className="dot" />}
              {(project.units ?? 0) > 0 && <span>{fmtCount(project.units ?? 0)} units</span>}
              {(project.budget ?? 0) <= 0 && (project.units ?? 0) <= 0 && <span>Metrics not set</span>}
            </div>
            <button
              onClick={(e) => onProjectAction(e, project)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: 'var(--ink-4)' }}
              title={project.status === 'archived' ? 'Restore project' : 'Archive project'}
            >
              {project.status === 'archived' ? <RotateCcw size={14} /> : <Archive size={14} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function ProjectsTable({
  rows,
  onProjectAction,
}: {
  rows: Project[]
  onProjectAction: (e: React.MouseEvent, project: Project) => void
}) {
  const navigate = useNavigate()

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-230 text-[13px]">
          <thead>
            <tr style={{ background: 'var(--bg-sunken)' }}>
              <Th>Project</Th>
              <Th>Location</Th>
              <Th>BHK mix</Th>
              <Th>Progress</Th>
              <Th align="right">Budget</Th>
              <Th align="right">Units</Th>
              <Th>Lead</Th>
              <Th>Status</Th>
              <Th align="right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((project) => (
              <tr
                key={project.project_id}
                onClick={() => navigate(`/projects/${project.project_id}`)}
                className="cursor-pointer transition-colors hover-bg"
                style={{ borderTop: '1px solid var(--line-2)' }}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium" style={{ color: 'var(--ink)' }}>{project.name}</div>
                  <div className="mt-0.5 text-[10.5px] numeral" style={{ color: 'var(--ink-4)' }}>{project.project_id}</div>
                </td>
                <td className="px-4 py-2.5" style={{ color: 'var(--ink-2)' }}>
                  {project.address.city}, {project.address.state.slice(0, 3).toUpperCase()}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {project.bhk_configs.map((cfg) => (
                      <span
                        key={cfg.bhk_type}
                        className="rounded px-1.5 py-0.5 text-[10.5px]"
                        style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}
                      >
                        {cfg.bhk_type}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex min-w-35 items-center gap-2">
                    <div className="flex-1 min-w-15">
                      <Progress value={project.progress ?? 0} />
                    </div>
                    <span className="w-8 text-right text-[11.5px] numeral" style={{ color: 'var(--ink-2)' }}>
                      {Math.round((project.progress ?? 0) * 100)}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right numeral" style={{ color: 'var(--ink-2)' }}>
                  {fmtCr(project.budget ?? 0)}
                </td>
                <td className="px-4 py-2.5 text-right numeral" style={{ color: 'var(--ink-3)' }}>
                  {fmtCount(project.units ?? 0)}
                </td>
                <td className="px-4 py-2.5" style={{ color: project.lead ? 'var(--ink-3)' : 'var(--ink-4)' }}>
                  {project.lead || '—'}
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill status={project.status} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={(e) => onProjectAction(e, project)}
                    style={{ color: 'var(--ink-4)' }}
                    title={project.status === 'archived' ? 'Restore project' : 'Archive project'}
                  >
                    {project.status === 'archived' ? <RotateCcw size={14} /> : <Archive size={14} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider"
      style={{ color: 'var(--ink-4)', textAlign: align }}
    >
      {children}
    </th>
  )
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { dot: string; bg: string; text: string; label: string }> = {
    active: { dot: 'var(--ok)', bg: 'var(--ok-wash)', text: 'var(--ok-ink)', label: 'Active' },
    inactive: { dot: 'var(--warn)', bg: 'var(--warn-wash)', text: 'var(--warn-ink)', label: 'On hold' },
    archived: { dot: 'var(--bad)', bg: 'var(--bad-wash)', text: 'var(--bad-ink)', label: 'Archived' },
  }
  const current = map[status] ?? map.active

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: current.bg, color: current.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: current.dot }} />
      {current.label}
    </span>
  )
}

function fmtCr(n: number): string {
  if (!n) return '—'
  return `₹${n % 1 === 0 ? n.toLocaleString('en-IN') : n.toFixed(2)}`
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-IN')
}

function sortArchivedProjectsLast(rows: Project[]): Project[] {
  return [...rows].sort((a, b) => {
    const archivedDelta = Number(a.status === 'archived') - Number(b.status === 'archived')
    if (archivedDelta !== 0) return archivedDelta
    return 0
  })
}
