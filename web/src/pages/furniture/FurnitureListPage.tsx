import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Armchair, Clock, Trash2, RefreshCw, AlertTriangle } from 'lucide-react'
import {
  deleteFurnitureDesign,
  listFurnitureDesigns,
  type FurnitureDesign,
  type FurnitureType,
} from '../../services/furnitureDesignService'

const FURNITURE_TYPE_LABELS: Record<FurnitureType, string> = {
  wardrobe: 'Wardrobe',
  cabinet: 'Cabinet',
  tv_unit: 'TV Unit',
  bookshelf: 'Bookshelf',
  kitchen_base: 'Kitchen Base',
}

export default function FurnitureListPage() {
  const navigate = useNavigate()
  const [designs, setDesigns] = useState<FurnitureDesign[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchDesigns = async () => {
    try {
      setLoading(true)
      setError('')
      const res = await listFurnitureDesigns({ limit: 100 })
      setDesigns(res.data.data.designs ?? [])
      setTotal(res.data.data.total ?? 0)
    } catch {
      setError('Failed to load furniture designs. Check that the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDesigns()
  }, [])

  const handleDelete = async (design: FurnitureDesign) => {
    if (deletingId || !confirm(`Delete "${design.name}"? This cannot be undone.`)) return
    setDeletingId(design.design_id)
    try {
      await deleteFurnitureDesign(design.design_id)
      setDesigns((prev) => prev.filter((item) => item.design_id !== design.design_id))
      setTotal((prev) => Math.max(0, prev - 1))
    } catch {
      alert('Failed to delete furniture design.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Furniture Designer
          </h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-3)' }}>
            {loading ? 'Loading saved designs...' : `${total} saved design${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => navigate('/furniture/new')}
          className="btn btn-primary flex items-center gap-2 shrink-0"
        >
          <Plus size={15} />
          New Design
        </button>
      </div>

      {error && (
        <div
          className="mb-4 rounded-md px-4 py-3 flex items-center gap-3"
          style={{ background: 'var(--bad-wash)', border: '1px solid var(--bad)', color: 'var(--bad-ink)' }}
        >
          <AlertTriangle size={16} />
          <div className="text-[13px] flex-1">{error}</div>
          <button onClick={fetchDesigns} className="btn btn-ghost btn-sm flex items-center gap-1.5">
            <RefreshCw size={13} />
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <LoadingGrid />
      ) : designs.length === 0 && !error ? (
        <EmptyState />
      ) : designs.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {designs.map((design) => (
            <DesignCard
              key={design.design_id}
              design={design}
              deleting={deletingId === design.design_id}
              onOpen={() => navigate(`/furniture/${design.design_id}`)}
              onDelete={() => handleDelete(design)}
            />
          ))}

          <button
            onClick={() => navigate('/furniture/new')}
            className="card p-5 text-left transition-all border-dashed flex flex-col items-center justify-center gap-2 min-h-[170px]"
            style={{ border: '2px dashed var(--line-2)', color: 'var(--ink-4)' }}
          >
            <Plus size={22} />
            <span className="text-[13px]">New Design</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function DesignCard({
  design,
  deleting,
  onOpen,
  onDelete,
}: {
  design: FurnitureDesign
  deleting: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
      className="card p-5 text-left transition-all hover:shadow-md group cursor-pointer"
      style={{ border: '1px solid var(--line)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-sunken)' }}
        >
          <Armchair size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          disabled={deleting}
          className="btn btn-ghost btn-sm btn-icon opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: 'var(--bad)', opacity: deleting ? 0.6 : undefined }}
          title="Delete design"
          aria-label="Delete design"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="text-[14px] font-medium mb-1 truncate" style={{ color: 'var(--ink)' }}>
        {design.name}
      </div>
      <div className="text-[12px] mb-3" style={{ color: 'var(--ink-3)' }}>
        {FURNITURE_TYPE_LABELS[design.furniture_type] ?? 'Furniture'} · {formatDimensions(design)}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
          <Clock size={11} />
          {deleting ? 'Deleting...' : formatUpdatedAt(design.updated_at)}
        </div>
        <span className="text-[10.5px] numeral" style={{ color: 'var(--ink-5)' }}>
          {design.design_id}
        </span>
      </div>
    </div>
  )
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, index) => (
        <div key={index} className="card p-5" style={{ border: '1px solid var(--line)' }}>
          <div className="skeleton w-10 h-10 rounded-lg mb-4" />
          <div className="skeleton h-4 w-36 mb-2" />
          <div className="skeleton h-3 w-44 mb-4" />
          <div className="skeleton h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'var(--bg-sunken)' }}
      >
        <Armchair size={28} style={{ color: 'var(--ink-3)' }} />
      </div>
      <div className="text-[16px] font-medium mb-2" style={{ color: 'var(--ink)' }}>
        No designs yet
      </div>
      <div className="text-[13.5px] mb-6 max-w-xs" style={{ color: 'var(--ink-3)' }}>
        Start by creating your first furniture design. Draw wardrobes, cabinets, and more in 3D.
      </div>
      <button
        onClick={() => navigate('/furniture/new')}
        className="btn btn-primary flex items-center gap-2"
      >
        <Plus size={15} />
        Create first design
      </button>
    </div>
  )
}

function formatDimensions(design: FurnitureDesign): string {
  if (!design.outer_box) return 'No box yet'
  return `${design.outer_box.width} x ${design.outer_box.height} x ${design.outer_box.depth} mm`
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Updated recently'

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
  if (diffMinutes < 1) return 'Updated just now'
  if (diffMinutes < 60) return `Updated ${diffMinutes} min ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `Updated ${diffHours} hr ago`

  return `Updated ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}
