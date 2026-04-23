import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { Plus, X } from 'lucide-react'
import SearchableSelect from '../../components/SearchableSelect'
import { createLogType, type FieldType, type LogCostMode } from '../../services/logService'

interface FieldDraft {
  label: string
  field_type: FieldType
  required: boolean
  options: string
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',     label: 'Text' },
  { value: 'number',   label: 'Number' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'date',     label: 'Date' },
  { value: 'boolean',  label: 'Yes / No' },
]

const emptyField = (): FieldDraft => ({ label: '', field_type: 'text', required: false, options: '' })

const COST_MODES: { value: LogCostMode; label: string; description: string }[] = [
  { value: 'quantity_x_unit_cost', label: 'Quantity x unit cost', description: 'Best for materials. The form uses shared quantity and computes total cost from the selected item or entry rate.' },
  { value: 'direct_amount', label: 'Direct amount', description: 'Best for labour-style payments. The form uses a daily amount field and shows that amount as total cost.' },
  { value: 'manual_total', label: 'Manual total', description: 'Use when the team should enter total cost directly in the daily-entry schema.' },
]

export default function NewLogTypePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [itemFields, setItemFields] = useState<FieldDraft[]>([])
  const [entryFields, setEntryFields] = useState<FieldDraft[]>([])
  const [costMode, setCostMode] = useState<LogCostMode>('quantity_x_unit_cost')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const addField = (target: 'item' | 'entry') => {
    const setter = target === 'item' ? setItemFields : setEntryFields
    setter((prev) => [...prev, emptyField()])
  }
  const removeField = (target: 'item' | 'entry', index: number) => {
    const setter = target === 'item' ? setItemFields : setEntryFields
    setter((prev) => prev.filter((_, current) => current !== index))
  }
  const updateField = (target: 'item' | 'entry', index: number, patch: Partial<FieldDraft>) => {
    const setter = target === 'item' ? setItemFields : setEntryFields
    setter((prev) => prev.map((field, current) => (current === index ? { ...field, ...patch } : field)))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    const allFields = [...itemFields, ...entryFields]
    const emptyField = allFields.find((f) => !f.label.trim())
    if (emptyField) { setError('Every schema field needs a label'); return }
    const dropdownWithoutOptions = allFields.find((f) => f.field_type === 'dropdown' && !f.options.trim())
    if (dropdownWithoutOptions) { setError('Dropdown fields need at least one option'); return }
    const schemaValidationError = validateSchemaForCostMode(costMode, entryFields)
    if (schemaValidationError) { setError(schemaValidationError); return }
    setLoading(true)
    try {
      const res = await createLogType({
        name: name.trim(),
        item_fields: itemFields.map(toFieldPayload),
        entry_fields: entryFields.map(toFieldPayload),
        cost_mode: costMode,
      })
      navigate(`/log-types/${res.data.data.id}`)
    } catch (err) {
      if (isAxiosError(err)) {
        const message = typeof err.response?.data?.error === 'string'
          ? err.response.data.error
          : typeof err.response?.data?.message === 'string'
            ? err.response.data.message
            : err.message
        if (message?.includes('duplicate key')) {
          setError('A log type with this name already exists')
        } else {
          setError(message || 'Failed to create log type')
        }
      } else {
        setError('Failed to create log type')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full px-8 py-7">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ink-3)' }}>
        <button onClick={() => navigate('/log-types')} className="hover:underline">Log Types</button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>New log type</span>
      </div>

      <div className="eyebrow mb-1">Create</div>
      <h1 className="text-[26px] font-semibold tracking-tight numeral mb-1.5" style={{ color: 'var(--ink)' }}>New log type</h1>
      <p className="text-[13.5px] mb-8" style={{ color: 'var(--ink-3)' }}>
        A log type defines a category of daily logging (e.g. "Material"). Fields are the columns your team fills in per entry.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="max-w-5xl space-y-7">
          {/* Name */}
          <FormSection title="Details" description="Give your log type a clear, recognisable name.">
            <FormField label="Log type name" required>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Material, Labour, Transportation"
                className="input input-lg"
              />
            </FormField>
            <FormField label="Cost mode" required hint="Controls how total cost is calculated">
              <SearchableSelect
                value={costMode}
                onChange={(value) => setCostMode(value as LogCostMode)}
                options={COST_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                searchPlaceholder="Search cost modes…"
              />
              <p className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
                {COST_MODES.find((mode) => mode.value === costMode)?.description}
              </p>
            </FormField>
          </FormSection>

          <FormSection title="Item fields" description="These define the saved master record under a category. Examples: labour name, contact number, raw material supplier, cost per unit.">
            <SchemaBuilder
              fields={itemFields}
              onAdd={() => addField('item')}
              onRemove={(index) => removeField('item', index)}
              onUpdate={(index, patch) => updateField('item', index, patch)}
              emptyTitle="Add your first item field"
              emptyHint="e.g. Name, Contact Number, Supplier, Cost per unit"
            />
          </FormSection>

          <FormSection title="Daily entry fields" description="These are filled when your team logs a daily entry. Examples: daily payment, hours worked, work done, remarks. Shared system fields like quantity or total cost should not be added here when the selected cost mode already handles them.">
            <SchemaBuilder
              fields={entryFields}
              onAdd={() => addField('entry')}
              onRemove={(index) => removeField('entry', index)}
              onUpdate={(index, patch) => updateField('entry', index, patch)}
              emptyTitle="Add your first daily entry field"
              emptyHint="Leave this empty if quantity and notes are enough for this log type"
            />
          </FormSection>

          {error && (
            <p className="text-[13px] px-4 py-2.5 rounded-lg" style={{ background: 'var(--bad-wash)', color: 'var(--bad-ink)' }}>
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button type="submit" disabled={loading || !name.trim()} className="btn btn-accent">
              {loading ? 'Creating…' : 'Create log type'}
            </button>
            <button type="button" onClick={() => navigate('/log-types')} className="btn btn-ghost">Cancel</button>
          </div>
        </div>
      </form>
    </div>
  )
}

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

function SchemaBuilder({
  fields,
  onAdd,
  onRemove,
  onUpdate,
  emptyTitle,
  emptyHint,
}: {
  fields: FieldDraft[]
  onAdd: () => void
  onRemove: (index: number) => void
  onUpdate: (index: number, patch: Partial<FieldDraft>) => void
  emptyTitle: string
  emptyHint: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
          {fields.length > 0 ? `${fields.length} field${fields.length !== 1 ? 's' : ''} defined` : 'No fields yet'}
        </span>
        <button type="button" onClick={onAdd} className="btn btn-outline btn-sm">
          <Plus size={13} /> Add field
        </button>
      </div>

      {fields.length === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          className="w-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 text-center transition-colors hover-bg"
          style={{ borderColor: 'var(--line)', background: 'var(--bg-sunken)' }}
        >
          <Plus size={16} style={{ color: 'var(--ink-4)' }} />
          <span className="text-[12.5px] font-medium mt-2" style={{ color: 'var(--ink-3)' }}>{emptyTitle}</span>
          <span className="text-[11px] mt-0.5" style={{ color: 'var(--ink-4)' }}>{emptyHint}</span>
        </button>
      ) : (
        <div className="space-y-2">
          <div
            className="hidden lg:grid gap-3 px-4 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{
              color: 'var(--ink-4)',
              gridTemplateColumns: 'minmax(0, 1.7fr) 150px minmax(0, 1.2fr) 110px 40px',
            }}
          >
            <span>Label</span>
            <span>Type</span>
            <span>Options</span>
            <span>Required</span>
            <span />
          </div>
          {fields.map((field, index) => (
            <div
              key={index}
              className="card p-4"
              style={{ background: 'color-mix(in oklab, var(--bg-elev) 88%, var(--bg-sunken))' }}
            >
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
                    onChange={(value) => onUpdate(index, { field_type: value as FieldType })}
                    options={FIELD_TYPES}
                    searchPlaceholder="Search field types…"
                  />
                </div>

                <div className="space-y-1.5 xl:flex-[1.2] xl:min-w-[220px]">
                  <label className="text-[11px] font-medium xl:hidden eyebrow">
                    Options
                    <span className="normal-case font-normal ml-1" style={{ color: 'var(--ink-4)' }}>
                      (dropdown only)
                    </span>
                  </label>
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
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="btn btn-ghost btn-sm btn-icon h-10 w-10"
                    style={{ color: 'var(--ink-4)' }}
                    title="Remove field"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function toFieldPayload(field: FieldDraft) {
  return {
    label: field.label.trim(),
    field_type: field.field_type,
    required: field.required,
    options: field.field_type === 'dropdown'
      ? field.options.split(',').map((option) => option.trim()).filter(Boolean)
      : undefined,
  }
}

function validateSchemaForCostMode(costMode: LogCostMode, entryFields: FieldDraft[]): string | null {
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
  return label === 'quantity' || label === 'qty' || label.includes('quantity') || label.includes('qty')
}

function isTotalCostLabel(label: string): boolean {
  return label === 'total' || label === 'total cost' || label.includes('total cost')
}
