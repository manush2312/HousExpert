import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Info } from 'lucide-react'
import DatePicker from '../../components/DatePicker'
import SearchableSelect from '../../components/SearchableSelect'
import SizeTextInput from '../../components/SizeTextInput'
import { listInventoryStockLots, type InventoryStockLot } from '../../services/inventoryService'
import {
  createLogEntry,
  getPricingRule,
  listLogCategories,
  listLogItems,
  listLogTypes,
  type FieldValue,
  type LogCategory,
  type LogCostMode,
  type LogItem,
  type LogType,
  type PricingRule,
  type SchemaField,
} from '../../services/logService'
import { getProject, type Project } from '../../services/projectService'
import {
  computeLogTotalCost,
  computeInventoryVendorSellTotal,
  findSizeFieldLabel,
  isDirectAmountFieldLabel,
  isQuantityFieldLabel,
  isTotalCostFieldLabel,
  isUnitCostFieldLabel,
} from '../../utils/logPricing'
import { isSizeLikeLabel } from '../../utils/sizeFormat'

type LotAllocationDraft = {
  inventory_lot_id: string
  allocated_quantity: string
}

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
  const [lotAllocations, setLotAllocations] = useState<LotAllocationDraft[]>([])
  const [stockLotRows, setStockLotRows] = useState<InventoryStockLot[]>([])
  const [pricingRule, setPricingRule] = useState<PricingRule | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedType = logTypes.find((t) => t.id === selectedTypeId)
  const itemSchema = getItemSchema(selectedType)
  const entrySchema = getEntrySchema(selectedType)
  const costMode = getEffectiveCostMode(selectedType)
  const selectedItem = items.find((item) => item.id === selectedItemId)
  const resolvedInventoryLink = selectedItem ? resolveInventoryLinkForEntry(selectedItem, fieldValues) : null
  const inventoryLinked = Boolean(resolvedInventoryLink || selectedItem?.inventory_link || (selectedItem?.inventory_mappings?.length ?? 0) > 0)
  const inventoryQuantityUnit = resolvedInventoryLink?.quantity_unit?.trim()
  const quantityVisible = costMode === 'quantity_x_unit_cost' || inventoryLinked
  const quantityRequired = quantityVisible && (isQuantityRequired(entrySchema, selectedItem?.fields ?? []) || inventoryLinked)
  const parsedQuantity = parseOptionalNumber(quantity)
  const sizeFieldLabel = findSizeFieldLabel(entrySchema, selectedItem?.fields ?? [])
  const inventoryConsumption = inventoryLinked && parsedQuantity != null
    ? parsedQuantity * (resolvedInventoryLink?.usage_per_quantity ?? 0)
    : null
  const lotSelectionRequired = inventoryLinked && stockLotRows.length > 0
  const parsedLotAllocations = normalizeLotAllocationDrafts(lotAllocations)
  const vendorPricedTotalCost = resolvedInventoryLink
    ? computeInventoryVendorSellTotal(parsedQuantity, resolvedInventoryLink.usage_per_quantity, parsedLotAllocations, stockLotRows)
    : null
  const totalCost = vendorPricedTotalCost ?? (
    parsedQuantity != null
      ? computeLogTotalCost(costMode, entrySchema, selectedItem?.fields ?? [], fieldValues, parsedQuantity, pricingRule)
      : computeLogTotalCost(costMode, entrySchema, selectedItem?.fields ?? [], fieldValues, null, pricingRule)
  )
  const visibleEntryFields = getVisibleEntryFields(entrySchema, costMode)
  const quantityLabel = sizeFieldLabel
    ? `Quantity${inventoryQuantityUnit ? ` (${inventoryQuantityUnit})` : ''}`
    : pricingRule
    ? 'Size / quantity'
    : inventoryLinked && inventoryQuantityUnit
      ? `Quantity (${inventoryQuantityUnit})`
      : 'Quantity'
  const quantityHint = sizeFieldLabel
    ? `${sizeFieldLabel} will be multiplied with this quantity and the matched rate`
    : pricingRule
    ? 'Enter the measurable amount used for this log, such as square feet or units'
    : inventoryLinked
      ? resolvedInventoryLink
        ? `Enter quantity in ${inventoryQuantityUnit || 'the linked unit'}. This entry will consume stock from ${resolvedInventoryLink.inventory_item_name}.`
        : 'Pick the matching dropdown values below so the correct inventory item can be resolved.'
    : quantityRequired
      ? 'required for costed logs'
      : undefined
  const allocatedInventoryTotal = parsedLotAllocations.reduce((sum, allocation) => sum + allocation.allocated_quantity, 0)
  const allocationDiff = inventoryConsumption != null ? inventoryConsumption - allocatedInventoryTotal : null
  const allocationRowsComplete = lotAllocations.length > 0 && lotAllocations.every((allocation) => allocation.inventory_lot_id && parseOptionalNumber(allocation.allocated_quantity) != null && Number(allocation.allocated_quantity) > 0)
  const lotAllocationReady = !lotSelectionRequired
    || (inventoryConsumption != null && inventoryConsumption > 0 && allocationRowsComplete && Math.abs(allocationDiff ?? 0) <= 0.000001)

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
    setLotAllocations([])
    setStockLotRows([])
    setPricingRule(null)
    if (!selectedTypeId) return
    Promise.all([
      listLogCategories(selectedTypeId).then((r) => setCategories(r.data.data)),
      getPricingRule(selectedTypeId).then((r) => setPricingRule(r.data.data)),
    ]).catch(() => setPricingRule(null))
  }, [selectedTypeId])

  useEffect(() => {
    setSelectedItemId('')
    setItems([])
    setLotAllocations([])
    setStockLotRows([])
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

  useEffect(() => {
    if (!resolvedInventoryLink?.inventory_item_id) {
      setStockLotRows([])
      setLotAllocations([])
      return
    }
    listInventoryStockLots(resolvedInventoryLink.inventory_item_id)
      .then((response) => {
        const rows = response.data.data ?? []
        setStockLotRows(rows)
      })
      .catch(() => {
        setStockLotRows([])
        setLotAllocations([])
      })
  }, [resolvedInventoryLink?.inventory_item_id])

  useEffect(() => {
    setLotAllocations((prev) => syncLotAllocations(prev, stockLotRows, inventoryConsumption))
  }, [stockLotRows, inventoryConsumption])

  const setField = (fid: string, value: unknown) =>
    setFieldValues((prev) => ({ ...prev, [fid]: value }))

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId(itemId)
    setLotAllocations([])
    const item = items.find((row) => row.id === itemId)
    if (!item || !selectedType) return

    setFieldValues((prev) => mergeItemValuesIntoEntryFields(entrySchema, prev, item.fields))
  }

  const handleFieldChange = (field: SchemaField, value: unknown) => {
    setField(field.field_id, value)
  }

  const itemRequired = selectedCatId && items.length > 0
  const canSubmit = selectedTypeId
    && selectedCatId
    && logDate
    && (!itemRequired || selectedItemId)
    && (!quantityRequired || parsedQuantity != null)
    && lotAllocationReady

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
        inventory_lot_id: parsedLotAllocations.length === 1 ? parsedLotAllocations[0].inventory_lot_id : undefined,
        inventory_lot_allocations: parsedLotAllocations.length > 0 ? parsedLotAllocations : undefined,
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
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
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
        Pick a log type and category, then fill in the daily-entry fields. Saved items are optional and only needed when you want reusable presets.
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
                <FormField label={quantityLabel} required={quantityRequired} hint={quantityHint}>
                  <input type="number" min="0" step="any" className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </FormField>
              )}

              {inventoryLinked && resolvedInventoryLink && stockLotRows.length > 0 && (
                <FormField
                  label="Allocate stock lots"
                  required
                  hint={`Split ${inventoryConsumption ?? 0} ${resolvedInventoryLink.inventory_unit} across one or more lots.`}
                >
                  <LotAllocationEditor
                    allocations={lotAllocations}
                    stockLots={stockLotRows}
                    inventoryUnit={resolvedInventoryLink.inventory_unit}
                    requiredTotal={inventoryConsumption}
                    onChange={setLotAllocations}
                  />
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
                  {inventoryLinked && (
                    <div className="mt-2" style={{ color: 'var(--accent-ink)' }}>
                      {resolvedInventoryLink ? (
                        <>
                          Linked inventory: <strong>{resolvedInventoryLink.inventory_item_name}</strong>
                          {' · '}
                          {resolvedInventoryLink.usage_per_quantity} {resolvedInventoryLink.inventory_unit} per {resolvedInventoryLink.quantity_unit}
                        </>
                      ) : (
                        <>Linked inventory will resolve from the selected daily-entry values.</>
                      )}
                    </div>
                  )}
                  {stockLotRows.length > 0 && (
                    <div className="mt-2" style={{ color: 'var(--ink-3)' }}>
                      Available stock lots: {stockLotRows.map((row) => `${row.supplier_bucket} · ${row.remaining_quantity} ${row.item_unit}`).join(' | ')}
                    </div>
                  )}
                </div>
              )}

              {selectedCatId && items.length === 0 && (
                <FormField label="Items">
                  <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                    No saved items under this category yet. That is okay if this log type is entered manually. Continue with the daily fields below, or add items later if you want reusable presets.
                  </p>
                </FormField>
              )}
            </FormSection>

            {/* Dynamic schema fields */}
            {selectedType && visibleEntryFields.length > 0 && (
              <FormSection
                title={`${selectedType.name} details`}
                description={pricingRule
                  ? sizeFieldLabel
                    ? `Choose the pricing dimensions below, enter ${sizeFieldLabel}, then enter quantity above. Required fields marked with *`
                    : `Choose the pricing dimensions below, then enter the size/quantity above. Required fields marked with *`
                  : `Entry schema v${selectedType.current_version} · ${visibleEntryFields.length} fields. Required fields marked with *`}
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
            {!error && lotSelectionRequired && inventoryConsumption != null && !lotAllocationReady && (
              <p className="text-[13px] px-4 py-2.5 rounded-lg" style={{ background: 'var(--warn-wash)', color: 'var(--warn-ink)' }}>
                Allocate exactly {inventoryConsumption} {resolvedInventoryLink?.inventory_unit} across the selected lots before saving.
              </p>
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
                  <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>{quantityLabel}</span>
                  <span style={{ color: parsedQuantity == null ? 'var(--ink-5)' : 'var(--ink)', fontWeight: parsedQuantity == null ? 400 : 500 }}>
                    {parsedQuantity == null ? '—' : parsedQuantity}
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2 text-[12px]">
                <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>Total cost</span>
                <div>
                  <span style={{ color: totalCost == null ? 'var(--ink-5)' : 'var(--ink)', fontWeight: totalCost == null ? 400 : 500 }}>
                    {totalCost == null ? '—' : fmtMoney(totalCost)}
                  </span>
                  {vendorPricedTotalCost != null && (
                    <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-4)' }}>
                      From selected vendor lot selling price.
                    </div>
                  )}
                </div>
              </div>
              {selectedItem && (
                <div className="flex items-start gap-2 text-[12px]">
                  <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>Item</span>
                  <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{selectedItem.name}</span>
                </div>
              )}
              {inventoryLinked && (
                <div className="flex items-start gap-2 text-[12px]">
                  <span className="shrink-0 w-28 truncate" style={{ color: 'var(--ink-4)' }}>Inventory</span>
                  <span style={{ color: inventoryConsumption == null ? 'var(--ink-5)' : 'var(--ink)', fontWeight: inventoryConsumption == null ? 400 : 500 }}>
                    {!resolvedInventoryLink
                      ? 'Select the matching dropdown values to resolve the inventory item.'
                      : inventoryConsumption == null
                        ? `${resolvedInventoryLink.inventory_item_name} linked`
                        : `${inventoryConsumption} ${resolvedInventoryLink.inventory_unit} from ${resolvedInventoryLink.inventory_item_name}${parsedLotAllocations.length > 0 ? ` · ${summarizeLotAllocations(parsedLotAllocations, stockLotRows)}` : ''} for ${parsedQuantity} ${resolvedInventoryLink.quantity_unit}`}
                  </span>
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

function LotAllocationEditor({
  allocations,
  stockLots,
  inventoryUnit,
  requiredTotal,
  onChange,
}: {
  allocations: LotAllocationDraft[]
  stockLots: InventoryStockLot[]
  inventoryUnit: string
  requiredTotal: number | null
  onChange: (next: LotAllocationDraft[]) => void
}) {
  const totalAllocated = normalizeLotAllocationDrafts(allocations).reduce((sum, allocation) => sum + allocation.allocated_quantity, 0)
  const remaining = requiredTotal != null ? requiredTotal - totalAllocated : null

  return (
    <div className="space-y-3">
      {allocations.map((allocation, index) => {
        const selectedIds = allocations
          .map((row, rowIndex) => rowIndex === index ? '' : row.inventory_lot_id)
          .filter(Boolean)
        const options = stockLots
          .filter((lot) => !selectedIds.includes(lot.lot_id) || lot.lot_id === allocation.inventory_lot_id)
          .map((lot) => ({
            value: lot.lot_id,
            label: `${lot.label} · ${lot.remaining_quantity} ${lot.item_unit} available${lot.default_sell_price != null && lot.default_sell_price > 0 ? ` · Sell ${lot.default_sell_price}` : ''}`,
          }))

        return (
          <div key={`allocation-${index}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]">
            <SearchableSelect
              value={allocation.inventory_lot_id}
              onChange={(value) => onChange(allocations.map((row, rowIndex) => rowIndex === index ? { ...row, inventory_lot_id: value } : row))}
              options={options}
              placeholder="Select stock lot"
              searchPlaceholder="Search stock lots…"
              emptyMessage="No stock lots found"
            />
            <input
              type="number"
              min="0"
              step="any"
              className="input numeral"
              value={allocation.allocated_quantity}
              onChange={(e) => onChange(allocations.map((row, rowIndex) => rowIndex === index ? { ...row, allocated_quantity: e.target.value } : row))}
              placeholder={inventoryUnit}
            />
            <button
              type="button"
              onClick={() => onChange(allocations.filter((_, rowIndex) => rowIndex !== index))}
              className="btn btn-ghost"
            >
              Remove
            </button>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange([...allocations, { inventory_lot_id: '', allocated_quantity: '' }])}
          className="btn btn-ghost"
        >
          Add lot
        </button>
        {requiredTotal != null && (
          <span className="text-[12px]" style={{ color: Math.abs(remaining ?? 0) <= 0.000001 ? 'var(--ok-ink)' : 'var(--ink-3)' }}>
            Allocated {totalAllocated} / {requiredTotal} {inventoryUnit}
            {remaining != null && Math.abs(remaining) > 0.000001 ? ` · Remaining ${remaining.toFixed(3).replace(/\.?0+$/, '')} ${inventoryUnit}` : ''}
          </span>
        )}
      </div>
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
  if (isSizeLikeLabel(field.label))
    return <SizeTextInput className="input" value={(value as string) ?? ''} onChange={onChange as (next: string) => void} />
  return <input type="text" className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} required={field.required} />
}

function normalizeLotAllocationDrafts(allocations: LotAllocationDraft[]) {
  return allocations
    .map((allocation) => ({
      inventory_lot_id: allocation.inventory_lot_id,
      allocated_quantity: parseOptionalNumber(allocation.allocated_quantity),
    }))
    .filter((allocation): allocation is { inventory_lot_id: string; allocated_quantity: number } => Boolean(allocation.inventory_lot_id) && allocation.allocated_quantity != null && allocation.allocated_quantity > 0)
}

function syncLotAllocations(current: LotAllocationDraft[], stockLots: InventoryStockLot[], requiredTotal: number | null) {
  if (stockLots.length === 0 || requiredTotal == null || requiredTotal <= 0) return []

  const allowedIds = new Set(stockLots.map((lot) => lot.lot_id))
  const filtered = current.filter((allocation) => allocation.inventory_lot_id === '' || allowedIds.has(allocation.inventory_lot_id))
  if (filtered.length === 0) {
    if (stockLots.length === 1) {
      return [{ inventory_lot_id: stockLots[0].lot_id, allocated_quantity: String(requiredTotal) }]
    }
    return [{ inventory_lot_id: '', allocated_quantity: '' }]
  }
  if (filtered.length === 1 && filtered[0].inventory_lot_id && stockLots.length === 1) {
    return [{ ...filtered[0], allocated_quantity: String(requiredTotal) }]
  }
  return filtered
}

function summarizeLotAllocations(
  allocations: { inventory_lot_id: string; allocated_quantity: number }[],
  stockLots: InventoryStockLot[],
) {
  return allocations
    .map((allocation) => {
      const lot = stockLots.find((row) => row.lot_id === allocation.inventory_lot_id)
      const label = lot?.supplier_bucket || lot?.label || allocation.inventory_lot_id
      return `${allocation.allocated_quantity} from ${label}`
    })
    .join(', ')
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
  if (itemSchema.some((field) => isUnitCostFieldLabel(field.label)) || entrySchema.some((field) => isUnitCostFieldLabel(field.label))) {
    return 'quantity_x_unit_cost'
  }
  if (entrySchema.some((field) => isDirectAmountFieldLabel(field.label))) {
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
  return schema.some((field) => isUnitCostFieldLabel(field.label)) || itemFields.some((field) => isUnitCostFieldLabel(field.label))
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
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
    if (costMode === 'quantity_x_unit_cost' && isQuantityFieldLabel(field.label)) return false
    if (costMode !== 'manual_total' && isTotalCostFieldLabel(field.label)) return false
    return true
  })
}

function buildEntryFieldPayload(
  schema: SchemaField[],
  values: Record<string, unknown>,
  options: { costMode: LogCostMode; quantity: number | null; totalCost: number | null },
): Array<{ field_id: string; label: string; value: unknown }> {
  return schema.map((field) => {
    if (options.costMode === 'quantity_x_unit_cost' && isQuantityFieldLabel(field.label)) {
      return { field_id: field.field_id, label: field.label, value: options.quantity }
    }
    if (options.costMode !== 'manual_total' && isTotalCostFieldLabel(field.label)) {
      return { field_id: field.field_id, label: field.label, value: options.totalCost }
    }
    return { field_id: field.field_id, label: field.label, value: values[field.field_id] ?? null }
  })
}

function resolveInventoryLinkForEntry(item: LogItem, values: Record<string, unknown>) {
  const mappings = item.inventory_mappings ?? []
  let bestLink = item.inventory_link ?? null
  let bestScore = -1

  mappings.forEach((mapping) => {
    const entries = Object.entries(mapping.conditions ?? {})
    if (entries.length === 0) return
    const matched = entries.every(([fieldId, expected]) => String(values[fieldId] ?? '').trim() === expected)
    if (!matched) return
    if (entries.length > bestScore) {
      bestLink = mapping.link
      bestScore = entries.length
    }
  })

  return bestLink
}

function fmtMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}
