import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Info } from 'lucide-react'
import DatePicker from '../../components/DatePicker'
import SearchableSelect from '../../components/SearchableSelect'
import {
  listLogTypes, listLogCategories, listLogItems, createLogEntry,
  type LogType, type LogCategory, type LogItem, type SchemaField, type FieldValue, type LogCostMode,
} from '../../services/logService'
import { getProject, type Project } from '../../services/projectService'

export default function NewLogEntryPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [logTypes, setLogTypes] = useState<LogType[]>([])
  const [categories, setCategories] = useState<LogCategory[]>([])
  const [items, setItems] = useState<LogItem[]>([])

  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [selectedCatId, setSelectedCatId] = useState('')
  const [selectedItemId, setSelectedItemId] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedType = logTypes.find((t) => t.id === selectedTypeId)
  const itemSchema = getItemSchema(selectedType)
  const entrySchema = getEntrySchema(selectedType)
  const costMode = getEffectiveCostMode(selectedType)
  const selectedItem = items.find((item) => item.id === selectedItemId)
  const quantityVisible = costMode === 'quantity_x_unit_cost'
  const quantityRequired = quantityVisible && isQuantityRequired(entrySchema, selectedItem?.fields ?? [])
  const parsedQuantity = parseOptionalNumber(quantity)
  const totalCost = parsedQuantity != null
    ? computeTotalCost(costMode, entrySchema, selectedItem?.fields ?? [], fieldValues, parsedQuantity)
    : computeTotalCost(costMode, entrySchema, selectedItem?.fields ?? [], fieldValues, null)
  const visibleEntryFields = getVisibleEntryFields(entrySchema, costMode)

  useEffect(() => {
    if (!projectId) return
    Promise.all([
      getProject(projectId).then((r) => setProject(r.data.data)),
      listLogTypes().then((r) => setLogTypes(r.data.data)),
    ])
  }, [projectId])

  useEffect(() => {
    setSelectedCatId('')
    setSelectedItemId('')
    setCategories([])
    setItems([])
    setQuantity('')
    setFieldValues({})
    if (!selectedTypeId) return
    listLogCategories(selectedTypeId).then((r) => setCategories(r.data.data))
  }, [selectedTypeId])

  useEffect(() => {
    setSelectedItemId('')
    setItems([])
    if (!selectedCatId) return
    listLogItems(selectedCatId).then((r) => setItems(r.data.data))
  }, [selectedCatId])

  useEffect(() => {
    if (selectedType) {
      const initial: Record<string, unknown> = {}
      entrySchema.forEach((f) => {
        initial[f.field_id] = f.field_type === 'boolean' ? false : ''
      })
      setFieldValues(initial)
    }
  }, [entrySchema, selectedType])

  const setField = (fid: string, value: unknown) =>
    setFieldValues((prev) => ({ ...prev, [fid]: value }))

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId(itemId)
    const item = items.find((row) => row.id === itemId)
    if (!item || !selectedType) return

    setFieldValues((prev) => mergeItemValuesIntoEntryFields(entrySchema, prev, item.fields))
  }

  const handleFieldChange = (field: SchemaField, value: unknown) => {
    setField(field.field_id, value)
  }

  const itemRequired = selectedCatId && items.length > 0
  const canSubmit = selectedTypeId && selectedCatId && logDate && (!itemRequired || selectedItemId) && (!quantityRequired || parsedQuantity != null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!projectId || !canSubmit) { setError('Please fill in all required fields.'); return }
    setError('')
    setLoading(true)
    try {
      const fields: FieldValue[] = buildEntryFieldPayload(entrySchema, fieldValues, {
        costMode,
        quantity: parsedQuantity,
        totalCost,
      }).map((f) => ({
        field_id: f.field_id,
        label: f.label,
        value: f.value,
      }))
      await createLogEntry(projectId, {
        log_type_id: selectedTypeId,
        category_id: selectedCatId,
        item_id: selectedItemId || undefined,
        quantity: parsedQuantity ?? undefined,
        log_date: logDate,
        fields,
        notes: notes || undefined,
      })
      navigate(`/projects/${projectId}`)
    } catch {
      setError('Failed to save log entry.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full px-8 py-7">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ink-3)' }}>
        <button onClick={() => navigate('/projects')} className="hover:underline">Projects</button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:underline">
          {project?.name ?? 'Project'}
        </button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>New entry</span>
      </div>

      {project && <div className="eyebrow mb-1">{project.name}</div>}
      <h1 className="text-[26px] font-semibold tracking-tight numeral mb-1.5" style={{ color: 'var(--ink)' }}>Add daily log entry</h1>
      <p className="text-[13.5px] mb-8" style={{ color: 'var(--ink-3)' }}>
        Pick a log type and category, then fill in the daily-entry fields. Saved items load dynamically from the selected category.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          <div className="space-y-7">
            {/* What & when */}
            <FormSection title="What & when" description="Choose the log type, category, and date this entry applies to.">
              <FormField label="Date" required>
                <DatePicker value={logDate} onChange={setLogDate} />
              </FormField>

              {quantityVisible && (
                <FormField label="Quantity" required={quantityRequired} hint={quantityRequired ? 'required for costed logs' : undefined}>
                  <input type="number" min="0" step="any" className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </FormField>
              )}

              <FormField label="Log type" required>
                {logTypes.length === 0 ? (
                  <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ background: 'var(--warn-wash)', color: 'var(--warn-ink)' }}>
                    No log types created yet.{' '}
                    <button type="button" onClick={() => navigate('/log-types/new')} className="underline font-medium">Create one first.</button>
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {logTypes.map((lt) => {
                      const active = lt.id === selectedTypeId
                      return (
                        <button
                          key={lt.id}
                          type="button"
                          onClick={() => setSelectedTypeId(lt.id)}
                          className="rounded-xl p-3 text-left transition-all"
                          style={{
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                            background: active ? 'var(--accent-wash)' : 'var(--bg-elev)',
                            boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 15%, transparent)' : 'none',
                          }}
                        >
                          <div className="text-[13px] font-medium" style={{ color: active ? 'var(--accent-ink)' : 'var(--ink)' }}>{lt.name}</div>
                          <div className="text-[11px] mt-1" style={{ color: 'var(--ink-4)' }}>
                            {getItemSchema(lt).length} item fields · {getEntrySchema(lt).length} entry fields · v{lt.current_version}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </FormField>

              {selectedTypeId && (
                <FormField label="Category" required>
                  {categories.length === 0 ? (
                    <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ background: 'var(--warn-wash)', color: 'var(--warn-ink)' }}>
                      No categories under this log type.{' '}
                      <button type="button" onClick={() => navigate(`/log-types/${selectedTypeId}`)} className="underline font-medium">Add categories first.</button>
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map((c) => {
                        const active = c.id === selectedCatId
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedCatId(c.id)}
                            className="px-3 h-8 rounded-lg text-[12.5px] font-medium transition-colors"
                            style={{
                              background: active ? 'var(--ink)' : 'var(--bg-elev)',
                              color: active ? 'var(--bg-elev)' : 'var(--ink-2)',
                              border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`,
                            }}
                          >
                            {c.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </FormField>
              )}

              {selectedCatId && items.length > 0 && (
                <FormField label={findItemSelectorField(itemSchema)?.label || 'Item'} required>
                  <SearchableSelect
                    value={selectedItemId}
                    onChange={handleSelectItem}
                    options={items.map((item) => ({ value: item.id, label: item.name }))}
                    placeholder="Select an item…"
                    searchPlaceholder="Search items…"
                  />
                </FormField>
              )}

              {selectedItem && (
                <div className="rounded-xl border px-3 py-3 text-[12px]" style={{ borderColor: 'color-mix(in oklab, var(--accent) 18%, var(--line))', background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
                  <div>
                    Using saved item <strong>{selectedItem.name}</strong>.
                  </div>
                  <div className="mt-1" style={{ color: 'var(--ink-3)' }}>
                    {selectedItem.fields
                      .filter((field) => field.value != null && field.value !== '')
                      .slice(0, 3)
                      .map((field) => `${field.label}: ${displayValue(field.value)}`)
                      .join(' · ') || 'No saved item details.'}
                  </div>
                </div>
              )}

              {selectedCatId && items.length === 0 && (
                <FormField label="Items">
                  <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                    No items under this category yet. Add items in the log type detail page if you want reusable saved records like raw materials or labour contacts.
                  </p>
                </FormField>
              )}
            </FormSection>

            {/* Dynamic schema fields */}
            {selectedType && visibleEntryFields.length > 0 && (
              <FormSection
                title={`${selectedType.name} details`}
                description={`Entry schema v${selectedType.current_version} · ${visibleEntryFields.length} fields. Required fields marked with *`}
              >
                {visibleEntryFields.map((f) => (
                  <FormField key={f.field_id} label={f.label} required={f.required}>
                    <DynamicField
                      field={f}
                      value={fieldValues[f.field_id]}
                      onChange={(v) => handleFieldChange(f, v)}
                    />
                  </FormField>
                ))}
              </FormSection>
            )}

            {/* Notes */}
            <FormSection title="Notes" description="Any extra observations — slab casting details, issues, next steps.">
              <FormField label="Notes" hint="optional">
                <textarea className="input resize-none" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened today?" />
              </FormField>
            </FormSection>

            {error && (
              <p className="text-[13px] px-4 py-2.5 rounded-lg" style={{ background: 'var(--bad-wash)', color: 'var(--bad-ink)' }}>{error}</p>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button type="submit" disabled={!canSubmit || loading} className="btn btn-accent">
                {loading ? 'Saving…' : 'Save entry'}
              </button>
              <button type="button" onClick={() => navigate(`/projects/${projectId}`)} className="btn btn-ghost">Cancel</button>
            </div>
          </div>

          {/* Live preview */}
          <div className="lg:sticky lg:top-20 self-start">
            <div className="eyebrow mb-2">Live preview</div>
            <div className="card p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {selectedType?.name || 'Pick a log type'}
                </span>
                {selectedCatId && (
                  <>
                    <span className="dot" />
                    <span className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                      {categories.find((c) => c.id === selectedCatId)?.name}
                    </span>
                  </>
                )}
                {selectedItem && (
                  <>
                    <span className="dot" />
                    <span className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                      {selectedItem.name}
                    </span>
                  </>
                )}
              </div>
              <div className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{fmtDate(logDate)}</div>
            <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: '1px solid var(--line-2)' }}>
              {quantityVisible && (
                <div className="flex items-start gap-2 text-[12px]">
                  <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>Quantity</span>
                  <span style={{ color: parsedQuantity == null ? 'var(--ink-5)' : 'var(--ink)', fontWeight: parsedQuantity == null ? 400 : 500 }}>
                    {parsedQuantity == null ? '—' : parsedQuantity}
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2 text-[12px]">
                <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>Total cost</span>
                <span style={{ color: totalCost == null ? 'var(--ink-5)' : 'var(--ink)', fontWeight: totalCost == null ? 400 : 500 }}>
                  {totalCost == null ? '—' : fmtMoney(totalCost)}
                </span>
              </div>
              {selectedItem && (
                <div className="flex items-start gap-2 text-[12px]">
                  <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>Item</span>
                  <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{selectedItem.name}</span>
                </div>
              )}
              {visibleEntryFields.map((f) => {
                  const v = fieldValues[f.field_id]
                  const empty = v === '' || v == null || v === false
                  return (
                    <div key={f.field_id} className="flex items-start gap-2 text-[12px]">
                      <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>{f.label}</span>
                      <span style={{ color: empty ? 'var(--ink-5)' : 'var(--ink)', fontWeight: empty ? 400 : 500 }}>
                        {empty ? '—' : displayValue(v)}
                      </span>
                    </div>
                  )
                })}
                {!selectedType && <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Entry fields will appear here.</div>}
              </div>
              {notes && (
                <div className="mt-3 pt-3 text-[12px] italic" style={{ borderTop: '1px solid var(--line-2)', color: 'var(--ink-3)' }}>
                  "{notes}"
                </div>
              )}
            </div>

            <div className="mt-4 p-3 rounded-xl flex items-start gap-2 text-[12px]" style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line-2)', color: 'var(--ink-3)' }}>
              <Info size={13} style={{ color: 'var(--ink-3)', marginTop: 1, flexShrink: 0 }} />
              <span>
                Entries are frozen to schema <strong style={{ color: 'var(--ink-2)' }}>v{selectedType?.current_version || '—'}</strong>.
                If the schema changes later, older entries keep their original fields.
              </span>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// ── Dynamic field renderer ────────────────────────────────────────────────────

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: SchemaField
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (field.field_type === 'number')
    return <input type="number" className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} required={field.required} />
  if (field.field_type === 'dropdown')
    return (
      <SearchableSelect
        value={(value as string) ?? ''}
        onChange={onChange}
        options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
        placeholder="Select…"
        searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
      />
    )
  if (field.field_type === 'date')
    return <DatePicker value={(value as string) ?? ''} onChange={(next) => onChange(next)} />
  if (field.field_type === 'boolean')
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>Yes</span>
      </label>
    )
  return <input type="text" className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} required={field.required} />
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function FormSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 pb-7" style={{ borderBottom: '1px solid var(--line-2)' }}>
      <div>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</h3>
        <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--ink-3)' }}>{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function FormField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center justify-between text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
        <span>
          {label}
          {required && <span className="ml-1" style={{ color: 'var(--bad)' }}>*</span>}
        </span>
        {hint && <span className="text-[11px] font-normal" style={{ color: 'var(--ink-4)' }}>{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
function displayValue(val: unknown): string {
  if (val === true) return 'Yes'
  if (val === false) return 'No'
  return String(val)
}

function getItemSchema(logType?: LogType | null): SchemaField[] {
  return logType?.current_schema ?? []
}

function getEntrySchema(logType?: LogType | null): SchemaField[] {
  if (!logType) return []
  if (logType.uses_split_schema) return logType.current_entry_schema ?? []
  return logType.current_schema ?? []
}

function getEffectiveCostMode(logType?: LogType | null): LogCostMode {
  if (!logType) return 'manual_total'
  if (logType.cost_mode) return logType.cost_mode
  const itemSchema = getItemSchema(logType)
  const entrySchema = getEntrySchema(logType)
  if (itemSchema.some((field) => isUnitCostField(field.label)) || entrySchema.some((field) => isUnitCostField(field.label))) {
    return 'quantity_x_unit_cost'
  }
  if (entrySchema.some((field) => isDirectAmountField(field.label))) {
    return 'direct_amount'
  }
  return 'manual_total'
}

function findItemSelectorField(schema: SchemaField[]): SchemaField | null {
  for (const field of schema) {
    const label = field.label.toLowerCase().trim()
    if (label === 'name' || label.includes('name') || label.includes('item') || label.includes('material')) return field
  }
  return schema.find((field) => field.field_type === 'text' || field.field_type === 'dropdown') ?? null
}

function isQuantityRequired(schema: SchemaField[], itemFields: FieldValue[]): boolean {
  return schema.some((field) => isUnitCostField(field.label)) || itemFields.some((field) => isUnitCostField(field.label))
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

function computeTotalCost(
  costMode: LogCostMode,
  schema: SchemaField[],
  itemFields: FieldValue[],
  values: Record<string, unknown>,
  quantity: number | null,
): number | null {
  if (costMode === 'direct_amount') {
    return findDirectAmountValue(schema, values) ?? findTotalCostValue(schema, values)
  }
  if (costMode === 'manual_total') {
    return findTotalCostValue(schema, values)
  }
  if (quantity == null) return null
  const unitCost = findUnitCostValue(schema, itemFields, values)
  if (unitCost == null) return null
  return unitCost * quantity
}

function findUnitCostValue(
  schema: SchemaField[],
  itemFields: FieldValue[],
  values: Record<string, unknown>,
): number | null {
  const costField = schema.find((field) => isUnitCostField(field.label))
  if (costField) {
    const raw = values[costField.field_id]
    const unitCost = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    if (Number.isFinite(unitCost)) return unitCost
  }
  const itemField = itemFields.find((field) => isUnitCostField(field.label))
  if (!itemField) return null
  const raw = itemField.value
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function findDirectAmountValue(schema: SchemaField[], values: Record<string, unknown>): number | null {
  const amountField = schema.find((field) => isDirectAmountField(field.label))
  if (!amountField) return null
  return toNumericValue(values[amountField.field_id])
}

function findTotalCostValue(schema: SchemaField[], values: Record<string, unknown>): number | null {
  const totalField = schema.find((field) => isTotalCostField(field.label))
  if (!totalField) return null
  return toNumericValue(values[totalField.field_id])
}

function mergeItemValuesIntoEntryFields(
  entrySchema: SchemaField[],
  currentValues: Record<string, unknown>,
  itemFields: FieldValue[],
): Record<string, unknown> {
  const nextValues = { ...currentValues }
  entrySchema.forEach((field) => {
    const itemField = itemFields.find((candidate) =>
      candidate.field_id === field.field_id
      || candidate.label.trim().toLowerCase() === field.label.trim().toLowerCase(),
    )
    if (itemField) nextValues[field.field_id] = itemField.value
  })
  return nextValues
}

function getVisibleEntryFields(schema: SchemaField[], costMode: LogCostMode): SchemaField[] {
  return schema.filter((field) => {
    if (costMode === 'quantity_x_unit_cost' && isQuantityField(field.label)) return false
    if (costMode !== 'manual_total' && isTotalCostField(field.label)) return false
    return true
  })
}

function buildEntryFieldPayload(
  schema: SchemaField[],
  values: Record<string, unknown>,
  options: { costMode: LogCostMode; quantity: number | null; totalCost: number | null },
): Array<{ field_id: string; label: string; value: unknown }> {
  return schema.map((field) => {
    if (options.costMode === 'quantity_x_unit_cost' && isQuantityField(field.label)) {
      return { field_id: field.field_id, label: field.label, value: options.quantity }
    }
    if (options.costMode !== 'manual_total' && isTotalCostField(field.label)) {
      return { field_id: field.field_id, label: field.label, value: options.totalCost }
    }
    return { field_id: field.field_id, label: field.label, value: values[field.field_id] ?? null }
  })
}

function isQuantityField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'quantity' || value === 'qty' || value.includes('quantity') || value.includes('qty')
}

function isDirectAmountField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value.includes('daily cost') || value.includes('daily payment') || value.includes('payment') || value.includes('amount paid') || value.includes('wage') || value.includes('charges')
}

function isTotalCostField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'total' || value === 'total cost' || value.includes('total cost')
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isUnitCostField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return (
    value === 'cost' ||
    value === 'amount' ||
    value === 'payment' ||
    value.includes('unit cost') ||
    value.includes('cost per unit') ||
    value.includes('rate') ||
    value.includes('price') ||
    value.includes('payment') ||
    value.includes('amount')
  )
}

function fmtMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}
