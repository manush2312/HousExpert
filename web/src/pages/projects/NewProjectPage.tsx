import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Info } from 'lucide-react'
import { createProject } from '../../services/projectService'

const BHK_TYPES = ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK', 'Villa', 'Penthouse']

export default function NewProjectPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: searchParams.get('name') ?? '',
    lead: searchParams.get('lead') ?? '',
    clientName: searchParams.get('client_name') ?? '',
    clientPhone: searchParams.get('client_phone') ?? '',
    line1: '', line2: '',
    city: '', state: '', pincode: '',
    bhkTypes: [] as string[],
    floors: '', units: '', budget: '',
  })

  const update = (k: keyof typeof form, v: string | string[]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const toggleBHK = (t: string) =>
    update('bhkTypes', form.bhkTypes.includes(t) ? form.bhkTypes.filter((x) => x !== t) : [...form.bhkTypes, t])

  const canSubmit = form.name && form.line1 && form.city && form.state && form.pincode

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError('')
    setLoading(true)
    try {
      const res = await createProject({
        name: form.name,
        address: {
          line1: form.line1,
          line2: form.line2 || undefined,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
        },
        bhk_configs: form.bhkTypes.map((t) => ({ bhk_type: t, floor_plans: [] })),
        lead: form.lead || undefined,
        client_name: form.clientName || undefined,
        client_phone: form.clientPhone || undefined,
        units: form.units ? Number(form.units) : undefined,
        floors: form.floors ? Number(form.floors) : undefined,
        budget: form.budget ? Number(form.budget) : undefined,
      })
      navigate(`/projects/${res.data.data.project_id}`)
    } catch {
      setError('Failed to create project. Please try again.')
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
        <span className="font-medium" style={{ color: 'var(--ink)' }}>New project</span>
      </div>

      <div className="mb-1 eyebrow">Create</div>
      <h1 className="text-[26px] font-semibold tracking-tight numeral mb-1.5" style={{ color: 'var(--ink)' }}>New project</h1>
      <p className="text-[13.5px] mb-8" style={{ color: 'var(--ink-3)' }}>
        Projects are the top-level container for daily logs, floor plans, and team activity.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          {/* Form */}
          <div className="space-y-7">
            <FormSection title="Basics" description="Give the project a name. Everything else can be added later.">
              <FormField label="Project name" required>
                <input className="input input-lg" placeholder="e.g. Sobha Emerald Heights" value={form.name} onChange={(e) => update('name', e.target.value)} />
              </FormField>
              <FormField label="Project lead">
                <input className="input" placeholder="Who owns this site?" value={form.lead} onChange={(e) => update('lead', e.target.value)} />
              </FormField>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Client name">
                  <input className="input" placeholder="Primary client contact" value={form.clientName} onChange={(e) => update('clientName', e.target.value)} />
                </FormField>
                <FormField label="Client phone">
                  <input className="input" placeholder="e.g. 9876543210" value={form.clientPhone} onChange={(e) => update('clientPhone', e.target.value)} />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Site address" description="Used for locale, tax, and supplier radius.">
              <FormField label="Street / building" required>
                <input className="input" placeholder="Plot, street, building" value={form.line1} onChange={(e) => update('line1', e.target.value)} />
              </FormField>
              <FormField label="Area / landmark" hint="optional">
                <input className="input" placeholder="Neighbourhood, landmark" value={form.line2} onChange={(e) => update('line2', e.target.value)} />
              </FormField>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="City" required>
                  <input className="input" placeholder="Bengaluru" value={form.city} onChange={(e) => update('city', e.target.value)} />
                </FormField>
                <FormField label="State" required>
                  <input className="input" placeholder="Karnataka" value={form.state} onChange={(e) => update('state', e.target.value)} />
                </FormField>
                <FormField label="Pincode" required>
                  <input className="input" placeholder="560001" value={form.pincode} onChange={(e) => update('pincode', e.target.value)} />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Configuration" description="Select the BHK types offered at this project. You can upload floor plans for each later.">
              <FormField label="BHK mix">
                <div className="flex flex-wrap gap-2">
                  {BHK_TYPES.map((t) => {
                    const active = form.bhkTypes.includes(t)
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleBHK(t)}
                        className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12.5px] font-medium transition-colors"
                        style={{
                          background: active ? 'var(--ink)' : 'var(--bg-elev)',
                          color: active ? 'var(--bg-elev)' : 'var(--ink-2)',
                          border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`,
                        }}
                      >
                        {active && <Check size={12} />}
                        {t}
                      </button>
                    )
                  })}
                </div>
              </FormField>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Floors">
                  <input type="number" className="input" placeholder="0" value={form.floors} onChange={(e) => update('floors', e.target.value)} />
                </FormField>
                <FormField label="Total units">
                  <input type="number" className="input" placeholder="0" value={form.units} onChange={(e) => update('units', e.target.value)} />
                </FormField>
                <FormField label="Budget" hint="INR amount">
                  <input type="number" className="input" placeholder="0.00" step="0.01" value={form.budget} onChange={(e) => update('budget', e.target.value)} />
                </FormField>
              </div>
            </FormSection>

            {error && (
              <p className="text-[13px] px-4 py-2.5 rounded-lg" style={{ background: 'var(--bad-wash)', color: 'var(--bad-ink)' }}>
                {error}
              </p>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button type="submit" disabled={!canSubmit || loading} className="btn btn-accent">
                {loading ? 'Creating…' : 'Create project'}
              </button>
              <button type="button" onClick={() => navigate('/projects')} className="btn btn-ghost">Cancel</button>
              <span className="ml-auto text-[11.5px] flex items-center gap-1.5" style={{ color: 'var(--ink-4)' }}>
                <Info size={12} /> You can edit any of this later.
              </span>
            </div>
          </div>

          {/* Preview */}
          <div className="lg:sticky lg:top-20 self-start">
            <div className="eyebrow mb-2">Preview</div>
            <div className="card p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div
                className="h-28 -mx-4 -mt-4 mb-4 relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, var(--accent-wash), var(--bg-sunken))', borderRadius: '13px 13px 0 0', borderBottom: '1px solid var(--line)' }}
              >
                <div className="absolute inset-0 bg-blueprint opacity-30" />
                <div className="absolute top-2.5 left-3 right-3 flex items-start justify-between">
                  <span className="numeral text-[10px]" style={{ color: 'var(--ink-3)' }}>PRJ-NEW</span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'var(--ok-wash)', color: 'var(--ok-ink)' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ok)' }} />Active
                  </span>
                </div>
              </div>
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{form.name || 'Untitled project'}</h3>
              <p className="text-[12px] mt-1" style={{ color: 'var(--ink-3)' }}>{form.city || 'City'}, {form.state || 'State'}</p>
              {(form.clientName || form.clientPhone) && (
                <div className="mt-3 space-y-1 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                  {form.clientName && <p>Client: <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{form.clientName}</span></p>}
                  {form.clientPhone && <p>Phone: <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{form.clientPhone}</span></p>}
                </div>
              )}
              {form.bhkTypes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {form.bhkTypes.map((t) => (
                    <span key={t} className="text-[10.5px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}>{t}</span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-4 pt-3 text-[11px]" style={{ borderTop: '1px solid var(--line-2)', color: 'var(--ink-4)' }}>
                <span>{form.units || '0'} units · {form.floors || '0'} floors</span>
                {form.budget && <span className="numeral font-medium" style={{ color: 'var(--ink-2)' }}>₹{form.budget}</span>}
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl" style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line-2)' }}>
              <div className="text-[12px] font-medium mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                What happens next
              </div>
              <ol className="text-[12px] space-y-1 list-decimal pl-4" style={{ color: 'var(--ink-3)' }}>
                <li>Project is created with its own ID</li>
                <li>Upload floor plans per BHK type</li>
                <li>Invite your site team &amp; start logging</li>
              </ol>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
