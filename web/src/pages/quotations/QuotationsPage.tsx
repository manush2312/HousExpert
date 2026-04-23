import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, FileText } from 'lucide-react'
import { listQuotations, type Quotation, type QuotationStatus } from '../../services/quotationService'

const STATUS_OPTIONS: { value: 'all' | QuotationStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
]

export default function QuotationsPage() {
  const navigate = useNavigate()
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | QuotationStatus>('all')

  const fetch = async () => {
    try {
      setLoading(true)
      const res = await listQuotations()
      setQuotations(res.data.data.quotations)
      setTotal(res.data.data.total)
    } catch {
      // backend may not be running
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() }, [])

  const filtered = useMemo(() => {
    return quotations.filter((qt) => {
      if (statusFilter !== 'all' && qt.status !== statusFilter) return false
      if (q && !(
        qt.quotation_id.toLowerCase().includes(q.toLowerCase()) ||
        qt.client_name.toLowerCase().includes(q.toLowerCase()) ||
        (qt.client_location ?? '').toLowerCase().includes(q.toLowerCase())
      )) return false
      return true
    })
  }, [quotations, q, statusFilter])

  const kpis = useMemo(() => {
    const totalQuoted = quotations.reduce((s, q) => s + q.total_amount, 0)
    const accepted = quotations.filter((q) => q.status === 'accepted')
    const acceptedValue = accepted.reduce((s, q) => s + q.total_amount, 0)
    const sent = quotations.filter((q) => q.status === 'sent' || q.status === 'accepted' || q.status === 'rejected')
    const winRate = sent.length > 0 ? Math.round((accepted.length / sent.length) * 100) : 0
    const open = quotations.filter((q) => q.status === 'draft' || q.status === 'sent').length
    return { totalQuoted, acceptedValue, winRate, open }
  }, [quotations])

  return (
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-7">
        <div>
          <div className="eyebrow mb-1">Sales</div>
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Quotations
          </h1>
          <p className="text-[13.5px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
            {loading ? 'Loading…' : `${total} quotation${total !== 1 ? 's' : ''} total`}
          </p>
        </div>
        <button onClick={() => navigate('/quotations/new')} className="btn btn-accent shrink-0">
          <Plus size={15} />
          New quotation
        </button>
      </div>

      {/* KPI strip */}
      {!loading && quotations.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
          <KpiCard label="Total quoted" value={fmtAmount(kpis.totalQuoted)} sub="across all quotations" />
          <KpiCard label="Accepted value" value={fmtAmount(kpis.acceptedValue)} sub="converted to projects" tone="ok" />
          <KpiCard label="Win rate" value={`${kpis.winRate}%`} sub="of sent quotations" tone="warn" />
          <KpiCard label="Open" value={String(kpis.open)} sub="draft + sent" />
        </div>
      )}

      {/* Toolbar */}
      <div className="card px-3 py-2.5 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-55">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--ink-4)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by client, ID or location…"
            className="input h-8"
            style={{ paddingLeft: 32 }}
          />
        </div>

        <div className="inline-flex items-center p-0.5 rounded-lg" style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className="px-2.5 h-6 text-[11.5px] rounded-md font-medium transition-all"
              style={statusFilter === s.value
                ? { background: 'var(--bg-elev)', color: 'var(--ink)', boxShadow: 'var(--shadow-sm)' }
                : { color: 'var(--ink-3)' }
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{filtered.length} results</span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="card overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: '1px solid var(--line-2)' }}>
              <div className="skeleton h-4 w-20" />
              <div className="skeleton h-4 w-36" />
              <div className="skeleton h-4 w-24 ml-auto" />
              <div className="skeleton h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
            <FileText size={22} />
          </div>
          <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>
            {q || statusFilter !== 'all' ? 'No quotations match' : 'No quotations yet'}
          </p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
            {q || statusFilter !== 'all' ? 'Try clearing your filters.' : 'Create your first quotation for a client.'}
          </p>
          {!q && statusFilter === 'all' && (
            <button onClick={() => navigate('/quotations/new')} className="btn btn-accent mt-5">
              <Plus size={15} /> New quotation
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-175 text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg-sunken)' }}>
                {['No.', 'Client', 'Location', 'Items', 'Total', 'Date', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left eyebrow">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((qt) => {
                const itemCount = qt.sections.reduce((n, s) => n + s.items.length, 0)
                return (
                  <tr
                    key={qt.quotation_id}
                    onClick={() => navigate(`/quotations/${qt.quotation_id}`)}
                    className="cursor-pointer group hover-bg transition-colors"
                    style={{ borderTop: '1px solid var(--line-2)' }}
                  >
                    <td className="px-4 py-3 numeral text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                      {qt.quotation_id}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: 'var(--ink)' }}>{qt.client_name}</div>
                      {qt.client_phone && (
                        <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--ink-4)' }}>{qt.client_phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: qt.client_location ? 'var(--ink-3)' : 'var(--ink-5)' }}>
                      {qt.client_location || '—'}
                    </td>
                    <td className="px-4 py-3 numeral text-[12px]" style={{ color: 'var(--ink-3)' }}>
                      {itemCount} item{itemCount !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3 numeral text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                      {qt.total_amount > 0 ? fmtAmount(qt.total_amount) : '—'}
                    </td>
                    <td className="px-4 py-3 numeral text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                      {new Date(qt.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={qt.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {qt.converted_project_id && (
                        <span className="text-[11px]" style={{ color: 'var(--ok-ink)' }}>Converted</span>
                      )}
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
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, tone = 'accent' }: { label: string; value: string; sub: string; tone?: 'accent' | 'ok' | 'warn' }) {
  const colors: Record<string, string> = { accent: 'var(--accent-ink)', ok: 'var(--ok-ink)', warn: 'var(--warn-ink)' }
  const bgs: Record<string, string> = { accent: 'var(--accent-wash)', ok: 'var(--ok-wash)', warn: 'var(--warn-wash)' }
  return (
    <div className="card px-4 py-3.5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="text-[22px] font-semibold numeral leading-none" style={{ color: colors[tone] ?? colors.accent, background: bgs[tone] ?? 'transparent', borderRadius: 6, display: 'inline-block', padding: '2px 6px' }}>
        {value}
      </div>
      <div className="text-[11.5px] mt-2" style={{ color: 'var(--ink-4)' }}>{sub}</div>
    </div>
  )
}

// ── Status Pill ───────────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: QuotationStatus }) {
  const map: Record<QuotationStatus, { bg: string; text: string; dot: string; label: string }> = {
    draft:    { bg: 'var(--bg-sunken)',  text: 'var(--ink-3)',    dot: 'var(--ink-4)',  label: 'Draft' },
    sent:     { bg: 'var(--accent-wash)', text: 'var(--accent-ink)', dot: 'var(--accent)', label: 'Sent' },
    accepted: { bg: 'var(--ok-wash)',    text: 'var(--ok-ink)',   dot: 'var(--ok)',     label: 'Accepted' },
    rejected: { bg: 'var(--bad-wash)',   text: 'var(--bad-ink)',  dot: 'var(--bad)',    label: 'Rejected' },
    expired:  { bg: 'var(--bg-sunken)',  text: 'var(--ink-4)',    dot: 'var(--ink-5)',  label: 'Expired' },
  }
  const s = map[status] ?? map.draft
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function fmtAmount(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)} Cr`
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)} L`
  return `₹${n.toLocaleString('en-IN')}`
}
