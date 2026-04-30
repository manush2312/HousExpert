import { useNavigate } from 'react-router-dom'
import { Plus, Armchair, Clock } from 'lucide-react'

const MOCK_DESIGNS = [
  { id: '1', name: 'Master Bedroom Wardrobe', type: 'Wardrobe', updatedAt: '2 hours ago', dimensions: '2400 × 2100 × 600 mm' },
  { id: '2', name: 'Living Room TV Unit', type: 'TV Unit', updatedAt: 'Yesterday', dimensions: '1800 × 500 × 450 mm' },
  { id: '3', name: 'Kitchen Base Cabinets', type: 'Cabinet', updatedAt: '3 days ago', dimensions: '3600 × 850 × 600 mm' },
]

export default function FurnitureListPage() {
  const navigate = useNavigate()

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Furniture Designer
          </h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-3)' }}>
            Design furniture, get automatic cut lists and measurements.
          </p>
        </div>
        <button
          onClick={() => navigate('/furniture/new')}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus size={15} />
          New Design
        </button>
      </div>

      {/* Designs grid */}
      {MOCK_DESIGNS.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MOCK_DESIGNS.map((d) => (
            <button
              key={d.id}
              onClick={() => navigate(`/furniture/${d.id}`)}
              className="card p-5 text-left transition-all hover:shadow-md group"
              style={{ border: '1px solid var(--line)' }}
            >
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                style={{ background: 'var(--bg-sunken)' }}
              >
                <Armchair size={20} style={{ color: 'var(--accent)' }} />
              </div>

              {/* Info */}
              <div className="text-[14px] font-medium mb-1" style={{ color: 'var(--ink)' }}>
                {d.name}
              </div>
              <div className="text-[12px] mb-3" style={{ color: 'var(--ink-3)' }}>
                {d.type} · {d.dimensions}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                <Clock size={11} />
                {d.updatedAt}
              </div>
            </button>
          ))}

          {/* New design card */}
          <button
            onClick={() => navigate('/furniture/new')}
            className="card p-5 text-left transition-all border-dashed flex flex-col items-center justify-center gap-2 min-h-[160px]"
            style={{ border: '2px dashed var(--line-2)', color: 'var(--ink-4)' }}
          >
            <Plus size={22} />
            <span className="text-[13px]">New Design</span>
          </button>
        </div>
      )}
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
