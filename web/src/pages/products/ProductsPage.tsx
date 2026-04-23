import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Package, X, Check } from 'lucide-react'
import {
  listProducts, createProduct, updateProduct, deleteProduct,
  type Product,
} from '../../services/productService'

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const fetch = async () => {
    try {
      setLoading(true)
      const res = await listProducts()
      setProducts(res.data.data)
    } catch {
      // backend may not be running
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() }, [])

  const handleDelete = async (productId: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      await deleteProduct(productId)
      fetch()
    } catch {
      alert('Failed to delete product')
    }
  }

  return (
    <div className="w-full px-8 py-7">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 mb-7">
        <div>
          <div className="eyebrow mb-1">Catalog</div>
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Products
          </h1>
          <p className="text-[13.5px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
            Items your company offers — used as quick-fill in quotations.
          </p>
        </div>
        <button onClick={() => { setShowAdd(true); setEditingId(null) }} className="btn btn-accent shrink-0">
          <Plus size={15} />
          Add product
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <AddProductForm
          onSave={async (name, size) => {
            await createProduct({ name, default_size: size || undefined })
            setShowAdd(false)
            fetch()
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Product list */}
      {loading ? (
        <div className="card overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line-2)' }}>
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-4 w-24 ml-auto" />
            </div>
          ))}
        </div>
      ) : products.length === 0 && !showAdd ? (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
            <Package size={22} />
          </div>
          <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>No products yet</p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
            Add the items your company offers — beds, wardrobes, kitchens, etc.
          </p>
          <button onClick={() => setShowAdd(true)} className="btn btn-accent mt-5">
            <Plus size={15} /> Add first product
          </button>
        </div>
      ) : products.length > 0 ? (
        <div className="card overflow-hidden">
          <div style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="flex items-center gap-4 px-5 py-2.5" style={{ background: 'var(--bg-sunken)' }}>
              <span className="eyebrow flex-1">Product name</span>
              <span className="eyebrow w-36">Default size</span>
              <span className="w-16" />
            </div>
          </div>
          {products.map((p) => (
            <div key={p.product_id} style={{ borderBottom: '1px solid var(--line-2)' }}>
              {editingId === p.product_id ? (
                <EditProductRow
                  product={p}
                  onSave={async (name, size) => {
                    await updateProduct(p.product_id, { name, default_size: size || undefined })
                    setEditingId(null)
                    fetch()
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="group flex items-center gap-4 px-5 py-3.5">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
                      <Package size={13} />
                    </div>
                    <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--ink)' }}>{p.name}</span>
                  </div>
                  <span className="numeral text-[12px] w-36" style={{ color: p.default_size ? 'var(--ink-3)' : 'var(--ink-5)' }}>
                    {p.default_size || '—'}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity w-16 justify-end">
                    <button
                      onClick={() => setEditingId(p.product_id)}
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(p.product_id, p.name)}
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Delete"
                      style={{ color: 'var(--bad)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── Add form (card above the list) ────────────────────────────────────────────

function AddProductForm({ onSave, onCancel }: { onSave: (name: string, size: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [size, setSize] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim(), size.trim()) }
    finally { setSaving(false) }
  }

  return (
    <div className="card mb-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-sunken)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
            <Package size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>Add product</div>
            <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Create a reusable catalog item for quotations.</div>
          </div>
        </div>
        <button onClick={onCancel} className="btn btn-ghost btn-sm btn-icon shrink-0" title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(220px,0.8fr)]">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>
              Product name
            </span>
            <input
              autoFocus
              className="input"
              placeholder="Product name (e.g. Bed, Wardrobe)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>
              Default size
            </span>
            <input
              className="input"
              placeholder="e.g. 6x6.5"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!name.trim() || saving} className="btn btn-accent">
            <Check size={13} /> {saving ? 'Saving…' : 'Save product'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function EditProductRow({ product, onSave, onCancel }: {
  product: Product
  onSave: (name: string, size: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(product.name)
  const [size, setSize] = useState(product.default_size ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim(), size.trim()) }
    finally { setSaving(false) }
  }

  return (
    <div className="px-5 py-4" style={{ background: 'var(--accent-wash)' }}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.7fr)_auto] lg:items-end">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent)', color: 'white' }}>
            <Package size={13} />
          </div>
          <label className="space-y-1.5 flex-1 min-w-0">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--accent-ink)' }}>
              Product name
            </span>
            <input
              autoFocus
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </label>
        </div>

        <label className="space-y-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--accent-ink)' }}>
            Default size
          </span>
          <input
            className="input"
            placeholder="e.g. 6x6.5"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </label>

        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost" title="Cancel">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!name.trim() || saving} className="btn btn-accent" title="Save">
            <Check size={13} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
