import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, Download, Plus, Search, RotateCcw, ChevronRight } from 'lucide-react'
import { listLogTypes, archiveLogType, restoreLogType, type LogType } from '../../services/logService'

export default function LogTypesPage() {
  const navigate = useNavigate()
  const [types, setTypes] = useState<LogType[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  const fetch = async () => {
    try {
      const res = await listLogTypes({ include_archived: true })
      setTypes(res.data.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() }, [])

  const handleStatusAction = async (e: React.MouseEvent, logType: LogType) => {
    e.stopPropagation()
    if (logType.status === 'archived') {
      if (!confirm(`Restore log type "${logType.name}"? It will be available for logging again.`)) return
      await restoreLogType(logType.id)
    } else {
      if (!confirm(`Archive log type "${logType.name}"? Existing entries will not be affected.`)) return
      await archiveLogType(logType.id)
    }
    fetch()
  }

  const filtered = sortArchivedLogTypesLast(
    types.filter((lt) => !q || lt.name.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <div className="w-full px-8 py-7">
      {/* Page header */}
      <div className="flex items-start justify-between gap-6 mb-7">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight numeral" style={{ color: 'var(--ink)' }}>Log types</h1>
          <p className="text-[13.5px] mt-1.5 max-w-xl" style={{ color: 'var(--ink-3)' }}>
            Define what gets logged across all your projects. Each log type has its own schema of fields and a set of categories.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="btn btn-outline">
            <Download size={15} />
            Import template
          </button>
          <button onClick={() => navigate('/log-types/new')} className="btn btn-accent">
            <Plus size={15} />
            New log type
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="card px-3 py-2.5 mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--ink-4)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search log types…"
            className="input h-8"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="text-[11.5px] px-2" style={{ color: 'var(--ink-4)' }}>
          {filtered.length} of {types.length}
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-11 w-11 rounded-xl" />
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-3 w-56" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
            <Plus size={20} />
          </div>
          <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>
            {q ? 'No log types match' : 'No log types yet'}
          </p>
          <p className="text-[13px] mt-1 max-w-xs" style={{ color: 'var(--ink-3)' }}>
            {q ? 'Try a different search term.' : 'Create a log type like "Material" or "Labour" to start logging.'}
          </p>
          {!q && (
            <button onClick={() => navigate('/log-types/new')} className="btn btn-accent mt-5">
              <Plus size={15} /> New log type
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((lt) => (
            <LogTypeCard
              key={lt.id}
              logType={lt}
              onClick={() => navigate(`/log-types/${lt.id}`)}
              onStatusAction={(e) => handleStatusAction(e, lt)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Log Type Card ─────────────────────────────────────────────────────────────

function LogTypeCard({ logType: lt, onClick, onStatusAction }: { logType: LogType; onClick: () => void; onStatusAction: (e: React.MouseEvent) => void }) {
  const totalEntries = lt.categories?.reduce((s, c) => s + (c.entry_count ?? 0), 0) ?? lt.entry_count ?? 0

  return (
    <div
      onClick={onClick}
      className="group card p-5 cursor-pointer transition-all"
      style={{ boxShadow: 'var(--shadow-sm)' }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[16px]"
            style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}
          >
            📋
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>{lt.name}</h3>
              {lt.status === 'archived' && <span className="chip chip-bad">Archived</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
              <span>Schema v{lt.current_version}</span>
              <span className="dot" />
              <span>{lt.current_schema.length} fields</span>
              {lt.categories && (
                <>
                  <span className="dot" />
                  <span>{lt.categories.length} categories</span>
                </>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onStatusAction}
          className="btn btn-ghost btn-sm btn-icon opacity-0 group-hover:opacity-100 transition-opacity"
          title={lt.status === 'archived' ? 'Restore log type' : 'Archive log type'}
        >
          {lt.status === 'archived' ? <RotateCcw size={13} /> : <Archive size={13} />}
        </button>
      </div>

      {/* Schema preview chips */}
      {lt.current_schema.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {lt.current_schema.slice(0, 5).map((f) => (
            <span
              key={f.field_id}
              className="text-[10.5px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}
            >
              {f.label}
            </span>
          ))}
          {lt.current_schema.length > 5 && (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-4)' }}>
              +{lt.current_schema.length - 5}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--line-2)' }}>
        <div className="flex items-center gap-3 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          <span>
            <span className="numeral font-semibold" style={{ color: 'var(--ink)' }}>{totalEntries}</span> entries
          </span>
        </div>
        <span className="text-[11.5px] flex items-center gap-1 group-hover:underline" style={{ color: 'var(--ink-3)' }}>
          Manage <ChevronRight size={11} />
        </span>
      </div>
    </div>
  )
}

function sortArchivedLogTypesLast(types: LogType[]): LogType[] {
  return [...types].sort((a, b) => {
    const archivedDelta = Number(a.status === 'archived') - Number(b.status === 'archived')
    if (archivedDelta !== 0) return archivedDelta
    return a.name.localeCompare(b.name)
  })
}
