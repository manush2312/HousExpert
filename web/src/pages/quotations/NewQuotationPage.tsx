import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, GripVertical, FolderPlus, Save, Copy } from 'lucide-react'
import { createQuotation, type QuotationSectionInput, type QuotationItemInput } from '../../services/quotationService'
import { listProducts, type Product } from '../../services/productService'
import LoadingButton from '../../components/LoadingButton'
import SearchableSelect from '../../components/SearchableSelect'
import SizeTextInput from '../../components/SizeTextInput'
import { deriveSqft, deriveSqftString, parseSizeInches } from '../../utils/sizeFormat'
import { computeQuotationTotals } from '../../utils/quotationTotals'

// ── Local draft types ─────────────────────────────────────────────────────────

interface DraftItem {
  _id: string          // local only, not sent to backend
  product_id?: string
  description: string
  size: string
  sqft: string         // string for input
  qty: string
  use_quantity_rate: boolean
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
  _id: uid(), product_id: '', description: '', size: '', sqft: '', qty: '1', use_quantity_rate: false, rate: '', note: '', ...overrides,
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
            use_quantity_rate: i.use_quantity_rate,
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
  if (item.use_quantity_rate || sqft == null) return qty * rate
  return qty * sqft * rate
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
  const [discountPercent, setDiscountPercent] = useState('')
  const [applyGST, setApplyGST] = useState(false)
  const [gstPercent, setGSTPercent] = useState('')

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

  const duplicateSection = (sId: string) =>
    setSections((prev) => {
      const idx = prev.findIndex((s) => s._id === sId)
      if (idx === -1) return prev
      const src = prev[idx]
      const baseName = src.room_name.replace(/\(\d+\)$/, '').trim()
      const names = new Set(prev.map((s) => s.room_name))
      let n = 1
      while (names.has(`${baseName}(${n})`)) n++
      const copy: DraftSection = {
        _id: uid(),
        room_name: `${baseName}(${n})`,
        items: src.items.map((item) => ({ ...item, _id: uid() })),
      }
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })

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
    if (saving) return
    if (!clientName.trim()) return
    const discountRate = Number(discountPercent) || 0
    const gstRate = Number(gstPercent) || 0
    if (discountRate < 0 || discountRate > 100) {
      setError('Enter a discount percentage between 0 and 100.')
      return
    }
    if (applyGST && gstRate <= 0) {
      setError('Enter a GST percentage greater than 0.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const res = await createQuotation({
        client_name: clientName.trim(),
        client_phone: clientPhone.trim() || undefined,
        client_location: clientLocation.trim() || undefined,
        sections: toServicePayload(sections),
        discount_percent: discountRate,
        apply_gst: applyGST,
        gst_percent: applyGST ? gstRate : 0,
      })
      navigate(`/quotations/${res.data.data.quotation_id}`)
    } catch {
      setError('Failed to create quotation. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const subtotal = calcTotal(sections)
  const discountRate = Number(discountPercent) || 0
  const gstRate = Number(gstPercent) || 0
  const totals = computeQuotationTotals(subtotal, discountRate, applyGST, gstRate)

  return (
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
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
              onDuplicateSection={() => duplicateSection(sec._id)}
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

        <div className="mt-5 card p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>Discount & tax</h2>
              <p className="text-[12.5px] mt-1" style={{ color: 'var(--ink-3)' }}>
                Discount is deducted before GST is calculated.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 rounded-xl px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--bg-sunken)' }}>
              <input
                type="checkbox"
                checked={applyGST}
                onChange={(e) => {
                  setApplyGST(e.target.checked)
                  if (!e.target.checked) setGSTPercent('')
                }}
              />
              <span className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>Apply GST</span>
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>Discount percentage</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className="input pr-8"
                  placeholder="e.g. 10"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: 'var(--ink-4)' }}>%</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>GST percentage</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input pr-8"
                  placeholder="e.g. 18"
                  value={gstPercent}
                  onChange={(e) => setGSTPercent(e.target.value)}
                  disabled={!applyGST}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: 'var(--ink-4)' }}>%</span>
              </div>
            </div>

            <div className="rounded-2xl px-4 py-3" style={{ border: '1px solid var(--line)', background: 'var(--bg-sunken)' }}>
              <div className="flex items-center justify-between text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                <span>Subtotal</span>
                <span className="numeral">{fmtINR(totals.subtotal)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12.5px]" style={{ color: discountRate > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                <span>Discount{discountRate > 0 ? ` (${discountRate}%)` : ''}</span>
                <span className="numeral">{discountRate > 0 ? `-${fmtINR(totals.discountAmount)}` : fmtINR(0)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                <span>Taxable amount</span>
                <span className="numeral">{fmtINR(totals.taxableAmount)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12.5px]" style={{ color: applyGST ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                <span>GST{applyGST && gstRate > 0 ? ` (${gstRate}%)` : ''}</span>
                <span className="numeral">{fmtINR(totals.gstAmount)}</span>
              </div>
              <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Grand total</span>
                <span className="text-[20px] font-semibold numeral" style={{ color: 'var(--ink)' }}>{fmtINR(totals.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer: total + actions ────────────────────────────────────────── */}
        <div className="mt-6 card p-4 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            {error && <p className="text-[12.5px] mb-2" style={{ color: 'var(--bad)' }}>{error}</p>}
            <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Final total</div>
            <div className="text-[22px] font-semibold numeral" style={{ color: 'var(--ink)' }}>{fmtINR(totals.total)}</div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={() => navigate('/quotations')} className="btn btn-ghost">Cancel</button>
            <LoadingButton
              type="submit"
              disabled={!clientName.trim()}
              loading={saving}
              loadingText="Saving..."
              className="btn btn-accent"
              leadingIcon={<Save size={14} />}
            >
              Save quotation
            </LoadingButton>
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
  onDuplicateSection: () => void
  onAddItem: () => void
  onUpdateItem: (iId: string, patch: Partial<DraftItem>) => void
  onRemoveItem: (iId: string) => void
  onApplyProduct: (iId: string, p: Product) => void
  canRemove: boolean
}

function SectionBlock({ section, products, onRoomNameChange, onRemoveSection, onDuplicateSection, onAddItem, onUpdateItem, onRemoveItem, onApplyProduct, canRemove }: SectionBlockProps) {
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
        <button type="button" onClick={onDuplicateSection} className="btn btn-ghost btn-sm btn-icon" title="Duplicate section" style={{ color: 'var(--ink-3)' }}>
          <Copy size={12} />
        </button>
        {canRemove && (
          <button type="button" onClick={onRemoveSection} className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--bad)' }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Column headers */}
      <div className="hidden items-center px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider gap-2 md:grid" style={{ color: 'var(--ink-4)', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line-2)', gridTemplateColumns: '2fr 80px 60px 60px 78px 90px 1fr 90px 32px' }}>
        <span>Product</span>
        <span>Size (inches)</span>
        <span>Sq.Ft</span>
        <span>Qty</span>
        <span>Qty x rate</span>
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

  return (
    <>
    <div className="border-b px-4 py-3 md:hidden" style={{ borderColor: 'var(--line-2)' }}>
        <div className="mb-3 flex items-start gap-2">
          <span className="numeral mt-2 text-[10.5px] shrink-0" style={{ color: 'var(--ink-5)', minWidth: 16 }}>{rowIndex + 1}</span>
          <div className="min-w-0 flex-1">
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
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="btn btn-ghost btn-sm btn-icon"
              style={{ color: 'var(--bad)' }}
              title="Delete item"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MobileField label="Size">
            <SizeTextInput
              className="input"
              style={{ fontSize: 12 }}
              placeholder="102 X 12"
              value={item.size}
              onChange={(nextSize) => onChange({ size: nextSize, sqft: deriveSqftString(nextSize, item.sqft) })}
            />
          </MobileField>
          <MobileField label="Sq.Ft">
            <input
              className="input"
              style={{ fontSize: 12, background: parseSizeInches(item.size) ? 'var(--bg-sunken)' : undefined }}
              placeholder="-"
              value={deriveSqftString(item.size, item.sqft)}
              readOnly
            />
          </MobileField>
          <MobileField label="Qty">
            <input
              type="number"
              className="input"
              style={{ fontSize: 12 }}
              min="1"
              step="1"
              value={item.qty}
              onChange={(e) => onChange({ qty: String(Math.max(1, Number(e.target.value) || 1)) })}
            />
          </MobileField>
          <MobileField label="Rate">
            <input
              type="number"
              className="input"
              style={{ fontSize: 12 }}
              placeholder="0"
              min="0"
              value={item.rate}
              onChange={(e) => onChange({ rate: e.target.value })}
            />
          </MobileField>
        </div>

        <div className="mt-2 grid gap-2">
          <label className="flex h-[38px] items-center justify-between rounded-lg border px-3 text-[12px]" style={{ borderColor: 'var(--line-2)', background: item.use_quantity_rate ? 'var(--accent-wash)' : 'var(--bg-elev)', color: 'var(--ink-2)' }}>
            Qty x rate only
            <input
              type="checkbox"
              aria-label="Use quantity x rate only"
              checked={item.use_quantity_rate}
              onChange={(e) => onChange({ use_quantity_rate: e.target.checked })}
            />
          </label>
          <input
            className="input"
            style={{ fontSize: 12 }}
            placeholder="Optional note"
            value={item.note}
            onChange={(e) => onChange({ note: e.target.value })}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>Amount</span>
          <span className="numeral text-[14px] font-semibold" style={{ color: amount > 0 ? 'var(--ink)' : 'var(--ink-5)' }}>
            {amount > 0 ? fmtINR(amount) : '-'}
          </span>
        </div>
    </div>

    <div
      className="group hidden items-center px-4 py-1.5 gap-2 hover-bg transition-colors md:grid"
      style={{
        gridTemplateColumns: '2fr 80px 60px 60px 78px 90px 1fr 90px 32px',
        borderBottom: '1px solid var(--line-2)',
        fontSize: 13,
      }}
    >
      {/* Product picker */}
      <div>
        <div className="flex items-start gap-1.5">
          <span className="numeral text-[10.5px] shrink-0" style={{ color: 'var(--ink-5)', minWidth: 16 }}>{rowIndex + 1}</span>
          <div className="flex-1 min-w-0 space-y-1.5">
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

      {/* Sqft — auto-computed from size */}
      <input
        className="input"
        style={{ fontSize: 12, background: parseSizeInches(item.size) ? 'var(--bg-sunken)' : undefined }}
        placeholder="—"
        value={deriveSqftString(item.size, item.sqft)}
        readOnly
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

      <label className="flex h-[38px] items-center justify-center rounded-lg border px-2" style={{ borderColor: 'var(--line-2)', background: item.use_quantity_rate ? 'var(--accent-wash)' : 'var(--bg-elev)' }} title="Use quantity x rate only for this row">
        <input
          type="checkbox"
          aria-label="Use quantity x rate only"
          checked={item.use_quantity_rate}
          onChange={(e) => onChange({ use_quantity_rate: e.target.checked })}
        />
      </label>

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
    </>
  )
}

function MobileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
      {children}
    </label>
  )
}
