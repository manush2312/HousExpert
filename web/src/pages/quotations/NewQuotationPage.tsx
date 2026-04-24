import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, GripVertical, FolderPlus, Save } from 'lucide-react'
import { createQuotation, type QuotationSectionInput, type QuotationItemInput } from '../../services/quotationService'
import { listProducts, type Product } from '../../services/productService'
import SearchableSelect from '../../components/SearchableSelect'
import SizeTextInput from '../../components/SizeTextInput'
import { deriveSqft, deriveSqftString, parseSizeInches } from '../../utils/sizeFormat'

// ── Local draft types ─────────────────────────────────────────────────────────

interface DraftItem {
  _id: string          // local only, not sent to backend
  product_id?: string
  description: string
  size: string
  sqft: string         // string for input
  qty: string
  rate: string
  note: string
}

interface DraftSection {
  _id: string
  room_name: string
  items: DraftItem[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _uid = 0
const uid = () => String(++_uid)

const emptyItem = (overrides?: Partial<DraftItem>): DraftItem => ({
  _id: uid(), product_id: '', description: '', size: '', sqft: '', qty: '1', rate: '', note: '', ...overrides,
})

const emptySection = (roomName = ''): DraftSection => ({
  _id: uid(), room_name: roomName, items: [emptyItem()],
})

function toServicePayload(sections: DraftSection[]): QuotationSectionInput[] {
  return sections
    .filter((s) => s.room_name.trim())
    .map((s) => ({
      room_name: s.room_name.trim(),
      items: s.items
        .filter((i) => i.description.trim())
        .map((i): QuotationItemInput => {
          const computedSqft = deriveSqft(i.size, i.sqft)
          return {
          product_id: i.product_id || undefined,
          description: i.description.trim(),
          size: i.size.trim() || undefined,
          sqft: computedSqft,
          qty: Number(i.qty) || 1,
          rate: Number(i.rate) || 0,
          note: i.note.trim() || undefined,
          }
        }),
    }))
}

function calcRowAmount(item: DraftItem): number {
  const sqft = deriveSqft(item.size, item.sqft)
  const qty = Number(item.qty) || 1
  const rate = Number(item.rate) || 0
  // If sqft is available: qty × sqft × rate
  // Otherwise (no dimensions): qty × rate
  return sqft != null ? qty * sqft * rate : qty * rate
}

function calcTotal(sections: DraftSection[]): number {
  return sections.reduce((st, sec) => st + sec.items.reduce((it, item) => it + calcRowAmount(item), 0), 0)
}

function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewQuotationPage() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])

  // Client info
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientLocation, setClientLocation] = useState('')

  // Sections
  const [sections, setSections] = useState<DraftSection[]>([emptySection('Bedroom')])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listProducts().then((r) => setProducts(r.data.data)).catch(() => {})
  }, [])

  // ── Section ops ──────────────────────────────────────────────────────────────

  const updateSection = (sId: string, patch: Partial<DraftSection>) =>
    setSections((prev) => prev.map((s) => s._id === sId ? { ...s, ...patch } : s))

  const addSection = () =>
    setSections((prev) => [...prev, emptySection()])

  const removeSection = (sId: string) =>
    setSections((prev) => prev.filter((s) => s._id !== sId))

  // ── Item ops ─────────────────────────────────────────────────────────────────

  const updateItem = (sId: string, iId: string, patch: Partial<DraftItem>) =>
    setSections((prev) => prev.map((s) =>
      s._id !== sId ? s : { ...s, items: s.items.map((i) => i._id !== iId ? i : { ...i, ...patch }) }
    ))

  const addItem = (sId: string) =>
    setSections((prev) => prev.map((s) =>
      s._id !== sId ? s : { ...s, items: [...s.items, emptyItem()] }
    ))

  const removeItem = (sId: string, iId: string) =>
    setSections((prev) => prev.map((s) =>
      s._id !== sId ? s : { ...s, items: s.items.filter((i) => i._id !== iId) }
    ))

  const applyProduct = (sId: string, iId: string, product: Product) =>
    updateItem(sId, iId, {
      product_id: product.product_id,
      description: product.name,
      size: product.default_size ?? '',
      sqft: deriveSqftString(product.default_size ?? ''),
    })

  // ── Submit ────────────────────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientName.trim()) return
    setError('')
    setSaving(true)
    try {
      const res = await createQuotation({
        client_name: clientName.trim(),
        client_phone: clientPhone.trim() || undefined,
        client_location: clientLocation.trim() || undefined,
        sections: toServicePayload(sections),
      })
      navigate(`/quotations/${res.data.data.quotation_id}`)
    } catch {
      setError('Failed to create quotation. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const grandTotal = calcTotal(sections)

  return (
    <div className="w-full px-8 py-7">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ink-3)' }}>
        <button onClick={() => navigate('/quotations')} className="hover:underline">Quotations</button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>New quotation</span>
      </div>

      <div className="eyebrow mb-1">Create</div>
      <h1 className="text-[26px] font-semibold tracking-tight mb-6" style={{ color: 'var(--ink)' }}>New quotation</h1>

      <form onSubmit={handleSave}>
        {/* ── Client details ─────────────────────────────────────────────────── */}
        <div className="card p-5 mb-5">
          <h2 className="text-[13.5px] font-semibold mb-4" style={{ color: 'var(--ink)' }}>Client details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
                Client name <span style={{ color: 'var(--bad)' }}>*</span>
              </label>
              <input
                className="input"
                placeholder="e.g. Shilpa Mam"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>Phone number</label>
              <input
                className="input"
                placeholder="e.g. 9726957423"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>Location</label>
              <input
                className="input"
                placeholder="e.g. 4 BHK Adani, Ahmedabad"
                value={clientLocation}
                onChange={(e) => setClientLocation(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ── Line item sections ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {sections.map((sec, secIdx) => (
            <SectionBlock
              key={sec._id}
              section={sec}
              secIndex={secIdx}
              products={products}
              onRoomNameChange={(v) => updateSection(sec._id, { room_name: v })}
              onRemoveSection={() => removeSection(sec._id)}
              onAddItem={() => addItem(sec._id)}
              onUpdateItem={(iId, patch) => updateItem(sec._id, iId, patch)}
              onRemoveItem={(iId) => removeItem(sec._id, iId)}
              onApplyProduct={(iId, p) => applyProduct(sec._id, iId, p)}
              canRemove={sections.length > 1}
            />
          ))}
        </div>

        {/* Add section */}
        <button
          type="button"
          onClick={addSection}
          className="mt-3 flex items-center gap-2 text-[12.5px] font-medium px-3 py-2 rounded-lg transition-colors hover-bg"
          style={{ color: 'var(--ink-3)', border: '1px dashed var(--line)' }}
        >
          <FolderPlus size={14} />
          Add room section
        </button>

        {/* ── Footer: total + actions ────────────────────────────────────────── */}
        <div className="mt-6 card p-4 flex items-center justify-between gap-4">
          <div>
            {error && <p className="text-[12.5px] mb-2" style={{ color: 'var(--bad)' }}>{error}</p>}
            <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Grand total</div>
            <div className="text-[22px] font-semibold numeral" style={{ color: 'var(--ink)' }}>{fmtINR(grandTotal)}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/quotations')} className="btn btn-ghost">Cancel</button>
            <button type="submit" disabled={!clientName.trim() || saving} className="btn btn-accent">
              <Save size={14} />
              {saving ? 'Saving…' : 'Save quotation'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ── Section block ─────────────────────────────────────────────────────────────

interface SectionBlockProps {
  section: DraftSection
  secIndex: number
  products: Product[]
  onRoomNameChange: (v: string) => void
  onRemoveSection: () => void
  onAddItem: () => void
  onUpdateItem: (iId: string, patch: Partial<DraftItem>) => void
  onRemoveItem: (iId: string) => void
  onApplyProduct: (iId: string, p: Product) => void
  canRemove: boolean
}

function SectionBlock({ section, products, onRoomNameChange, onRemoveSection, onAddItem, onUpdateItem, onRemoveItem, onApplyProduct, canRemove }: SectionBlockProps) {
  const sectionTotal = section.items.reduce((s, i) => s + calcRowAmount(i), 0)

  return (
    <div className="card overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line)' }}>
        <GripVertical size={14} style={{ color: 'var(--ink-4)', cursor: 'grab' }} />
        <input
          className="flex-1 bg-transparent text-[13px] font-semibold outline-none"
          style={{ color: 'var(--ink)' }}
          placeholder="Room / area name (e.g. Bedroom)"
          value={section.room_name}
          onChange={(e) => onRoomNameChange(e.target.value)}
        />
        <span className="numeral text-[12px]" style={{ color: 'var(--ink-3)' }}>{fmtINR(sectionTotal)}</span>
        {canRemove && (
          <button type="button" onClick={onRemoveSection} className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--bad)' }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Column headers */}
      <div className="grid items-center px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider gap-2" style={{ color: 'var(--ink-4)', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line-2)', gridTemplateColumns: '2fr 80px 60px 60px 90px 1fr 90px 32px' }}>
        <span>Product</span>
        <span>Size (inches)</span>
        <span>Sq.Ft</span>
        <span>Qty</span>
        <span>Rate (₹)</span>
        <span>Note</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      {/* Rows */}
      {section.items.map((item, idx) => (
        <ItemRow
          key={item._id}
          item={item}
          rowIndex={idx}
          products={products}
          onChange={(patch) => onUpdateItem(item._id, patch)}
          onRemove={() => onRemoveItem(item._id)}
          onApplyProduct={(p) => onApplyProduct(item._id, p)}
          canRemove={section.items.length > 1}
        />
      ))}

      {/* Add item */}
      <div className="px-4 py-2" style={{ borderTop: '1px solid var(--line-2)' }}>
        <button
          type="button"
          onClick={onAddItem}
          className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
          style={{ color: 'var(--ink-4)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-4)')}
        >
          <Plus size={13} /> Add item
        </button>
      </div>
    </div>
  )
}

// ── Item row ──────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: DraftItem
  rowIndex: number
  products: Product[]
  onChange: (patch: Partial<DraftItem>) => void
  onRemove: () => void
  onApplyProduct: (p: Product) => void
  canRemove: boolean
}

function ItemRow({ item, rowIndex, products, onChange, onRemove, onApplyProduct, canRemove }: ItemRowProps) {
  const amount = calcRowAmount(item)

  const colStyle = 'gridTemplateColumns: 2fr 80px 60px 60px 90px 1fr 90px 32px'
  void colStyle

  return (
    <div
      className="group grid items-center px-4 py-1.5 gap-2 hover-bg transition-colors"
      style={{
        gridTemplateColumns: '2fr 80px 60px 60px 90px 1fr 90px 32px',
        borderBottom: '1px solid var(--line-2)',
        fontSize: 13,
      }}
    >
      {/* Product picker */}
      <div>
        <div className="flex items-center gap-1.5">
          <span className="numeral text-[10.5px] shrink-0" style={{ color: 'var(--ink-5)', minWidth: 16 }}>{rowIndex + 1}</span>
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={item.product_id ?? ''}
              onChange={(nextValue) => {
                const product = products.find((entry) => entry.product_id === nextValue)
                if (!product) {
                  onChange({ product_id: '', description: '', size: '' })
                  return
                }
                onApplyProduct(product)
              }}
              options={products.map((product) => ({
                value: product.product_id,
                label: product.name,
                keywords: product.default_size ? [product.default_size] : [],
              }))}
              placeholder="Pick product"
              searchPlaceholder="Search products…"
              emptyMessage="No products found"
              className="h-[38px]"
            />
          </div>
        </div>
      </div>

      {/* Size */}
      <SizeTextInput
        className="input"
        style={{ fontSize: 12 }}
        placeholder="e.g. 102 X 12"
        value={item.size}
        onChange={(nextSize) => onChange({ size: nextSize, sqft: deriveSqftString(nextSize, item.sqft) })}
      />

      {/* Sqft — auto-computed from size, or manually editable when no size */}
      <input
        className="input"
        style={{ fontSize: 12, background: parseSizeInches(item.size) ? 'var(--bg-sunken)' : undefined }}
        placeholder="—"
        value={deriveSqftString(item.size, item.sqft)}
        readOnly={!!parseSizeInches(item.size)}
        onChange={(e) => onChange({ sqft: e.target.value })}
      />

      {/* Qty */}
      <input
        type="number"
        className="input"
        style={{ fontSize: 12 }}
        min="1"
        step="1"
        value={item.qty}
        onChange={(e) => onChange({ qty: String(Math.max(1, Number(e.target.value) || 1)) })}
      />

      {/* Rate */}
      <input
        type="number"
        className="input"
        style={{ fontSize: 12 }}
        placeholder="0"
        min="0"
        value={item.rate}
        onChange={(e) => onChange({ rate: e.target.value })}
      />

      {/* Note */}
      <input
        className="input"
        style={{ fontSize: 12 }}
        placeholder="Optional"
        value={item.note}
        onChange={(e) => onChange({ note: e.target.value })}
      />

      {/* Amount */}
      <div className="text-right numeral text-[12.5px] font-medium" style={{ color: amount > 0 ? 'var(--ink)' : 'var(--ink-5)' }}>
        {amount > 0 ? fmtINR(amount) : '—'}
      </div>

      {/* Delete */}
      <div className="flex justify-center">
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="btn btn-ghost btn-sm btn-icon opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--bad)' }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
