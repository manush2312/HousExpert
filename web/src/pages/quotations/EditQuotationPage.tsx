import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, GripVertical, FolderPlus, Save } from 'lucide-react'
import SearchableSelect from '../../components/SearchableSelect'
import SizeTextInput from '../../components/SizeTextInput'
import {
  getQuotation,
  updateQuotation,
  type Quotation,
  type QuotationSectionInput,
  type QuotationItemInput,
} from '../../services/quotationService'
import { listProducts, type Product } from '../../services/productService'
import { deriveSqft, deriveSqftString } from '../../utils/sizeFormat'

interface DraftItem {
  _id: string
  product_id?: string
  description: string
  size: string
  sqft: string
  qty: string
  rate: string
  note: string
}

interface DraftSection {
  _id: string
  room_name: string
  items: DraftItem[]
}

let _uid = 0
const uid = () => `edit-${++_uid}`

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
        .map((i): QuotationItemInput => ({
          product_id: i.product_id || undefined,
          description: i.description.trim(),
          size: i.size.trim() || undefined,
          sqft: deriveSqft(i.size, i.sqft),
          qty: Number(i.qty) || 1,
          rate: Number(i.rate) || 0,
          note: i.note.trim() || undefined,
        })),
    }))
}

function calcRowAmount(item: DraftItem): number {
  const sqft = deriveSqft(item.size, item.sqft) ?? 0
  const rate = Number(item.rate) || 0
  return sqft * rate
}

function calcTotal(sections: DraftSection[]): number {
  return sections.reduce((st, sec) => st + sec.items.reduce((it, item) => it + calcRowAmount(item), 0), 0)
}

function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function quotationToDraftSections(quotation: Quotation): DraftSection[] {
  if (quotation.sections.length === 0) return [emptySection('Bedroom')]

  return quotation.sections.map((section) => ({
    _id: section.section_id || uid(),
    room_name: section.room_name,
    items: section.items.length > 0
      ? section.items.map((item) => ({
        _id: item.item_id || uid(),
        product_id: item.product_id || '',
        description: item.description,
        size: item.size || '',
        sqft: deriveSqftString(item.size || '', item.sqft != null ? String(item.sqft) : ''),
        qty: String(item.qty || 1),
        rate: String(item.rate || ''),
        note: item.note || '',
      }))
      : [emptyItem()],
  }))
}

export default function EditQuotationPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [quotation, setQuotation] = useState<Quotation | null>(null)

  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientLocation, setClientLocation] = useState('')
  const [sections, setSections] = useState<DraftSection[]>([emptySection('Bedroom')])

  useEffect(() => {
    listProducts().then((r) => setProducts(r.data.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!id) return

    getQuotation(id)
      .then((res) => {
        const next = res.data.data
        if (next.status !== 'draft') {
          navigate(`/quotations/${id}`)
          return
        }
        setQuotation(next)
        setClientName(next.client_name)
        setClientPhone(next.client_phone ?? '')
        setClientLocation(next.client_location ?? '')
        setSections(quotationToDraftSections(next))
      })
      .catch(() => navigate('/quotations'))
      .finally(() => setLoading(false))
  }, [id, navigate])

  const updateSection = (sId: string, patch: Partial<DraftSection>) =>
    setSections((prev) => prev.map((s) => s._id === sId ? { ...s, ...patch } : s))

  const addSection = () =>
    setSections((prev) => [...prev, emptySection()])

  const removeSection = (sId: string) =>
    setSections((prev) => prev.filter((s) => s._id !== sId))

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !clientName.trim()) return
    setError('')
    setSaving(true)
    try {
      await updateQuotation(id, {
        client_name: clientName.trim(),
        client_phone: clientPhone.trim() || undefined,
        client_location: clientLocation.trim() || undefined,
        sections: toServicePayload(sections),
      })
      navigate(`/quotations/${id}`)
    } catch {
      setError('Failed to update quotation. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const grandTotal = calcTotal(sections)

  if (loading) {
    return (
      <div className="px-8 py-7 space-y-4">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-7 w-64" />
        <div className="skeleton h-40 w-full mt-4" />
      </div>
    )
  }

  if (!quotation) return null

  return (
    <div className="w-full px-8 py-7">
      <div className="flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ink-3)' }}>
        <button onClick={() => navigate('/quotations')} className="hover:underline">Quotations</button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <button onClick={() => navigate(`/quotations/${quotation.quotation_id}`)} className="hover:underline">
          {quotation.quotation_id}
        </button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>Edit</span>
      </div>

      <div className="eyebrow mb-1">Edit</div>
      <h1 className="text-[26px] font-semibold tracking-tight mb-6" style={{ color: 'var(--ink)' }}>
        {quotation.quotation_id}
      </h1>

      <form onSubmit={handleSave}>
        <div className="card p-5 mb-5">
          <h2 className="text-[13.5px] font-semibold mb-4" style={{ color: 'var(--ink)' }}>Client details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
                Client name <span style={{ color: 'var(--bad)' }}>*</span>
              </label>
              <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>Phone number</label>
              <input className="input" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>Location</label>
              <input className="input" value={clientLocation} onChange={(e) => setClientLocation(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {sections.map((sec) => (
            <SectionBlock
              key={sec._id}
              section={sec}
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

        <button
          type="button"
          onClick={addSection}
          className="mt-3 flex items-center gap-2 text-[12.5px] font-medium px-3 py-2 rounded-lg transition-colors hover-bg"
          style={{ color: 'var(--ink-3)', border: '1px dashed var(--line)' }}
        >
          <FolderPlus size={14} />
          Add room section
        </button>

        <div className="mt-6 card p-4 flex items-center justify-between gap-4">
          <div>
            {error && <p className="text-[12.5px] mb-2" style={{ color: 'var(--bad)' }}>{error}</p>}
            <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Grand total</div>
            <div className="text-[22px] font-semibold numeral" style={{ color: 'var(--ink)' }}>{fmtINR(grandTotal)}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(`/quotations/${quotation.quotation_id}`)} className="btn btn-ghost">Cancel</button>
            <button type="submit" disabled={!clientName.trim() || saving} className="btn btn-accent">
              <Save size={14} />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

interface SectionBlockProps {
  section: DraftSection
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
    <div
      className="group grid items-center px-4 py-1.5 gap-2 hover-bg transition-colors"
      style={{
        gridTemplateColumns: '2fr 80px 60px 60px 90px 1fr 90px 32px',
        borderBottom: '1px solid var(--line-2)',
        fontSize: 13,
      }}
    >
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

      <SizeTextInput
        className="input"
        style={{ fontSize: 12 }}
        placeholder="e.g. 102 X 12"
        value={item.size}
        onChange={(nextSize) => onChange({ size: nextSize, sqft: deriveSqftString(nextSize, item.sqft) })}
      />
      <input className="input" style={{ fontSize: 12 }} placeholder="—" value={deriveSqftString(item.size, item.sqft)} readOnly />
      <input type="number" className="input" style={{ fontSize: 12 }} min="0" step="1" value={item.qty} onChange={(e) => onChange({ qty: e.target.value })} />
      <input type="number" className="input" style={{ fontSize: 12 }} placeholder="0" min="0" value={item.rate} onChange={(e) => onChange({ rate: e.target.value })} />
      <input className="input" style={{ fontSize: 12 }} placeholder="Optional" value={item.note} onChange={(e) => onChange({ note: e.target.value })} />

      <div className="text-right numeral text-[12.5px] font-medium" style={{ color: amount > 0 ? 'var(--ink)' : 'var(--ink-5)' }}>
        {amount > 0 ? fmtINR(amount) : '—'}
      </div>

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
