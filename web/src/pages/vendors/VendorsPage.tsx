import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Truck, X, Check, ChevronDown } from 'lucide-react'
import LoadingButton from '../../components/LoadingButton'
import {
  listVendors, createVendor, updateVendor, deleteVendor,
  type Vendor, type CreateVendorPayload,
} from '../../services/vendorService'
import { listLogTypes, listLogCategories } from '../../services/logService'
import { listInventoryItems } from '../../services/inventoryService'

// loadCategorySuggestions gathers the category names already in use across the
// app — the categories under each log type plus any inventory item categories —
// so the Suppliers form can suggest them. Deduped case-insensitively.
async function loadCategorySuggestions(): Promise<string[]> {
  const seen = new Map<string, string>() // lowercased → first-seen casing
  const add = (raw?: string) => {
    const v = (raw ?? '').trim()
    if (!v) return
    const key = v.toLowerCase()
    if (!seen.has(key)) seen.set(key, v)
  }
  try {
    const logTypesRes = await listLogTypes()
    const logTypes = logTypesRes.data.data ?? []
    const categoryLists = await Promise.all(
      logTypes.map((lt) => listLogCategories(lt.id).then((r) => r.data.data ?? []).catch(() => [])),
    )
    categoryLists.forEach((cats) => cats.forEach((c) => add(c.name)))
  } catch {
    // log types unavailable — fall through to inventory categories
  }
  try {
    const itemsRes = await listInventoryItems()
    ;(itemsRes.data.data ?? []).forEach((item) => add(item.category))
  } catch {
    // ignore
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// Pull a human-readable message out of an axios error, falling back to a default.
function errMessage(e: unknown, fallback: string): string {
  const resp = (e as { response?: { data?: { error?: string } } })?.response
  return resp?.data?.error || fallback
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetch = async () => {
    try {
      setLoading(true)
      const res = await listVendors()
      setVendors(res.data.data)
    } catch {
      // backend may not be running
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() }, [])
  useEffect(() => { loadCategorySuggestions().then(setCategorySuggestions).catch(() => {}) }, [])

  const handleDelete = async (vendorId: string, name: string) => {
    if (deletingId) return
    if (!confirm(`Delete supplier "${name}"? This cannot be undone.`)) return
    setDeletingId(vendorId)
    try {
      await deleteVendor(vendorId)
      await fetch()
    } catch (e) {
      alert(errMessage(e, 'Failed to delete supplier'))
    } finally {
      setDeletingId(null)
    }
  }

  const editing = vendors.find((v) => v.vendor_id === editingId) ?? null

  return (
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-7">
        <div>
          <div className="eyebrow mb-1">Master data</div>
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Suppliers
          </h1>
          <p className="text-[13.5px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
            Add each supplier once. They become dropdown choices across inventory and logging.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditingId(null) }}
          className="btn btn-accent w-full sm:w-auto sm:shrink-0"
        >
          <Plus size={15} />
          Add supplier
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <VendorForm
          mode="add"
          categorySuggestions={categorySuggestions}
          onSave={async (payload) => {
            await createVendor(payload)
            setShowAdd(false)
            fetch()
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* List */}
      {loading ? (
        <div className="card overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line-2)' }}>
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-4 w-24 ml-auto" />
            </div>
          ))}
        </div>
      ) : vendors.length === 0 && !showAdd ? (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
            <Truck size={22} />
          </div>
          <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>No suppliers yet</p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
            Add the suppliers you buy materials from — plywood, laminate, hardware, etc.
          </p>
          <button onClick={() => setShowAdd(true)} className="btn btn-accent mt-5">
            <Plus size={15} /> Add first supplier
          </button>
        </div>
      ) : vendors.length > 0 ? (
        <div className="card overflow-hidden">
          <div style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="flex items-center gap-4 px-5 py-2.5" style={{ background: 'var(--bg-sunken)' }}>
              <span className="eyebrow flex-1">Supplier</span>
              <span className="eyebrow hidden md:block w-40">Mobile</span>
              <span className="eyebrow hidden lg:block flex-1">Categories</span>
              <span className="eyebrow w-20">Status</span>
              <span className="w-16" />
            </div>
          </div>
          {vendors.map((v) => (
            <div key={v.vendor_id} style={{ borderBottom: '1px solid var(--line-2)' }}>
              {editingId === v.vendor_id ? (
                <VendorForm
                  mode="edit"
                  vendor={editing ?? v}
                  inline
                  categorySuggestions={categorySuggestions}
                  onSave={async (payload) => {
                    await updateVendor(v.vendor_id, payload)
                    setEditingId(null)
                    fetch()
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="group flex items-center gap-4 px-5 py-3.5">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
                      <Truck size={13} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium truncate" style={{ color: 'var(--ink)' }}>{v.name}</div>
                      {v.gstin && <div className="numeral text-[11px] truncate" style={{ color: 'var(--ink-4)' }}>{v.gstin}</div>}
                    </div>
                  </div>
                  <span className="numeral text-[12px] hidden md:block w-40" style={{ color: v.mobile ? 'var(--ink-3)' : 'var(--ink-5)' }}>
                    {v.mobile || '—'}
                  </span>
                  <div className="hidden lg:flex flex-wrap gap-1 flex-1 min-w-0">
                    {(v.categories_served ?? []).length === 0 ? (
                      <span className="text-[12px]" style={{ color: 'var(--ink-5)' }}>—</span>
                    ) : (
                      v.categories_served!.map((c) => (
                        <span key={c} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>{c}</span>
                      ))
                    )}
                  </div>
                  <span className="w-20">
                    <span
                      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
                      style={v.status === 'inactive'
                        ? { background: 'var(--bg-sunken)', color: 'var(--ink-4)' }
                        : { background: 'var(--ok-wash, var(--accent-wash))', color: 'var(--ok, var(--accent-ink))' }}
                    >
                      {v.status === 'inactive' ? 'Inactive' : 'Active'}
                    </span>
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity w-16 justify-end">
                    <button onClick={() => { setEditingId(v.vendor_id); setShowAdd(false) }} className="btn btn-ghost btn-sm btn-icon" title="Edit">
                      <Pencil size={12} />
                    </button>
                    <LoadingButton
                      onClick={() => handleDelete(v.vendor_id, v.name)}
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Delete"
                      style={{ color: 'var(--bad)' }}
                      loading={deletingId === v.vendor_id}
                      loadingText={null}
                      leadingIcon={<Trash2 size={12} />}
                      disabled={Boolean(deletingId)}
                      aria-label={`Delete ${v.name}`}
                    />
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

// ── Add / edit form ───────────────────────────────────────────────────────────

function VendorForm({ mode, vendor, inline, categorySuggestions, onSave, onCancel }: {
  mode: 'add' | 'edit'
  vendor?: Vendor
  inline?: boolean
  categorySuggestions: string[]
  onSave: (payload: CreateVendorPayload) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(vendor?.name ?? '')
  const [mobile, setMobile] = useState(vendor?.mobile ?? '')
  const [gstin, setGstin] = useState(vendor?.gstin ?? '')
  const [email, setEmail] = useState(vendor?.email ?? '')
  const [address, setAddress] = useState(vendor?.address ?? '')
  const [notes, setNotes] = useState(vendor?.notes ?? '')
  const [categories, setCategories] = useState<string[]>(vendor?.categories_served ?? [])
  const [status, setStatus] = useState(vendor?.status === 'inactive' ? 'inactive' : 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (saving) return
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        mobile: mobile.trim() || undefined,
        gstin: gstin.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        categories_served: categories,
        status,
      })
    } catch (e) {
      setError(errMessage(e, 'Failed to save supplier'))
    } finally {
      setSaving(false)
    }
  }

  const accent = inline ? 'var(--accent-ink)' : 'var(--ink-4)'

  return (
    <div className={inline ? 'px-5 py-4' : 'card mb-4 overflow-hidden'} style={inline ? { background: 'var(--accent-wash)' } : undefined}>
      {!inline && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-sunken)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
              <Truck size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>Add supplier</div>
              <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Reusable across inventory items and daily logs.</div>
            </div>
          </div>
          <button onClick={onCancel} className="btn btn-ghost btn-sm btn-icon shrink-0" title="Close">
            <X size={14} />
          </button>
        </div>
      )}

      <div className={inline ? '' : 'p-5'}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Supplier name" required>
            <input autoFocus className="input" placeholder="e.g. ABC Traders" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mobile">
            <input className="input" placeholder="10-digit number" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <input className="input" placeholder="Optional" value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" placeholder="Optional" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Address">
            <input className="input" placeholder="Optional" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Categories served" accent={accent}>
              <CategoryChips value={categories} onChange={setCategories} suggestions={categorySuggestions} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Notes" accent={accent}>
              <input className="input" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </div>

        {error && <p className="mt-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</p>}

        <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <LoadingButton
            onClick={handleSave}
            disabled={!name.trim()}
            loading={saving}
            loadingText="Saving..."
            className="btn btn-accent"
            leadingIcon={<Check size={13} />}
          >
            {mode === 'add' ? 'Save supplier' : 'Save'}
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, accent, children }: { label: string; required?: boolean; accent?: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: accent ?? 'var(--ink-4)' }}>
        {label}{required && <span style={{ color: 'var(--bad)' }}> *</span>}
      </span>
      {children}
    </label>
  )
}

// CategoryChips is an editable combobox for categories: it suggests categories
// already used across the app (from log types / inventory) in a dropdown, and
// still lets you type a brand-new one and press Enter to add it.
function CategoryChips({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const add = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    if (!value.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...value, trimmed])
    }
    setDraft('')
  }

  // Suggestions not already picked, filtered by what's typed.
  const selectedKeys = new Set(value.map((c) => c.toLowerCase()))
  const query = draft.trim().toLowerCase()
  const matches = suggestions
    .filter((s) => !selectedKeys.has(s.toLowerCase()))
    .filter((s) => !query || s.toLowerCase().includes(query))
  const exactExists = suggestions.some((s) => s.toLowerCase() === query) || selectedKeys.has(query)
  const showAddCustom = query.length > 0 && !exactExists

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <div
        className="input flex flex-wrap items-center gap-1.5"
        style={{ height: 'auto', minHeight: 38, paddingTop: 6, paddingBottom: 6 }}
        onClick={() => setOpen(true)}
      >
        {value.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 text-[12px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}>
            {c}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} style={{ color: 'var(--ink-4)' }} aria-label={`Remove ${c}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] bg-transparent outline-none text-[13px]"
          style={{ border: 'none', padding: 0, color: 'var(--ink)' }}
          placeholder={value.length ? 'Add another…' : 'Select or type a category…'}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
            else if (e.key === 'Escape') setOpen(false)
          }}
        />
        <ChevronDown size={14} style={{ color: 'var(--ink-4)', marginLeft: 'auto' }} />
      </div>

      {open && (matches.length > 0 || showAddCustom) && (
        <div
          className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-lg py-1"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}
        >
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full text-left px-3 py-1.5 text-[13px] transition-colors hover-bg"
              style={{ color: 'var(--ink-2)' }}
              onMouseDown={(e) => { e.preventDefault(); add(s) }}
            >
              {s}
            </button>
          ))}
          {showAddCustom && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-[13px] transition-colors hover-bg flex items-center gap-1.5"
              style={{ color: 'var(--accent-ink)' }}
              onMouseDown={(e) => { e.preventDefault(); add(draft) }}
            >
              <Plus size={12} /> Add "{draft.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}
