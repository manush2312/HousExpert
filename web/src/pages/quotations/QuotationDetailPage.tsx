import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Download, Pencil, Send, ThumbsUp, ThumbsDown, Trash2, FolderOpen } from 'lucide-react'
import {
  getQuotation, updateQuotationStatus, deleteQuotation,
  type Quotation, type QuotationStatus,
} from '../../services/quotationService'
import { StatusPill, fmtAmount } from './QuotationsPage'
import api from '../../services/api'

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    getQuotation(id)
      .then((r) => setQuotation(r.data.data))
      .catch(() => navigate('/quotations'))
      .finally(() => setLoading(false))
  }, [id, navigate])

  const transition = async (status: QuotationStatus) => {
    if (!quotation) return
    setActionLoading(true)
    try {
      const res = await updateQuotationStatus(quotation.quotation_id, status)
      setQuotation(res.data.data)
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!quotation || !confirm('Delete this draft quotation? This cannot be undone.')) return
    await deleteQuotation(quotation.quotation_id)
    navigate('/quotations')
  }

  const handleExportPDF = async () => {
    if (!quotation) return
    setExportLoading(true)
    try {
      const res = await api.get(`/quotations/${quotation.quotation_id}/export`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      const safeName = quotation.client_name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '')
      const dateStr = new Date(quotation.created_at).toISOString().slice(0, 10)
      a.download = `${quotation.quotation_id}-${safeName}-${dateStr}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      alert('PDF export failed — check that the backend is running.')
    } finally {
      setExportLoading(false)
    }
  }

  const handleConvertToProject = () => {
    if (!quotation) return
    // Pre-fill the new project form via URL search params
    const params = new URLSearchParams({
      from_quotation: quotation.quotation_id,
      name: `${quotation.client_name} — ${quotation.client_location ?? 'Project'}`,
      lead: quotation.client_name,
      client_name: quotation.client_name,
      client_phone: quotation.client_phone ?? '',
    })
    navigate(`/projects/new?${params.toString()}`)
  }

  if (loading) {
    return (
      <div className="w-full px-8 py-7 space-y-4">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-7 w-64" />
        <div className="skeleton h-40 w-full mt-4" />
      </div>
    )
  }
  if (!quotation) return null

  const itemCount = quotation.sections.reduce((n, s) => n + s.items.length, 0)
  const isEditable = quotation.status === 'draft'

  return (
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ink-3)' }}>
        <button onClick={() => navigate('/quotations')} className="hover:underline">Quotations</button>
        <span style={{ color: 'var(--ink-4)' }}>›</span>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>{quotation.quotation_id}</span>
      </div>

      {/* Hero */}
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <StatusPill status={quotation.status} />
            <span className="numeral text-[11px]" style={{ color: 'var(--ink-4)' }}>{quotation.quotation_id}</span>
            {quotation.converted_project_id && (
              <button
                onClick={() => navigate(`/projects/${quotation.converted_project_id}`)}
                className="flex items-center gap-1 text-[11.5px] font-medium"
                style={{ color: 'var(--ok-ink)' }}
              >
                <FolderOpen size={12} />
                {quotation.converted_project_id}
              </button>
            )}
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            {quotation.client_name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[13px]" style={{ color: 'var(--ink-3)' }}>
            {quotation.client_phone && <span>{quotation.client_phone}</span>}
            {quotation.client_location && (
              <>
                {quotation.client_phone && <span style={{ color: 'var(--ink-5)' }}>·</span>}
                <span>{quotation.client_location}</span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button onClick={handleExportPDF} disabled={exportLoading} className="btn btn-outline">
            <Download size={14} /> {exportLoading ? 'Exporting…' : 'Download PDF'}
          </button>
          {isEditable && (
            <button onClick={() => navigate(`/quotations/${quotation.quotation_id}/edit`)} className="btn btn-outline">
              <Pencil size={14} /> Edit
            </button>
          )}
          {quotation.status === 'draft' && (
            <button onClick={() => transition('sent')} disabled={actionLoading} className="btn btn-outline">
              <Send size={14} /> Mark sent
            </button>
          )}
          {quotation.status === 'sent' && (
            <>
              <button onClick={() => transition('accepted')} disabled={actionLoading} className="btn btn-outline" style={{ color: 'var(--ok-ink)', borderColor: 'var(--ok)' }}>
                <ThumbsUp size={14} /> Accept
              </button>
              <button onClick={() => transition('rejected')} disabled={actionLoading} className="btn btn-outline" style={{ color: 'var(--bad-ink)', borderColor: 'var(--bad)' }}>
                <ThumbsDown size={14} /> Reject
              </button>
            </>
          )}
          {quotation.status === 'accepted' && !quotation.converted_project_id && (
            <button onClick={handleConvertToProject} className="btn btn-accent">
              <ArrowRight size={14} /> Convert to project
            </button>
          )}
          {isEditable && (
            <button onClick={handleDelete} className="btn btn-ghost" style={{ color: 'var(--bad)' }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="card px-4 py-3">
          <div className="eyebrow mb-1.5">Total amount</div>
          <div className="text-[20px] font-semibold numeral" style={{ color: 'var(--ink)' }}>
            {fmtAmount(quotation.total_amount)}
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="eyebrow mb-1.5">Sections</div>
          <div className="text-[20px] font-semibold numeral" style={{ color: 'var(--ink)' }}>
            {quotation.sections.length}
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="eyebrow mb-1.5">Line items</div>
          <div className="text-[20px] font-semibold numeral" style={{ color: 'var(--ink)' }}>
            {itemCount}
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="eyebrow mb-1.5">Created</div>
          <div className="text-[13px] font-medium" style={{ color: 'var(--ink-2)' }}>
            {new Date(quotation.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Line items table — one card per section */}
      <div className="space-y-4">
        {quotation.sections.map((sec) => {
          const secTotal = sec.items.reduce((s, i) => s + i.amount, 0)
          return (
            <div key={sec.section_id} className="card overflow-hidden">
              {/* Section header */}
              <div className="flex items-center justify-between px-5 py-3" style={{ background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line)' }}>
                <h3 className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>{sec.room_name}</h3>
                <span className="numeral text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
                  {fmtINR(secTotal)}
                </span>
              </div>

              {/* Scrollable table */}
              <div className="overflow-x-auto">
                {/* Column headers */}
                <div
                  className="grid px-5 py-2 text-[10.5px] font-semibold uppercase tracking-wider gap-3"
                  style={{ color: 'var(--ink-4)', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line-2)', gridTemplateColumns: '24px 2fr 80px 60px 60px 90px 1fr 100px', minWidth: 660 }}
                >
                  <span>#</span>
                  <span>Description</span>
                  <span>Size (inches)</span>
                  <span>Sq.Ft</span>
                  <span>Qty</span>
                  <span>Rate</span>
                  <span>Note</span>
                  <span className="text-right">Amount</span>
                </div>

                {/* Rows */}
                {sec.items.map((item, idx) => (
                  <div
                    key={item.item_id}
                    className="grid px-5 py-2.5 gap-3 text-[12.5px]"
                    style={{ gridTemplateColumns: '24px 2fr 80px 60px 60px 90px 1fr 100px', borderBottom: '1px solid var(--line-2)', color: 'var(--ink-2)', minWidth: 660 }}
                  >
                    <span className="numeral text-[11px]" style={{ color: 'var(--ink-5)' }}>{idx + 1}</span>
                    <div className="min-w-0">
                      <div className="font-medium" style={{ color: 'var(--ink)' }}>{item.description}</div>
                      {item.use_quantity_rate && (
                        <span className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
                          Qty x rate
                        </span>
                      )}
                    </div>
                    <span className="numeral">{item.size || '—'}</span>
                    <span className="numeral">{item.sqft != null ? item.sqft : '—'}</span>
                    <span className="numeral">{item.qty}</span>
                    <span className="numeral">₹{item.rate.toLocaleString('en-IN')}</span>
                    <span style={{ color: 'var(--ink-4)' }}>{item.note || '—'}</span>
                    <span className="numeral text-right font-medium" style={{ color: item.amount > 0 ? 'var(--ink)' : 'var(--ink-5)' }}>
                      {item.amount > 0 ? fmtINR(item.amount) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Grand total footer */}
      <div className="mt-4 card px-5 py-4 flex items-center justify-between">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-3)' }}>Grand Total</span>
        <span className="numeral text-[20px] font-semibold" style={{ color: 'var(--ink)' }}>
          {fmtINR(quotation.total_amount)}
        </span>
      </div>

      {/* Notes */}
      {quotation.notes && (
        <div className="mt-4 card px-5 py-4">
          <div className="eyebrow mb-2">Notes</div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>{quotation.notes}</p>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
