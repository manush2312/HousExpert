import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileText, Image, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import LoadingButton from '../../components/LoadingButton'
import {
  analyzeFloorPlanQuotation,
  createQuotation,
  type FloorPlanAnalysisUploadResult,
  type QuotationItemInput,
  type QuotationSectionInput,
} from '../../services/quotationService'
import SizeTextInput from '../../components/SizeTextInput'
import { deriveSqft, deriveSqftString, parseSizeInches } from '../../utils/sizeFormat'
import { computeQuotationTotals } from '../../utils/quotationTotals'
import { listProducts, type Product } from '../../services/productService'

const ACCEPTED_FLOOR_PLAN_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
const MAX_FLOOR_PLAN_BYTES = 10 * 1024 * 1024

interface DraftItem {
  _id: string
  product_id?: string
  description: string
  size: string
  sqft: string
  qty: string
  use_quantity_rate: boolean
  rate: string
  note: string
  source?: 'product' | 'fallback' | 'manual'
}

interface DraftSection {
  _id: string
  room_name: string
  items: DraftItem[]
}

let draftUid = 0
const uid = () => `floor-plan-${++draftUid}`

const emptyDraftItem = (overrides?: Partial<DraftItem>): DraftItem => ({
  _id: uid(),
  description: '',
  size: '',
  sqft: '',
  qty: '1',
  use_quantity_rate: false,
  rate: '',
  note: '',
  ...overrides,
})

const emptyDraftSection = (roomName = ''): DraftSection => ({
  _id: uid(),
  room_name: roomName,
  items: [emptyDraftItem()],
})

export default function FloorPlanQuotationPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientLocation, setClientLocation] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<FloorPlanAnalysisUploadResult | null>(null)
  const [draftSections, setDraftSections] = useState<DraftSection[]>([])
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productCatalogWarning, setProductCatalogWarning] = useState('')

  const isImage = Boolean(file?.type.startsWith('image/'))
  const canUpload = Boolean(file && clientName.trim() && !uploading)
  const draftTotals = computeQuotationTotals(calcDraftTotal(draftSections), 0, false, 0)

  const fileLabel = useMemo(() => {
    if (!file) return 'PDF, PNG, JPG, or WEBP'
    return `${file.name} · ${formatBytes(file.size)}`
  }, [file])

  useEffect(() => {
    let active = true
    listProducts()
      .then((res) => {
        if (!active) return
        setProducts(res.data.data)
        setProductCatalogWarning('')
      })
      .catch(() => {
        if (!active) return
        setProducts([])
        setProductCatalogWarning('Products could not be loaded. Fallback draft items will be used.')
      })
      .finally(() => {
        if (active) setProductsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const selectFile = (next: File | null) => {
    setResult(null)
    setDraftSections([])
    setDraftError('')
    if (!next) {
      setFile(null)
      setError('')
      return
    }
    if (!ACCEPTED_FLOOR_PLAN_TYPES.includes(next.type)) {
      setFile(null)
      setError('Upload a PDF, PNG, JPG, or WEBP floor plan.')
      return
    }
    if (next.size > MAX_FLOOR_PLAN_BYTES) {
      setFile(null)
      setError('Floor plan file must be 10 MB or smaller.')
      return
    }
    setFile(next)
    setError('')
  }

  const handleUpload = async () => {
    if (!file || !clientName.trim() || uploading) return
    setUploading(true)
    setError('')
    setResult(null)
    setDraftSections([])
    setDraftError('')
    try {
      let productCatalog = products
      if (productsLoading) {
        try {
          const productRes = await listProducts()
          productCatalog = productRes.data.data
          setProducts(productCatalog)
          setProductCatalogWarning('')
        } catch {
          productCatalog = []
          setProductCatalogWarning('Products could not be loaded. Fallback draft items will be used.')
        } finally {
          setProductsLoading(false)
        }
      }

      const res = await analyzeFloorPlanQuotation({
        file,
        client_name: clientName.trim(),
        client_phone: clientPhone.trim() || undefined,
        client_location: clientLocation.trim() || undefined,
      })
      const analysis = res.data.data
      setResult(analysis)
      setDraftSections(buildDraftSectionsFromRooms(analysis.rooms, productCatalog))
    } catch (err) {
      setError(getApiError(err) || 'Failed to upload floor plan. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const updateDraftSection = (sectionId: string, patch: Partial<DraftSection>) =>
    setDraftSections((current) => current.map((section) => (
      section._id === sectionId ? { ...section, ...patch } : section
    )))

  const addDraftSection = () =>
    setDraftSections((current) => [...current, emptyDraftSection('Other')])

  const removeDraftSection = (sectionId: string) =>
    setDraftSections((current) => current.filter((section) => section._id !== sectionId))

  const updateDraftItem = (sectionId: string, itemId: string, patch: Partial<DraftItem>) =>
    setDraftSections((current) => current.map((section) => (
      section._id !== sectionId
        ? section
        : {
          ...section,
          items: section.items.map((item) => (item._id === itemId ? { ...item, ...patch } : item)),
        }
    )))

  const addDraftItem = (sectionId: string) =>
    setDraftSections((current) => current.map((section) => (
      section._id === sectionId ? { ...section, items: [...section.items, emptyDraftItem()] } : section
    )))

  const removeDraftItem = (sectionId: string, itemId: string) =>
    setDraftSections((current) => current.map((section) => (
      section._id === sectionId
        ? { ...section, items: section.items.filter((item) => item._id !== itemId) }
        : section
    )))

  const handleCreateDraft = async () => {
    if (!clientName.trim() || savingDraft) return
    const sections = toQuotationSections(draftSections)
    if (sections.length === 0 || sections.every((section) => section.items.length === 0)) {
      setDraftError('Add at least one quotation item before creating the draft.')
      return
    }

    setDraftError('')
    setSavingDraft(true)
    try {
      const res = await createQuotation({
        client_name: clientName.trim(),
        client_phone: clientPhone.trim() || undefined,
        client_location: clientLocation.trim() || undefined,
        sections,
        notes: 'Generated from floor plan room detection. Review sizes and rates before sending.',
      })
      navigate(`/quotations/${res.data.data.quotation_id}`)
    } catch (err) {
      setDraftError(getApiError(err) || 'Failed to create quotation draft. Please try again.')
    } finally {
      setSavingDraft(false)
    }
  }

  return (
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
      <div className="flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ink-3)' }}>
        <button onClick={() => navigate('/quotations')} className="hover:underline">Quotations</button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>Create from floor plan</span>
      </div>

      <div className="mb-1 eyebrow">AI draft</div>
      <h1 className="text-[26px] font-semibold tracking-tight mb-6" style={{ color: 'var(--ink)' }}>
        Create from floor plan
      </h1>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="card overflow-hidden">
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
                <FileText size={16} />
              </div>
              <div>
                <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Floor plan upload</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-4)' }}>{fileLabel}</div>
              </div>
            </div>
          </div>

          <div className="p-5">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
            />

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDrop={(event) => {
                event.preventDefault()
                selectFile(event.dataTransfer.files?.[0] ?? null)
              }}
              onDragOver={(event) => event.preventDefault()}
              className="w-full rounded-xl border border-dashed px-4 py-5 text-left transition-colors hover-bg"
              style={{ borderColor: 'var(--line)', background: 'var(--bg-sunken)' }}
            >
              {file ? (
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex min-h-44 flex-1 items-center justify-center overflow-hidden rounded-xl" style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-2)' }}>
                    {isImage && previewUrl ? (
                      <img src={previewUrl} alt="Selected floor plan preview" className="max-h-72 w-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-10" style={{ color: 'var(--ink-3)' }}>
                        <FileText size={28} />
                        <span className="text-[12px] font-medium">PDF selected</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 md:w-64">
                    <div className="flex items-start gap-2">
                      {isImage ? <Image size={15} style={{ color: 'var(--accent-ink)' }} /> : <FileText size={15} style={{ color: 'var(--accent-ink)' }} />}
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>{file.name}</div>
                        <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-4)' }}>{formatBytes(file.size)} · {file.type || 'unknown type'}</div>
                      </div>
                    </div>
                    <span className="mt-4 inline-flex text-[12px] font-medium" style={{ color: 'var(--accent-ink)' }}>Change file</span>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-56 flex-col items-center justify-center text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elev)', color: 'var(--ink-3)' }}>
                    <Upload size={18} />
                  </div>
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Upload floor plan</div>
                  <div className="mt-1 max-w-md text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    PDF, PNG, JPG, or WEBP up to 10 MB.
                  </div>
                </div>
              )}
            </button>

            {file && (
              <button
                type="button"
                onClick={() => selectFile(null)}
                className="mt-3 flex items-center gap-1.5 text-[12px] font-medium"
                style={{ color: 'var(--bad)' }}
              >
                <X size={13} />
                Remove file
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-[13.5px] font-semibold mb-4" style={{ color: 'var(--ink)' }}>Client details</h2>
            <div className="space-y-3">
              <Field label="Client name" required>
                <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" />
              </Field>
              <Field label="Phone number">
                <input className="input" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="Phone number" />
              </Field>
              <Field label="Location">
                <input className="input" value={clientLocation} onChange={(e) => setClientLocation(e.target.value)} placeholder="Site location" />
              </Field>
            </div>

            {error && (
              <p className="mt-4 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--bad-wash)', color: 'var(--bad-ink)' }}>
                {error}
              </p>
            )}
            {productCatalogWarning && (
              <p className="mt-4 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--warn-wash)', color: 'var(--warn-ink)' }}>
                {productCatalogWarning}
              </p>
            )}

            <div className="mt-5 flex flex-col items-stretch gap-2">
              <LoadingButton
                type="button"
                onClick={handleUpload}
                disabled={!canUpload}
                loading={uploading}
                loadingText="Analyzing..."
                className="btn btn-accent"
                leadingIcon={<Upload size={14} />}
              >
                Analyze floor plan
              </LoadingButton>
              <button type="button" onClick={() => navigate('/quotations')} className="btn btn-ghost">Cancel</button>
            </div>
          </div>

          {result && (
            <div className="card p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} style={{ color: 'var(--ok-ink)' }} />
                <div>
                  <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {result.status === 'analysis_completed' ? 'Analysis completed' : 'Upload accepted'}
                  </div>
                  <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-3)' }}>{result.message}</div>
                </div>
              </div>
              <div className="mt-4 space-y-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                <div>File · <strong style={{ color: 'var(--ink-2)' }}>{result.file.filename}</strong></div>
                <div>Type · <strong style={{ color: 'var(--ink-2)' }}>{result.file.content_type}</strong></div>
                <div>Size · <strong style={{ color: 'var(--ink-2)' }}>{formatBytes(result.file.size_bytes)}</strong></div>
                {result.analysis_image.converted && (
                  <div>Converted by · <strong style={{ color: 'var(--ink-2)' }}>{result.analysis_image.converter}</strong></div>
                )}
              </div>
              {result.analysis_image.data_url && (
                <div className="mt-4 overflow-hidden rounded-xl" style={{ border: '1px solid var(--line-2)', background: 'var(--bg-sunken)' }}>
                  <img src={result.analysis_image.data_url} alt="Converted first page preview" className="max-h-64 w-full object-contain" />
                </div>
              )}
              <div className="mt-5">
                <div className="text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>Detected rooms</div>
                {result.rooms.length > 0 ? (
                  <div className="mt-2 divide-y rounded-lg overflow-hidden" style={{ border: '1px solid var(--line-2)', borderColor: 'var(--line-2)' }}>
                    {result.rooms.map((room, index) => (
                      <div key={`${room.label}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ background: 'var(--bg-elev)', borderColor: 'var(--line-2)' }}>
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>{room.label}</div>
                          <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{formatRoomType(room.type)}</div>
                        </div>
                        <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: 'var(--accent-ink)' }}>
                          {formatConfidence(room.confidence)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                    No rooms detected.
                  </p>
                )}
              </div>
              {result.warnings.length > 0 && (
                <div className="mt-4 space-y-2">
                  {result.warnings.map((warning, index) => (
                    <div key={`${warning}-${index}`} className="flex gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--warn-wash)', color: 'var(--warn-ink)' }}>
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {result && draftSections.length > 0 && (
        <DraftQuotationEditor
          sections={draftSections}
          totals={draftTotals}
          saving={savingDraft}
          error={draftError}
          onAddSection={addDraftSection}
          onCreateDraft={handleCreateDraft}
          onUpdateSection={updateDraftSection}
          onRemoveSection={removeDraftSection}
          onAddItem={addDraftItem}
          onUpdateItem={updateDraftItem}
          onRemoveItem={removeDraftItem}
        />
      )}
    </div>
  )
}

interface DraftQuotationEditorProps {
  sections: DraftSection[]
  totals: { subtotal: number; total: number }
  saving: boolean
  error: string
  onAddSection: () => void
  onCreateDraft: () => void
  onUpdateSection: (sectionId: string, patch: Partial<DraftSection>) => void
  onRemoveSection: (sectionId: string) => void
  onAddItem: (sectionId: string) => void
  onUpdateItem: (sectionId: string, itemId: string, patch: Partial<DraftItem>) => void
  onRemoveItem: (sectionId: string, itemId: string) => void
}

function DraftQuotationEditor({
  sections,
  totals,
  saving,
  error,
  onAddSection,
  onCreateDraft,
  onUpdateSection,
  onRemoveSection,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: DraftQuotationEditorProps) {
  return (
    <div className="card mt-5 overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Quotation draft</div>
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-4)' }}>
            {sections.length} room section{sections.length === 1 ? '' : 's'} · {fmtINR(totals.subtotal)}
          </div>
        </div>
        <LoadingButton
          type="button"
          onClick={onCreateDraft}
          loading={saving}
          loadingText="Creating..."
          className="btn btn-accent"
          leadingIcon={<Save size={14} />}
        >
          Create quotation draft
        </LoadingButton>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--bad-wash)', color: 'var(--bad-ink)' }}>
          {error}
        </div>
      )}

      <div className="space-y-4 p-5">
        {sections.map((section) => (
          <DraftSectionBlock
            key={section._id}
            section={section}
            canRemove={sections.length > 1}
            onUpdateSection={(patch) => onUpdateSection(section._id, patch)}
            onRemoveSection={() => onRemoveSection(section._id)}
            onAddItem={() => onAddItem(section._id)}
            onUpdateItem={(itemId, patch) => onUpdateItem(section._id, itemId, patch)}
            onRemoveItem={(itemId) => onRemoveItem(section._id, itemId)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-sunken)' }}>
        <button type="button" onClick={onAddSection} className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
          <Plus size={14} />
          Add room section
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-right">
            <div className="text-[11px]" style={{ color: 'var(--ink-4)' }}>Draft total</div>
            <div className="text-[20px] font-semibold numeral" style={{ color: 'var(--ink)' }}>{fmtINR(totals.total)}</div>
          </div>
          <LoadingButton
            type="button"
            onClick={onCreateDraft}
            loading={saving}
            loadingText="Creating..."
            className="btn btn-accent"
            leadingIcon={<Save size={14} />}
          >
            Create quotation draft
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}

interface DraftSectionBlockProps {
  section: DraftSection
  canRemove: boolean
  onUpdateSection: (patch: Partial<DraftSection>) => void
  onRemoveSection: () => void
  onAddItem: () => void
  onUpdateItem: (itemId: string, patch: Partial<DraftItem>) => void
  onRemoveItem: (itemId: string) => void
}

function DraftSectionBlock({
  section,
  canRemove,
  onUpdateSection,
  onRemoveSection,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: DraftSectionBlockProps) {
  const total = section.items.reduce((sum, item) => sum + calcDraftRowAmount(item), 0)

  return (
    <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--line-2)' }}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" style={{ background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line-2)' }}>
        <input
          className="input flex-1"
          value={section.room_name}
          onChange={(event) => onUpdateSection({ room_name: event.target.value })}
          placeholder="Room / area"
        />
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="text-[13px] font-semibold numeral" style={{ color: 'var(--ink)' }}>{fmtINR(total)}</span>
          {canRemove && (
            <button type="button" onClick={onRemoveSection} className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--bad)' }} title="Remove room section">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--line-2)' }}>
        {section.items.map((item, index) => (
          <DraftItemRow
            key={item._id}
            item={item}
            index={index}
            canRemove={section.items.length > 1}
            onChange={(patch) => onUpdateItem(item._id, patch)}
            onRemove={() => onRemoveItem(item._id)}
          />
        ))}
      </div>

      <div className="px-4 py-3" style={{ background: 'var(--bg-sunken)' }}>
        <button type="button" onClick={onAddItem} className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--accent-ink)' }}>
          <Plus size={13} />
          Add item
        </button>
      </div>
    </div>
  )
}

interface DraftItemRowProps {
  item: DraftItem
  index: number
  canRemove: boolean
  onChange: (patch: Partial<DraftItem>) => void
  onRemove: () => void
}

function DraftItemRow({ item, index, canRemove, onChange, onRemove }: DraftItemRowProps) {
  const amount = calcDraftRowAmount(item)

  return (
    <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(180px,1.4fr)_110px_78px_72px_92px_108px_minmax(140px,1fr)_96px_32px] lg:items-center" style={{ background: 'var(--bg-elev)' }}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="numeral text-[11px] shrink-0" style={{ color: 'var(--ink-5)', minWidth: 18 }}>{index + 1}</span>
        <DraftField label="Item">
          <input
            className="input"
            value={item.description}
            onChange={(event) => onChange({ description: event.target.value, product_id: '', source: 'manual' })}
            placeholder="Description"
          />
          {item.product_id && (
            <span className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: 'var(--ok-wash)', color: 'var(--ok-ink)' }}>
              Product
            </span>
          )}
        </DraftField>
      </div>

      <DraftField label="Size">
        <SizeTextInput
          className="input"
          value={item.size}
          onChange={(nextSize) => onChange({ size: nextSize, sqft: deriveSqftString(nextSize, item.sqft) })}
          placeholder="84 X 84"
        />
      </DraftField>

      <DraftField label="Sq.Ft">
        <input
          className="input"
          value={deriveSqftString(item.size, item.sqft)}
          readOnly
          placeholder="-"
          style={{ background: parseSizeInches(item.size) ? 'var(--bg-sunken)' : undefined }}
        />
      </DraftField>

      <DraftField label="Qty">
        <input
          type="number"
          min="1"
          step="1"
          className="input"
          value={item.qty}
          onChange={(event) => onChange({ qty: String(Math.max(1, Number(event.target.value) || 1)) })}
        />
      </DraftField>

      <label className="flex h-[38px] items-center justify-between rounded-lg border px-3 text-[12px] lg:mt-[18px]" style={{ borderColor: 'var(--line-2)', background: item.use_quantity_rate ? 'var(--accent-wash)' : 'var(--bg-elev)', color: 'var(--ink-2)' }}>
        Qty x rate
        <input
          type="checkbox"
          checked={item.use_quantity_rate}
          onChange={(event) => onChange({ use_quantity_rate: event.target.checked })}
        />
      </label>

      <DraftField label="Rate">
        <input
          type="number"
          min="0"
          step="any"
          className="input"
          value={item.rate}
          onChange={(event) => onChange({ rate: event.target.value })}
          placeholder="0"
        />
      </DraftField>

      <DraftField label="Note">
        <input className="input" value={item.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="Optional" />
      </DraftField>

      <div className="flex items-center justify-between gap-3 lg:block lg:text-right">
        <span className="text-[11.5px] lg:hidden" style={{ color: 'var(--ink-4)' }}>Amount</span>
        <span className="numeral text-[13px] font-semibold" style={{ color: amount > 0 ? 'var(--ink)' : 'var(--ink-5)' }}>
          {amount > 0 ? fmtINR(amount) : '-'}
        </span>
      </div>

      <div className="flex justify-end">
        {canRemove && (
          <button type="button" onClick={onRemove} className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--bad)' }} title="Remove item">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function DraftField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="min-w-0 flex-1 space-y-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
      {children}
    </label>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
        {label}
        {required && <span className="ml-1" style={{ color: 'var(--bad)' }}>*</span>}
      </span>
      {children}
    </label>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRoomType(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatConfidence(confidence: number): string {
  const normalized = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0
  return `${Math.round(normalized * 100)}%`
}

interface StarterItemTemplate {
  description: string
  size: string
  rate: number
  keywords: string[]
  useQuantityRate?: boolean
}

function buildDraftSectionsFromRooms(rooms: FloorPlanAnalysisUploadResult['rooms'], products: Product[]): DraftSection[] {
  return rooms
    .filter((room) => room.label?.trim() || room.type?.trim())
    .map((room) => ({
      _id: uid(),
      room_name: room.label?.trim() || formatRoomType(room.type || 'other'),
      items: starterItemsForRoom(room.type, room.confidence, products),
    }))
}

function starterItemsForRoom(type: string, confidence: number, products: Product[]): DraftItem[] {
  const normalized = type.trim().toLowerCase()
  const note = confidence < 0.65 ? 'Verify room detection' : 'Floor plan starter'
  const usedProductIds = new Set<string>()

  return starterTemplatesForRoom(normalized).map((template) => {
    const matchedProduct = findProductForTemplate(products, template.keywords, usedProductIds)
    if (matchedProduct) {
      usedProductIds.add(matchedProduct.product_id)
      return starterItemFromProduct(matchedProduct, template, note)
    }
    return starterItem(template.description, template.size, template.rate, note, template.useQuantityRate)
  })
}

function starterTemplatesForRoom(normalizedType: string): StarterItemTemplate[] {
  switch (normalizedType) {
    case 'bedroom':
      return [
        starterTemplate('Wardrobe', '84 X 84', 1450, ['wardrobe', 'bedroom wardrobe', 'cupboard', 'closet']),
        starterTemplate('Bed', '72 X 78', 1800, ['bed', 'queen bed', 'king bed', 'storage bed']),
        starterTemplate('Side table', '18 X 24', 3500, ['side table', 'bedside table', 'night stand', 'nightstand'], true),
        starterTemplate('Dressing unit', '36 X 72', 1400, ['dressing', 'dressing unit', 'dresser', 'vanity dresser']),
      ]
    case 'kitchen':
      return [
        starterTemplate('Kitchen base cabinets', '120 X 30', 1600, ['kitchen base', 'base cabinet', 'base unit', 'kitchen cabinet']),
        starterTemplate('Kitchen wall cabinets', '120 X 24', 1450, ['kitchen wall', 'wall cabinet', 'overhead cabinet', 'overhead unit']),
      ]
    case 'hall':
    case 'living':
      return [
        starterTemplate('TV unit / wall panel', '96 X 30', 1350, ['tv unit', 'tv panel', 'media unit', 'entertainment unit']),
      ]
    case 'dining':
      return [
        starterTemplate('Crockery unit', '48 X 84', 1350, ['crockery', 'crockery unit', 'dining storage']),
      ]
    case 'pooja':
      return [
        starterTemplate('Pooja unit', '36 X 72', 1500, ['pooja', 'mandir', 'temple unit']),
      ]
    case 'study':
      return [
        starterTemplate('Study table and storage', '60 X 30', 1300, ['study table', 'study unit', 'desk', 'bookshelf']),
      ]
    case 'bathroom':
      return [
        starterTemplate('Vanity storage', '30 X 30', 1450, ['vanity', 'bathroom vanity', 'wash basin storage']),
      ]
    case 'balcony':
    case 'utility':
      return [
        starterTemplate('Utility storage', '36 X 72', 1250, ['utility storage', 'utility cabinet', 'loft storage']),
      ]
    case 'passage':
      return [
        starterTemplate('Shoe / passage storage', '36 X 42', 1250, ['shoe rack', 'shoe storage', 'passage storage']),
      ]
    default:
      return [
        starterTemplate('Interior allowance', '', 25000, ['interior allowance'], true),
      ]
  }
}

function starterTemplate(description: string, size: string, rate: number, keywords: string[], useQuantityRate = false): StarterItemTemplate {
  return { description, size, rate, keywords, useQuantityRate }
}

function starterItemFromProduct(product: Product, template: StarterItemTemplate, note: string): DraftItem {
  const size = product.default_size?.trim() || template.size
  return emptyDraftItem({
    product_id: product.product_id,
    description: product.name,
    size,
    sqft: deriveSqftString(size),
    qty: '1',
    use_quantity_rate: Boolean(template.useQuantityRate),
    rate: String(template.rate),
    note,
    source: 'product',
  })
}

function starterItem(description: string, size: string, rate: number, note: string, useQuantityRate = false): DraftItem {
  return emptyDraftItem({
    description,
    size,
    sqft: deriveSqftString(size),
    qty: '1',
    use_quantity_rate: useQuantityRate,
    rate: String(rate),
    note,
    source: 'fallback',
  })
}

function findProductForTemplate(products: Product[], keywords: string[], usedProductIds: Set<string>): Product | null {
  return products.find((product) => {
    if (!product.product_id || usedProductIds.has(product.product_id)) return false
    const normalizedName = normalizeSearchText(product.name)
    return keywords.some((keyword) => keywordMatchesProductName(keyword, normalizedName))
  }) ?? null
}

function keywordMatchesProductName(keyword: string, normalizedProductName: string): boolean {
  const keywordParts = normalizeSearchText(keyword).split(' ').filter(Boolean)
  if (keywordParts.length === 0) return false
  return keywordParts.every((part) => normalizedProductName.includes(part))
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toQuotationSections(sections: DraftSection[]): QuotationSectionInput[] {
  return sections
    .map((section) => {
      const items = section.items
        .filter((item) => item.description.trim())
        .map((item): QuotationItemInput => ({
          product_id: item.product_id || undefined,
          description: item.description.trim(),
          size: item.size.trim() || undefined,
          sqft: deriveSqft(item.size, item.sqft),
          qty: Number(item.qty) || 1,
          use_quantity_rate: item.use_quantity_rate,
          rate: Number(item.rate) || 0,
          note: item.note.trim() || undefined,
        }))

      return {
        room_name: section.room_name.trim(),
        items,
      }
    })
    .filter((section) => section.room_name && section.items.length > 0)
}

function calcDraftRowAmount(item: DraftItem): number {
  const qty = Number(item.qty) || 1
  const rate = Number(item.rate) || 0
  const sqft = deriveSqft(item.size, item.sqft)
  if (item.use_quantity_rate || sqft == null) return qty * rate
  return qty * sqft * rate
}

function calcDraftTotal(sections: DraftSection[]): number {
  return sections.reduce((sectionTotal, section) => (
    sectionTotal + section.items.reduce((itemTotal, item) => itemTotal + calcDraftRowAmount(item), 0)
  ), 0)
}

function fmtINR(value: number): string {
  return '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getApiError(err: unknown): string {
  if (typeof err === 'object' && err && 'response' in err) {
    const response = (err as { response?: { data?: { error?: string } } }).response
    return response?.data?.error ?? ''
  }
  return ''
}
