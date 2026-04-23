import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Edit2, Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react'
import DatePicker from '../../components/DatePicker'
import SearchableSelect from '../../components/SearchableSelect'
import {
  archiveLogCategory,
  archiveLogItem,
  createLogCategory,
  createLogItem,
  getLogType,
  listLogCategories,
  listLogItems,
  restoreLogCategory,
  restoreLogItem,
  updateLogItem,
  updateLogTypeSchema,
  type FieldType,
  type FieldValue,
  type LogCategory,
  type LogCostMode,
  type LogItem,
  type LogType,
  type SchemaField,
} from '../../services/logService'

interface SchemaDraft {
  field_id?: string
  label: string
  field_type: FieldType
  required: boolean
  options: string
  added_at?: string
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes / No' },
]

const emptyFieldDraft = (): SchemaDraft => ({
  label: '',
  field_type: 'text',
  required: false,
  options: '',
})

const COST_MODES: { value: LogCostMode; label: string; description: string }[] = [
  { value: 'quantity_x_unit_cost', label: 'Quantity x unit cost', description: 'Shared quantity is used and total cost comes from quantity x unit cost.' },
  { value: 'direct_amount', label: 'Direct amount', description: 'A daily amount field is used and shown as total cost.' },
  { value: 'manual_total', label: 'Manual total', description: 'The team enters total cost directly in the daily-entry schema.' },
]

export default function LogTypeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [logType, setLogType] = useState<LogType | null>(null)
  const [categories, setCategories] = useState<LogCategory[]>([])
  const [itemsByCategory, setItemsByCategory] = useState<Record<string, LogItem[]>>({})
  const [loading, setLoading] = useState(true)

  const [newCatName, setNewCatName] = useState('')
  const [newCatDesc, setNewCatDesc] = useState('')
  const [addingCat, setAddingCat] = useState(false)

  const [editingItemSchema, setEditingItemSchema] = useState(false)
  const [editingEntrySchema, setEditingEntrySchema] = useState(false)
  const [costModeDraft, setCostModeDraft] = useState<LogCostMode>('manual_total')
  const [itemSchemaDrafts, setItemSchemaDrafts] = useState<SchemaDraft[]>([])
  const [entrySchemaDrafts, setEntrySchemaDrafts] = useState<SchemaDraft[]>([])
  const [savingSchema, setSavingSchema] = useState(false)

  const [itemDraftsByCategory, setItemDraftsByCategory] = useState<Record<string, Record<string, unknown>>>({})
  const [addingItemFor, setAddingItemFor] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItemValues, setEditingItemValues] = useState<Record<string, unknown>>({})
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [itemSearchByCategory, setItemSearchByCategory] = useState<Record<string, string>>({})
  const [categorySearch, setCategorySearch] = useState('')

  const fetchAll = async () => {
    if (!id) return
    try {
      const [ltRes, catRes] = await Promise.all([
        getLogType(id),
        listLogCategories(id, { include_archived: true }),
      ])
      const nextLogType = ltRes.data.data
      const itemSchema = getItemSchema(nextLogType)
      const entrySchema = getEntrySchema(nextLogType)
      const nextCategories = catRes.data.data
      setLogType(nextLogType)
      setCategories(nextCategories)
      setCostModeDraft(getEffectiveCostMode(nextLogType))
      if (!editingItemSchema) {
        setItemSchemaDrafts(itemSchema.map(toSchemaDraft))
      }
      if (!editingEntrySchema) {
        setEntrySchemaDrafts(entrySchema.map(toSchemaDraft))
      }
      const itemPairs = await Promise.all(
        nextCategories.map(async (cat) => {
          const res = await listLogItems(cat.id, { include_archived: true })
          return [cat.id, res.data.data] as const
        }),
      )
      setItemsByCategory(Object.fromEntries(itemPairs))
      setItemDraftsByCategory((prev) => {
        const next = { ...prev }
        nextCategories.forEach((cat) => {
          if (!next[cat.id]) next[cat.id] = initialItemDraft(itemSchema)
        })
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchAll() }, [id])

  const itemSchema = useMemo(() => getItemSchema(logType), [logType])
  const entrySchema = useMemo(() => getEntrySchema(logType), [logType])
  const schemaDisplayNameField = useMemo(
    () => findItemSelectorField(itemSchema),
    [itemSchema],
  )
  const orderedCategories = useMemo(
    () => sortArchivedCategoriesLast(categories),
    [categories],
  )
  const visibleCategories = useMemo(
    () => filterCategories(orderedCategories, categorySearch),
    [orderedCategories, categorySearch],
  )

  const handleAddCategory = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!id || !newCatName.trim()) return
    setAddingCat(true)
    try {
      await createLogCategory(id, { name: newCatName.trim(), description: newCatDesc.trim() || undefined })
      setNewCatName('')
      setNewCatDesc('')
      await fetchAll()
    } finally {
      setAddingCat(false)
    }
  }

  const handleArchiveCategory = async (categoryId: string, name: string) => {
    const category = categories.find((item) => item.id === categoryId)
    const message = category && category.entry_count > 0
      ? `"${name}" has ${category.entry_count} existing entries. Archive anyway?`
      : `Archive category "${name}"?`
    if (!confirm(message)) return
    await archiveLogCategory(categoryId)
    await fetchAll()
  }

  const handleRestoreCategory = async (categoryId: string, name: string) => {
    if (!confirm(`Restore category "${name}"?`)) return
    await restoreLogCategory(categoryId)
    await fetchAll()
  }

  const handleArchiveItem = async (itemId: string, name: string, categoryId: string) => {
    const item = itemsByCategory[categoryId]?.find((row) => row.id === itemId)
    const message = item && item.entry_count > 0
      ? `"${name}" has ${item.entry_count} existing entries. Archive anyway?`
      : `Archive item "${name}"?`
    if (!confirm(message)) return
    await archiveLogItem(itemId)
    await fetchAll()
  }

  const handleRestoreItem = async (itemId: string, name: string) => {
    if (!confirm(`Restore item "${name}"?`)) return
    await restoreLogItem(itemId)
    await fetchAll()
  }

  const updateSchemaDraft = (target: 'item' | 'entry', index: number, patch: Partial<SchemaDraft>) => {
    const setter = target === 'item' ? setItemSchemaDrafts : setEntrySchemaDrafts
    setter((prev) => prev.map((field, current) => current === index ? { ...field, ...patch } : field))
  }

  const addSchemaDraft = (target: 'item' | 'entry') => {
    const setter = target === 'item' ? setItemSchemaDrafts : setEntrySchemaDrafts
    setter((prev) => [...prev, emptyFieldDraft()])
  }
  const removeSchemaDraft = (target: 'item' | 'entry', index: number) => {
    const setter = target === 'item' ? setItemSchemaDrafts : setEntrySchemaDrafts
    setter((prev) => prev.filter((_, current) => current !== index))
  }

  const handleSaveSchema = async () => {
    if (!id) return
    const allDrafts = [...itemSchemaDrafts, ...entrySchemaDrafts]
    const emptyLabel = allDrafts.find((field) => !field.label.trim())
    if (emptyLabel) {
      alert('Every schema field needs a label.')
      return
    }
    const dropdownWithoutOptions = allDrafts.find((field) => field.field_type === 'dropdown' && !field.options.trim())
    if (dropdownWithoutOptions) {
      alert('Dropdown fields need at least one option.')
      return
    }
    const schemaValidationError = validateSchemaForCostMode(costModeDraft, entrySchemaDrafts)
    if (schemaValidationError) {
      alert(schemaValidationError)
      return
    }

    setSavingSchema(true)
    try {
      await updateLogTypeSchema(id, {
        item_fields: itemSchemaDrafts.map(toSchemaFieldPayload),
        entry_fields: entrySchemaDrafts.map(toSchemaFieldPayload),
        cost_mode: costModeDraft,
      })
      setEditingItemSchema(false)
      setEditingEntrySchema(false)
      await fetchAll()
    } finally {
      setSavingSchema(false)
    }
  }

  const startEditingSchema = (target: 'item' | 'entry') => {
    if (!logType) return
    if (target === 'item') {
      setItemSchemaDrafts(itemSchema.map(toSchemaDraft))
      setEditingItemSchema(true)
      return
    }
    setEntrySchemaDrafts(entrySchema.map(toSchemaDraft))
    setEditingEntrySchema(true)
  }

  const cancelEditingSchema = (target: 'item' | 'entry') => {
    if (!logType) return
    if (target === 'item') {
      setItemSchemaDrafts(itemSchema.map(toSchemaDraft))
      setEditingItemSchema(false)
      return
    }
    setEntrySchemaDrafts(entrySchema.map(toSchemaDraft))
    setEditingEntrySchema(false)
  }

  const updateItemDraft = (categoryId: string, fieldId: string, value: unknown) => {
    setItemDraftsByCategory((prev) => ({
      ...prev,
      [categoryId]: {
        ...(prev[categoryId] ?? {}),
        [fieldId]: value,
      },
    }))
  }

  const handleAddItem = async (e: React.FormEvent<HTMLFormElement>, categoryId: string) => {
    e.preventDefault()
    if (!logType) return

    const draft = itemDraftsByCategory[categoryId] ?? initialItemDraft(itemSchema)
    const missingRequired = itemSchema.find((field) => {
      if (!field.required) return false
      const value = draft[field.field_id]
      return value === '' || value === null || value === undefined
    })
    if (missingRequired) {
      alert(`"${missingRequired.label}" is required.`)
      return
    }

    setAddingItemFor(categoryId)
    try {
      const fields: FieldValue[] = itemSchema.map((field) => ({
        field_id: field.field_id,
        label: field.label,
        value: normalizeFieldDraftValue(field, draft[field.field_id]),
      }))
      await createLogItem(categoryId, { fields })
      setItemDraftsByCategory((prev) => ({ ...prev, [categoryId]: initialItemDraft(itemSchema) }))
      await fetchAll()
    } finally {
      setAddingItemFor(null)
    }
  }

  const startEditingItem = (item: LogItem) => {
    setEditingItemId(item.id)
    setEditingItemValues(Object.fromEntries(item.fields.map((field) => [field.field_id, field.value])))
  }

  const cancelEditingItem = () => {
    setEditingItemId(null)
    setEditingItemValues({})
  }

  const saveEditingItem = async (item: LogItem) => {
    if (!logType) return

    const missingRequired = itemSchema.find((field) => {
      if (!field.required) return false
      const value = editingItemValues[field.field_id]
      return value === '' || value === null || value === undefined
    })
    if (missingRequired) {
      alert(`"${missingRequired.label}" is required.`)
      return
    }

    setSavingItemId(item.id)
    try {
      const fields: FieldValue[] = itemSchema.map((field) => ({
        field_id: field.field_id,
        label: field.label,
        value: normalizeFieldDraftValue(field, editingItemValues[field.field_id]),
      }))
      await updateLogItem(item.id, { fields })
      cancelEditingItem()
      await fetchAll()
    } finally {
      setSavingItemId(null)
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-7 space-y-4">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-7 w-56" />
        <div className="skeleton h-4 w-40 mt-2" />
      </div>
    )
  }

  if (!logType) return null

  return (
    <div className="w-full px-8 py-7">
      <div className="flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ink-3)' }}>
        <button onClick={() => navigate('/log-types')} className="hover:underline">Log Types</button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>{logType.name}</span>
      </div>

      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight numeral" style={{ color: 'var(--ink)' }}>{logType.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="chip chip-accent">Schema v{logType.current_version}</span>
            <span className="chip">{itemSchema.length} item fields</span>
            <span className="chip">{entrySchema.length} entry fields</span>
            <span className="chip">{costModeLabel(getEffectiveCostMode(logType))}</span>
            {logType.status === 'archived' && <span className="chip chip-bad">Archived</span>}
          </div>
        </div>
      </div>

      <div className="max-w-5xl space-y-8">
        <section>
          <div className="mb-4 max-w-md">
            <div className="mb-1 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Cost mode</div>
            <p className="mb-3 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
              This controls whether logs use shared quantity, a direct daily amount, or a manual total.
            </p>
            <SearchableSelect
              value={costModeDraft}
              onChange={(value) => setCostModeDraft(value as LogCostMode)}
              options={COST_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
              searchPlaceholder="Search cost modes…"
              disabled={logType.status === 'archived'}
            />
            <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-4)' }}>
              {COST_MODES.find((mode) => mode.value === costModeDraft)?.description}
            </p>
          </div>
        </section>

        <section>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-[14px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Item fields</h2>
              <p className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                Version {logType.current_version} · used while creating items under each category.
              </p>
            </div>
            {!editingItemSchema ? (
              <button type="button" onClick={() => startEditingSchema('item')} className="btn btn-outline btn-sm" disabled={logType.status === 'archived'}>
                Edit item fields
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => addSchemaDraft('item')} className="btn btn-outline btn-sm">
                  <Plus size={13} /> Add field
                </button>
                <button type="button" onClick={() => cancelEditingSchema('item')} className="btn btn-ghost btn-sm">
                  Cancel
                </button>
                <button type="button" onClick={handleSaveSchema} disabled={savingSchema} className="btn btn-accent btn-sm">
                  <Save size={13} /> {savingSchema ? 'Saving…' : 'Save all schema changes'}
                </button>
              </div>
            )}
          </div>

          {!editingItemSchema ? (
            itemSchema.length === 0 ? (
              <div className="card flex flex-col items-center justify-center py-10 text-center">
                <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>No fields defined yet.</p>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ background: 'var(--bg-sunken)' }}>
                      {['Field label', 'Type', 'Required', 'Options'].map((heading) => (
                        <th key={heading} className="px-4 py-2.5 text-left eyebrow">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itemSchema.map((field) => (
                      <tr key={field.field_id} style={{ borderTop: '1px solid var(--line-2)' }}>
                        <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>{field.label}</td>
                        <td className="px-4 py-3 capitalize" style={{ color: 'var(--ink-2)' }}>{field.field_type}</td>
                        <td className="px-4 py-3">
                          {field.required
                            ? <span className="chip chip-bad">Required</span>
                            : <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>Optional</span>}
                        </td>
                        <td className="px-4 py-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                          {field.options?.join(', ') || <span style={{ color: 'var(--ink-5)' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <SchemaEditor
              drafts={itemSchemaDrafts}
              onUpdate={(index, patch) => updateSchemaDraft('item', index, patch)}
              onRemove={(index) => removeSchemaDraft('item', index)}
            />
          )}
        </section>

        <section>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-[14px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Daily entry fields</h2>
              <p className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                These appear when your team logs daily activity. Leave empty if quantity and notes are enough.
              </p>
            </div>
            {!editingEntrySchema ? (
              <button type="button" onClick={() => startEditingSchema('entry')} className="btn btn-outline btn-sm" disabled={logType.status === 'archived'}>
                Edit entry fields
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => addSchemaDraft('entry')} className="btn btn-outline btn-sm">
                  <Plus size={13} /> Add field
                </button>
                <button type="button" onClick={() => cancelEditingSchema('entry')} className="btn btn-ghost btn-sm">
                  Cancel
                </button>
                <button type="button" onClick={handleSaveSchema} disabled={savingSchema} className="btn btn-accent btn-sm">
                  <Save size={13} /> {savingSchema ? 'Saving…' : 'Save all schema changes'}
                </button>
              </div>
            )}
          </div>

          {!editingEntrySchema ? (
            entrySchema.length === 0 ? (
              <div className="card flex flex-col items-center justify-center py-10 text-center">
                <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>No daily entry fields defined.</p>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ background: 'var(--bg-sunken)' }}>
                      {['Field label', 'Type', 'Required', 'Options'].map((heading) => (
                        <th key={heading} className="px-4 py-2.5 text-left eyebrow">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entrySchema.map((field) => (
                      <tr key={field.field_id} style={{ borderTop: '1px solid var(--line-2)' }}>
                        <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>{field.label}</td>
                        <td className="px-4 py-3 capitalize" style={{ color: 'var(--ink-2)' }}>{field.field_type}</td>
                        <td className="px-4 py-3">
                          {field.required
                            ? <span className="chip chip-bad">Required</span>
                            : <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>Optional</span>}
                        </td>
                        <td className="px-4 py-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                          {field.options?.join(', ') || <span style={{ color: 'var(--ink-5)' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <SchemaEditor
              drafts={entrySchemaDrafts}
              onUpdate={(index, patch) => updateSchemaDraft('entry', index, patch)}
              onRemove={(index) => removeSchemaDraft('entry', index)}
            />
          )}
        </section>

        <section>
          <h2 className="text-[14px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Categories</h2>
          <p className="text-[12.5px] mb-4" style={{ color: 'var(--ink-3)' }}>
            Under each category, items inherit the current item schema and constraints.
          </p>

          <form onSubmit={handleAddCategory} className="card p-4 mb-4">
            <div className="text-[12.5px] font-medium mb-3 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
              <Plus size={13} /> Add a category
            </div>
            {logType.status === 'archived' && (
              <p className="text-[12px] mb-3" style={{ color: 'var(--ink-4)' }}>
                Restore this log type before adding new categories.
              </p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category name (e.g. Plywood)"
                className="input flex-1"
                disabled={logType.status === 'archived'}
              />
              <input
                type="text"
                value={newCatDesc}
                onChange={(e) => setNewCatDesc(e.target.value)}
                placeholder="Description (optional)"
                className="input"
                style={{ width: 220 }}
                disabled={logType.status === 'archived'}
              />
              <button type="submit" disabled={logType.status === 'archived' || addingCat || !newCatName.trim()} className="btn btn-accent shrink-0">
                {addingCat ? 'Adding…' : 'Add'}
              </button>
            </div>
          </form>

          {orderedCategories.length > 0 && (
            <div className="relative mb-4">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--ink-4)' }}
              />
              <input
                type="text"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                placeholder={`Search categories in ${logType.name}…`}
                className="input"
                style={{ paddingLeft: 36 }}
              />
            </div>
          )}

          {orderedCategories.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-4)' }}>No categories yet — add one above.</p>
          ) : visibleCategories.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-4)' }}>No categories match this search.</p>
          ) : (
            <div className="card overflow-hidden">
              {visibleCategories.map((category, index) => (
                <div key={category.id} className="px-4 py-4" style={index > 0 ? { borderTop: '1px solid var(--line-2)' } : {}}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-[13px]" style={{ color: 'var(--ink)' }}>{category.name}</span>
                      {category.status === 'archived' && <span className="chip chip-bad ml-2">Archived</span>}
                      {category.description && (
                        <span className="text-[12px] ml-2" style={{ color: 'var(--ink-4)' }}>{category.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                        {category.entry_count} {category.entry_count === 1 ? 'entry' : 'entries'}
                      </span>
                      {category.status === 'archived' ? (
                        <button
                          onClick={() => void handleRestoreCategory(category.id, category.name)}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Restore category"
                        >
                          <RotateCcw size={12} />
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleArchiveCategory(category.id, category.name)}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Archive category"
                          style={{ color: 'var(--bad)' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl p-4" style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line-2)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>Items</h3>
                        <p className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                          The display name comes from the item field{schemaDisplayNameField ? ` "${schemaDisplayNameField.label}"` : ''}.
                        </p>
                      </div>
                      <span className="chip">{itemsByCategory[category.id]?.length || 0} items</span>
                    </div>

                    {category.status === 'archived' ? (
                      <p className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Restore this category to add or edit items.</p>
                    ) : itemSchema.length === 0 ? (
                      <p className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Define schema fields first before adding items.</p>
                    ) : (
                      <form onSubmit={(e) => void handleAddItem(e, category.id)} className="space-y-3 mb-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {itemSchema.map((field) => (
                            <div key={`${category.id}-${field.field_id}`} className="space-y-1.5">
                              <label className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>
                                {field.label}
                                {field.required && <span className="ml-1" style={{ color: 'var(--bad)' }}>*</span>}
                              </label>
                              <FieldInput
                                field={field}
                                value={(itemDraftsByCategory[category.id] ?? {})[field.field_id]}
                                onChange={(value) => updateItemDraft(category.id, field.field_id, value)}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={addingItemFor === category.id}
                            className="btn btn-accent"
                          >
                            {addingItemFor === category.id ? 'Adding…' : 'Add item'}
                          </button>
                        </div>
                      </form>
                    )}

                    <div className="relative mb-4">
                      <Search
                        size={14}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--ink-4)' }}
                      />
                      <input
                        type="text"
                        value={itemSearchByCategory[category.id] ?? ''}
                        onChange={(e) => setItemSearchByCategory((prev) => ({ ...prev, [category.id]: e.target.value }))}
                        placeholder={`Search items in ${category.name}…`}
                        className="input"
                        style={{ paddingLeft: 36 }}
                      />
                    </div>

                    {(itemsByCategory[category.id] ?? []).length === 0 ? (
                      <p className="text-[12px]" style={{ color: 'var(--ink-4)' }}>No items yet.</p>
                    ) : getVisibleItemsForCategory(
                      itemsByCategory[category.id] ?? [],
                      itemSearchByCategory[category.id] ?? '',
                    ).length === 0 ? (
                      <p className="text-[12px]" style={{ color: 'var(--ink-4)' }}>No items match this search.</p>
                    ) : (
                      <div className="card overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[760px] text-[12.5px]">
                            <thead>
                              <tr style={{ background: 'var(--bg-elev)' }}>
                                <th className="px-3 py-2 text-left eyebrow">Item</th>
                                {itemSchema
                                  .filter((field) => field.field_id !== schemaDisplayNameField?.field_id)
                                  .map((field) => (
                                    <th key={`${category.id}-head-${field.field_id}`} className="px-3 py-2 text-left eyebrow">
                                      {field.label}
                                    </th>
                                  ))}
                                <th className="px-3 py-2 text-right eyebrow">Entries</th>
                                <th className="px-3 py-2 text-right eyebrow">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {getVisibleItemsForCategory(
                                itemsByCategory[category.id] ?? [],
                                itemSearchByCategory[category.id] ?? '',
                              ).map((item) => {
                                const isEditing = editingItemId === item.id
                                return (
                                  <tr key={item.id} style={{ borderTop: '1px solid var(--line-2)' }}>
                                    <td className="px-3 py-3 align-top" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                                      {isEditing ? (
                                        <FieldInput
                                          field={schemaDisplayNameField ?? itemSchema[0]}
                                          value={editingItemValues[(schemaDisplayNameField ?? itemSchema[0]).field_id]}
                                          onChange={(value) => setEditingItemValues((prev) => ({ ...prev, [(schemaDisplayNameField ?? itemSchema[0]).field_id]: value }))}
                                        />
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          <span>{item.name}</span>
                                          {item.status === 'archived' && <span className="chip chip-bad">Archived</span>}
                                        </div>
                                      )}
                                    </td>
                                    {itemSchema
                                      .filter((field) => field.field_id !== schemaDisplayNameField?.field_id)
                                      .map((field) => {
                                        const currentValue = isEditing
                                          ? editingItemValues[field.field_id]
                                          : item.fields.find((entry) => entry.field_id === field.field_id)?.value
                                        return (
                                          <td key={`${item.id}-${field.field_id}`} className="px-3 py-3 align-top" style={{ color: 'var(--ink-3)' }}>
                                            {isEditing ? (
                                              <FieldInput
                                                field={field}
                                                value={currentValue}
                                                onChange={(value) => setEditingItemValues((prev) => ({ ...prev, [field.field_id]: value }))}
                                              />
                                            ) : (
                                              displayValue(currentValue)
                                            )}
                                          </td>
                                        )
                                      })}
                                    <td className="px-3 py-3 text-right align-top" style={{ color: 'var(--ink-4)' }}>
                                      {item.entry_count} {item.entry_count === 1 ? 'entry' : 'entries'}
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                      <div className="flex items-center justify-end gap-1">
                                        {isEditing ? (
                                          <>
                                            <button
                                              onClick={() => void saveEditingItem(item)}
                                              disabled={savingItemId === item.id}
                                              className="btn btn-accent btn-sm"
                                            >
                                              <Check size={12} /> {savingItemId === item.id ? 'Saving…' : 'Save'}
                                            </button>
                                            <button onClick={cancelEditingItem} className="btn btn-ghost btn-sm">
                                              <X size={12} />
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            {item.status === 'archived' ? (
                                              <button
                                                onClick={() => void handleRestoreItem(item.id, item.name)}
                                                className="btn btn-ghost btn-sm btn-icon"
                                                title="Restore item"
                                              >
                                                <RotateCcw size={12} />
                                              </button>
                                            ) : (
                                              <>
                                                <button
                                                  onClick={() => startEditingItem(item)}
                                                  className="btn btn-ghost btn-sm btn-icon"
                                                  title="Edit item"
                                                  disabled={category.status === 'archived'}
                                                >
                                                  <Edit2 size={12} />
                                                </button>
                                                <button
                                                  onClick={() => void handleArchiveItem(item.id, item.name, category.id)}
                                                  className="btn btn-ghost btn-sm btn-icon"
                                                  title="Archive item"
                                                  style={{ color: 'var(--bad)' }}
                                                >
                                                  <Trash2 size={12} />
                                                </button>
                                              </>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {logType.schema_history.length > 1 && (
          <section>
            <h2 className="text-[14px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Schema history</h2>
            <p className="text-[12.5px] mb-4" style={{ color: 'var(--ink-3)' }}>
              Older items and older log entries remain tied to the schema version active when they were created.
            </p>
            <div className="card overflow-hidden">
              {[...logType.schema_history].reverse().map((version, index) => (
                <div key={version.version} className="px-4 py-3" style={index > 0 ? { borderTop: '1px solid var(--line-2)' } : {}}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="chip chip-accent">v{version.version}</span>
                      {version.version === logType.current_version && (
                        <span className="text-[11px] font-medium" style={{ color: 'var(--ok-ink)' }}>Current</span>
                      )}
                    </div>
                    <span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                      {new Date(version.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="space-y-1 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                    <p>Item fields: {version.fields.length > 0 ? version.fields.map((field) => field.label).join(', ') : '—'}</p>
                    <p>Entry fields: {version.entry_fields && version.entry_fields.length > 0 ? version.entry_fields.map((field) => field.label).join(', ') : '—'}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function SchemaEditor({
  drafts,
  onUpdate,
  onRemove,
}: {
  drafts: SchemaDraft[]
  onUpdate: (index: number, patch: Partial<SchemaDraft>) => void
  onRemove: (index: number) => void
}) {
  if (drafts.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-10 text-center">
        <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>No fields yet — click Add field to start.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {drafts.map((field, index) => (
        <div key={field.field_id || index} className="card p-4" style={{ background: 'color-mix(in oklab, var(--bg-elev) 88%, var(--bg-sunken))' }}>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="space-y-1.5 xl:flex-[1.8] xl:min-w-[260px]">
              <label className="text-[11px] font-medium xl:hidden eyebrow">Label</label>
              <input
                type="text"
                value={field.label}
                onChange={(e) => onUpdate(index, { label: e.target.value })}
                placeholder="e.g. Quantity, Vendor Name"
                className="input"
              />
            </div>

            <div className="space-y-1.5 xl:w-40 xl:shrink-0">
              <label className="text-[11px] font-medium xl:hidden eyebrow">Type</label>
              <SearchableSelect
                value={field.field_type}
                onChange={(value) => onUpdate(index, { field_type: value as FieldType, options: value === 'dropdown' ? field.options : '' })}
                options={FIELD_TYPES}
                searchPlaceholder="Search field types…"
              />
            </div>

            <div className="space-y-1.5 xl:flex-[1.2] xl:min-w-[220px]">
              <label className="text-[11px] font-medium xl:hidden eyebrow">Options</label>
              <input
                type="text"
                value={field.options}
                onChange={(e) => onUpdate(index, { options: e.target.value })}
                placeholder={field.field_type === 'dropdown' ? 'Option 1, Option 2, Option 3' : 'Only for dropdown fields'}
                className="input"
                disabled={field.field_type !== 'dropdown'}
                style={field.field_type !== 'dropdown'
                  ? { opacity: 0.55, background: 'var(--bg-sunken)' }
                  : undefined}
              />
            </div>

            <div className="space-y-1.5 xl:w-[120px] xl:shrink-0">
              <label className="text-[11px] font-medium xl:hidden eyebrow">Required</label>
              <label
                className="h-10 px-3 rounded-lg border flex items-center justify-center gap-2 text-[12px] font-medium cursor-pointer transition-colors"
                style={{
                  color: field.required ? 'var(--bad-ink)' : 'var(--ink-3)',
                  background: field.required ? 'var(--bad-wash)' : 'var(--bg-elev)',
                  borderColor: field.required
                    ? 'color-mix(in oklab, var(--bad) 25%, transparent)'
                    : 'var(--line)',
                }}
              >
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => onUpdate(index, { required: e.target.checked })}
                />
                Required
              </label>
            </div>

            <div className="space-y-1.5 xl:w-10 xl:shrink-0">
              <label className="text-[11px] font-medium xl:hidden eyebrow">Remove</label>
              <button type="button" onClick={() => onRemove(index)} className="btn btn-ghost btn-sm btn-icon h-10 w-10" style={{ color: 'var(--ink-4)' }}>
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: SchemaField
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (field.field_type === 'number') {
    return <input type="number" className="input" value={(value as string | number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
  }
  if (field.field_type === 'dropdown') {
    return (
      <SearchableSelect
        value={(value as string) ?? ''}
        onChange={onChange}
        options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
        placeholder="Select…"
        searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
      />
    )
  }
  if (field.field_type === 'date') {
    return <DatePicker value={(value as string) ?? ''} onChange={onChange} />
  }
  if (field.field_type === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>Yes</span>
      </label>
    )
  }
  return <input type="text" className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
}

function toSchemaDraft(field: SchemaField): SchemaDraft {
  return {
    field_id: field.field_id,
    label: field.label,
    field_type: field.field_type,
    required: field.required,
    options: field.options?.join(', ') || '',
    added_at: field.added_at,
  }
}

function toSchemaFieldPayload(field: SchemaDraft): SchemaField {
  return {
    field_id: field.field_id ?? '',
    label: field.label.trim(),
    field_type: field.field_type,
    required: field.required,
    options: field.field_type === 'dropdown'
      ? field.options.split(',').map((option) => option.trim()).filter(Boolean)
      : undefined,
    added_at: field.added_at ?? new Date().toISOString(),
  }
}

function getItemSchema(logType?: LogType | null): SchemaField[] {
  return logType?.current_schema ?? []
}

function getEffectiveCostMode(logType?: LogType | null): LogCostMode {
  if (!logType) return 'manual_total'
  if (logType.cost_mode) return logType.cost_mode
  const itemSchema = getItemSchema(logType)
  const entrySchema = getEntrySchema(logType)
  if (itemSchema.some((field) => isUnitCostLabel(field.label)) || entrySchema.some((field) => isUnitCostLabel(field.label))) {
    return 'quantity_x_unit_cost'
  }
  if (entrySchema.some((field) => isDirectAmountLabel(field.label))) {
    return 'direct_amount'
  }
  return 'manual_total'
}

function getEntrySchema(logType?: LogType | null): SchemaField[] {
  if (!logType) return []
  if (logType.uses_split_schema) return logType.current_entry_schema ?? []
  return logType.current_schema ?? []
}

function costModeLabel(costMode: LogCostMode): string {
  return COST_MODES.find((mode) => mode.value === costMode)?.label ?? 'Manual total'
}

function initialItemDraft(schema: SchemaField[]): Record<string, unknown> {
  return Object.fromEntries(schema.map((field) => [field.field_id, field.field_type === 'boolean' ? false : '']))
}

function normalizeFieldDraftValue(field: SchemaField, value: unknown): unknown {
  if (field.field_type === 'boolean') return !!value
  if (value === '') return null
  return value ?? null
}

function findItemSelectorField(schema: SchemaField[]): SchemaField | null {
  for (const field of schema) {
    const label = field.label.toLowerCase().trim()
    if (label === 'name' || label.includes('name') || label.includes('item') || label.includes('material')) return field
  }
  return schema.find((field) => field.field_type === 'text' || field.field_type === 'dropdown') ?? null
}

function validateSchemaForCostMode(costMode: LogCostMode, entryFields: SchemaDraft[]): string | null {
  const normalizedLabels = entryFields.map((field) => field.label.trim().toLowerCase())
  if (costMode === 'quantity_x_unit_cost') {
    if (normalizedLabels.some((label) => isQuantityLabel(label))) {
      return 'Quantity is already handled by this cost mode, so do not add it as a daily entry field.'
    }
    if (normalizedLabels.some((label) => isTotalCostLabel(label))) {
      return 'Total cost is already computed by this cost mode, so do not add it as a daily entry field.'
    }
  }
  if (costMode === 'direct_amount' && normalizedLabels.some((label) => isTotalCostLabel(label))) {
    return 'Total cost is derived from the daily amount field in this cost mode, so do not add a separate total cost field.'
  }
  return null
}

function isQuantityLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return normalized === 'quantity' || normalized === 'qty' || normalized.includes('quantity') || normalized.includes('qty')
}

function isTotalCostLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return normalized === 'total' || normalized === 'total cost' || normalized.includes('total cost')
}

function isUnitCostLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return normalized === 'cost' || normalized.includes('unit cost') || normalized.includes('cost per unit') || normalized.includes('rate') || normalized.includes('price')
}

function isDirectAmountLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return normalized.includes('daily cost') || normalized.includes('daily payment') || normalized.includes('payment') || normalized.includes('amount paid') || normalized.includes('wage') || normalized.includes('charges')
}

function displayValue(value: unknown): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  if (value == null || value === '') return '—'
  return String(value)
}

function filterItemsForCategory(items: LogItem[], query: string): LogItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items

  return items.filter((item) => {
    const haystack = [
      item.name,
      ...item.fields.map((field) => `${field.label} ${displayValue(field.value)}`),
    ].join(' ').toLowerCase()
    return haystack.includes(normalized)
  })
}

function filterCategories(categories: LogCategory[], query: string): LogCategory[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return categories

  return categories.filter((category) => {
    const haystack = `${category.name} ${category.description ?? ''}`.toLowerCase()
    return haystack.includes(normalized)
  })
}

function getVisibleItemsForCategory(items: LogItem[], query: string): LogItem[] {
  return sortArchivedItemsLast(filterItemsForCategory(items, query))
}

function sortArchivedCategoriesLast(categories: LogCategory[]): LogCategory[] {
  return [...categories].sort((a, b) => {
    const archivedDelta = Number(a.status === 'archived') - Number(b.status === 'archived')
    if (archivedDelta !== 0) return archivedDelta
    return a.name.localeCompare(b.name)
  })
}

function sortArchivedItemsLast(items: LogItem[]): LogItem[] {
  return [...items].sort((a, b) => {
    const archivedDelta = Number(a.status === 'archived') - Number(b.status === 'archived')
    if (archivedDelta !== 0) return archivedDelta
    return a.name.localeCompare(b.name)
  })
}
