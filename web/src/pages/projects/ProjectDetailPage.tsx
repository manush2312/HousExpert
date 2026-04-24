import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import api from '../../services/api'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Calendar,
  Check,
  ChevronRight,
  Download,
  Edit2,
  Eye,
  Home,
  Layers,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import DatePicker from '../../components/DatePicker'
import SearchableSelect from '../../components/SearchableSelect'
import {
  addFloorPlan,
  getProject,
  getUploadUrl,
  type FloorPlan,
  type Project,
} from '../../services/projectService'
import {
  createLogEntry,
  deleteLogEntry,
  getLogType,
  listLogCategories,
  listLogEntries,
  listLogItems,
  listLogTypes,
  updateLogEntry,
  type FieldValue,
  type LogCategory,
  type LogCostMode,
  type LogEntry,
  type LogItem,
  type LogType,
  type SchemaField,
} from '../../services/logService'

type Tab = 'overview' | 'logs' | 'floorplans' | 'team'

interface DraftEntry {
  id: string
  log_type_id: string
  category_id: string
  item_id: string
  quantity: string
  log_date: string
  notes: string
  values: Record<string, unknown>
}

interface EditDraft extends DraftEntry {
  entry_id: string
}

interface CostSlice {
  label: string
  value: number
  color: 'accent' | 'ok' | 'warn' | 'ink-3'
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [project, setProject] = useState<Project | null>(null)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [allLogTypes, setAllLogTypes] = useState<LogType[]>([])
  const [categoriesByType, setCategoriesByType] = useState<Record<string, LogCategory[]>>({})
  const [itemsByCategory, setItemsByCategory] = useState<Record<string, LogItem[]>>({})

  const [pageLoading, setPageLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [logTypeFilter, setLogTypeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [q, setQ] = useState('')

  const [drafts, setDrafts] = useState<DraftEntry[]>([])
  const [editingEntry, setEditingEntry] = useState<LogEntry | null>(null)
  const [editingDraft, setEditingDraft] = useState<EditDraft | null>(null)
  const [editLogType, setEditLogType] = useState<LogType | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const [exportLoading, setExportLoading] = useState(false)

  const [dragOver, setDragOver] = useState<string | null>(null)
  const [pendingUploadBhk, setPendingUploadBhk] = useState('')
  const [uploadingByBhk, setUploadingByBhk] = useState<Record<string, boolean>>({})

  const refreshProject = useCallback(async () => {
    if (!id) return
    const res = await getProject(id)
    setProject(res.data.data)
  }, [id])

  const refreshEntries = useCallback(async () => {
    if (!id) return
    setLogsLoading(true)
    try {
      const res = await listLogEntries(id)
      setEntries(res.data.data ?? [])
    } finally {
      setLogsLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (!id) return

    let active = true
    setPageLoading(true)

    Promise.all([
      getProject(id),
      listLogTypes(),
      listLogEntries(id),
    ])
      .then(([projectRes, logTypesRes, entriesRes]) => {
        if (!active) return
        setProject(projectRes.data.data)
        setAllLogTypes(logTypesRes.data.data ?? [])
        setEntries(entriesRes.data.data ?? [])
      })
      .catch(() => {
        if (active) navigate('/projects')
      })
      .finally(() => {
        if (active) setPageLoading(false)
      })

    return () => { active = false }
  }, [id, navigate])

  const ensureCategories = useCallback(async (logTypeId: string) => {
    if (!logTypeId || categoriesByType[logTypeId]) return
    try {
      const res = await listLogCategories(logTypeId)
      setCategoriesByType((prev) => ({ ...prev, [logTypeId]: res.data.data ?? [] }))
    } catch {
      setCategoriesByType((prev) => ({ ...prev, [logTypeId]: [] }))
    }
  }, [categoriesByType])

  const ensureItems = useCallback(async (categoryId: string) => {
    if (!categoryId || itemsByCategory[categoryId]) return
    try {
      const res = await listLogItems(categoryId)
      setItemsByCategory((prev) => ({ ...prev, [categoryId]: res.data.data ?? [] }))
    } catch {
      setItemsByCategory((prev) => ({ ...prev, [categoryId]: [] }))
    }
  }, [itemsByCategory])

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (logTypeFilter && entry.log_type_id !== logTypeFilter) return false
      if (dateFilter && toDateKey(entry.log_date) !== dateFilter) return false
      if (q) {
        const hay = `${entry.log_type_name} ${entry.category_name} ${entry.notes ?? ''} ${entry.fields.map((f) => f.value).join(' ')}`
          .toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      return true
    })
  }, [entries, logTypeFilter, dateFilter, q])

  const handleExport = async () => {
    if (!project) return
    setExportLoading(true)
    try {
      const logTypeName = allLogTypes.find((lt) => lt.id === logTypeFilter)?.name
      const res = await api.get(`/projects/${project.project_id}/export-logs`, {
        responseType: 'blob',
        params: {
          ...(logTypeFilter   && { log_type_id:   logTypeFilter }),
          ...(logTypeName     && { log_type_name:  logTypeName }),
          ...(dateFilter      && { date:            dateFilter }),
          ...(q               && { q }),
        },
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.project_id}-logs-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
      alert('Export failed — check that the backend is running.')
    } finally {
      setExportLoading(false)
    }
  }

  const activitySeries = useMemo(() => buildActivitySeries(entries, 30), [entries])
  const recentEntries = useMemo(
    () => [...entries].sort((a, b) => `${b.log_date}${b.created_at}`.localeCompare(`${a.log_date}${a.created_at}`)).slice(0, 5),
    [entries],
  )
  const costBreakdown = useMemo(() => deriveCostBreakdown(entries, project?.spent ?? 0), [entries, project?.spent])

  const tabs = useMemo(() => (
    project
      ? [
          { value: 'overview' as Tab, label: 'Overview' },
          { value: 'logs' as Tab, label: 'Daily logs', count: entries.length },
          { value: 'floorplans' as Tab, label: 'Floor plans', count: project.bhk_configs.reduce((n, cfg) => n + cfg.floor_plans.length, 0) },
          { value: 'team' as Tab, label: 'Team' },
        ]
      : []
  ), [entries.length, project])

  const newDraft = () => {
    const draftId = `draft-${Date.now()}`
    setDrafts((prev) => [
      {
        id: draftId,
        log_type_id: '',
        category_id: '',
        item_id: '',
        quantity: '',
        log_date: new Date().toISOString().split('T')[0],
        notes: '',
        values: {},
      },
      ...prev,
    ])
    setTab('logs')
  }

  const updateDraft = async (draftId: string, patch: Partial<DraftEntry>) => {
    setDrafts((prev) => prev.map((draft) => {
      if (draft.id !== draftId) return draft

      if (patch.log_type_id && patch.log_type_id !== draft.log_type_id) {
        const logType = allLogTypes.find((item) => item.id === patch.log_type_id)
        return {
          ...draft,
          ...patch,
          category_id: '',
          item_id: '',
          values: initialDraftValues(logType),
        }
      }

      if (patch.category_id && patch.category_id !== draft.category_id) {
        return {
          ...draft,
          ...patch,
          item_id: '',
        }
      }

      return { ...draft, ...patch }
    }))

    if (patch.log_type_id) await ensureCategories(patch.log_type_id)
    if (patch.category_id) await ensureItems(patch.category_id)
  }

  const cancelDraft = (draftId: string) => setDrafts((prev) => prev.filter((draft) => draft.id !== draftId))

  const saveDraft = async (draftId: string) => {
    if (!id) return

    const draft = drafts.find((item) => item.id === draftId)
    if (!draft) return

    const logType = allLogTypes.find((item) => item.id === draft.log_type_id)
    const entrySchema = getEntrySchema(logType)
    const costMode = getEffectiveCostMode(logType)
    if (!logType || !draft.category_id) {
      alert('Pick a log type and category first.')
      return
    }

    const selectedItem = (itemsByCategory[draft.category_id] ?? []).find((item) => item.id === draft.item_id)
    const missingRequired = entrySchema.find((field) => {
      if (!field.required) return false
      const value = draft.values[field.field_id]
      return value === '' || value === null || value === undefined
    })
    if (missingRequired) {
      alert(`Please complete "${missingRequired.label}" before saving.`)
      return
    }
    if (costMode === 'quantity_x_unit_cost' && isQuantityRequired(entrySchema, selectedItem?.fields ?? []) && parseOptionalNumber(draft.quantity) == null) {
      alert('Please add quantity before saving.')
      return
    }

    const parsedQuantity = parseOptionalNumber(draft.quantity)
    const computedTotalCost = computeDraftTotalCost(costMode, entrySchema, selectedItem?.fields ?? [], draft.values, parsedQuantity)
    const fields: FieldValue[] = buildDraftFieldPayload(entrySchema, draft.values, {
      costMode,
      quantity: parsedQuantity,
      totalCost: computedTotalCost,
    }).map((field) => ({
      field_id: field.field_id,
      label: field.label,
      value: normalizeDraftValue(
        entrySchema.find((schemaField) => schemaField.field_id === field.field_id) ?? { field_type: 'text' } as SchemaField,
        field.value,
      ),
    }))

    try {
      await createLogEntry(id, {
        log_type_id: draft.log_type_id,
        category_id: draft.category_id,
        item_id: draft.item_id || undefined,
        quantity: draft.quantity ? Number(draft.quantity) : undefined,
        log_date: draft.log_date,
        fields,
        notes: draft.notes || undefined,
      })
      setDrafts((prev) => prev.filter((item) => item.id !== draftId))
      await refreshEntries()
    } catch {
      alert('Failed to save log entry.')
    }
  }

  const handleDelete = async (entryId: string) => {
    if (!id || !confirm('Delete this log entry? This cannot be undone.')) return
    try {
      await deleteLogEntry(id, entryId)
      await refreshEntries()
    } catch {
      alert('Failed to delete log entry.')
    }
  }

  const handleOpenEdit = async (entry: LogEntry) => {
    setEditingEntry(entry)
    const values: Record<string, unknown> = {}
    entry.fields.forEach((field) => { values[field.field_id] = field.value })
    setEditingDraft({
      id: `edit-${entry.id}`,
      entry_id: entry.id,
      log_type_id: entry.log_type_id,
      category_id: entry.category_id,
      item_id: entry.item_id ?? '',
      quantity: entry.quantity != null ? String(entry.quantity) : '',
      log_date: entry.log_date,
      notes: entry.notes ?? '',
      values,
    })
    await ensureCategories(entry.log_type_id)
    await ensureItems(entry.category_id)

    const localLogType = allLogTypes.find((item) => item.id === entry.log_type_id)
    if (localLogType) {
      setEditLogType(localLogType)
      return
    }

    try {
      const res = await getLogType(entry.log_type_id)
      setEditLogType(res.data.data)
    } catch {
      setEditLogType(null)
    }
  }

  const handleCloseEdit = () => {
    setEditingEntry(null)
    setEditingDraft(null)
    setEditLogType(null)
  }

  const updateEditDraft = async (_draftId: string, patch: Partial<DraftEntry>) => {
    setEditingDraft((prev) => prev ? { ...prev, ...patch } : prev)
  }

  const handleSaveEdit = async () => {
    if (!editingEntry || !editingDraft || !id) return
    setEditSaving(true)
    try {
      const activeLogType = editLogType ?? allLogTypes.find((item) => item.id === editingDraft.log_type_id)
      const entrySchema = getEntrySchema(activeLogType)
      const costMode = getEffectiveCostMode(activeLogType)
      const selectedItem = (itemsByCategory[editingDraft.category_id] ?? []).find((item) => item.id === editingDraft.item_id)
      const parsedQuantity = parseOptionalNumber(editingDraft.quantity)
      const totalCost = computeDraftTotalCost(costMode, entrySchema, selectedItem?.fields ?? [], editingDraft.values, parsedQuantity)
      const fields: FieldValue[] = buildDraftFieldPayload(entrySchema, editingDraft.values, {
        costMode,
        quantity: parsedQuantity,
        totalCost,
      }).map((field) => ({
        field_id: field.field_id,
        label: field.label,
        value: field.value,
      }))
      await updateLogEntry(id, editingEntry.id, {
        fields,
        notes: editingDraft.notes || undefined,
        quantity: editingDraft.quantity ? Number(editingDraft.quantity) : undefined,
      })
      handleCloseEdit()
      await refreshEntries()
    } catch {
      alert('Failed to update log entry.')
    } finally {
      setEditSaving(false)
    }
  }

  const triggerUploadPicker = (bhkType: string) => {
    setPendingUploadBhk(bhkType)
    fileInputRef.current?.click()
  }

  const uploadFiles = useCallback(async (bhkType: string, files: FileList | File[] | null) => {
    if (!id || !files || files.length === 0) return

    const fileArray = Array.from(files)
    setUploadingByBhk((prev) => ({ ...prev, [bhkType]: true }))

    try {
      for (const file of fileArray) {
        const contentType = file.type || guessContentType(file.name)
        const fileType = contentType.includes('pdf') ? 'pdf' : 'image'
        const uploadRes = await getUploadUrl(id, bhkType, file.name, contentType)
        const { upload_url, public_url } = uploadRes.data.data

        const uploadResponse = await fetch(upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': contentType },
        })
        if (!uploadResponse.ok) throw new Error('upload failed')

        await addFloorPlan(id, bhkType, {
          label: file.name.replace(/\.[^.]+$/, ''),
          file_url: public_url,
          file_type: fileType,
        })
      }

      await refreshProject()
    } catch {
      alert(`Failed to upload floor plan for ${bhkType}.`)
    } finally {
      setUploadingByBhk((prev) => ({ ...prev, [bhkType]: false }))
      setPendingUploadBhk('')
    }
  }, [id, refreshProject])

  if (pageLoading) {
    return (
      <div className="w-full px-8 py-7 space-y-4">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-7 w-64" />
        <div className="skeleton h-4 w-48 mt-2" />
      </div>
    )
  }

  if (!project) return null

  return (
    <>
      <div className="w-full px-8 py-7">
        <div className="mb-5 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
          <button onClick={() => navigate('/projects')} className="hover:underline">Projects</button>
          <span style={{ color: 'var(--ink-4)' }}>›</span>
          <span className="font-medium" style={{ color: 'var(--ink)' }}>{project.name}</span>
        </div>

        <div className="mb-7 flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-3">
              <StatusPill status={project.status} />
              <span className="numeral text-[11px]" style={{ color: 'var(--ink-4)' }}>{project.project_id}</span>
              <span className="dot" />
              <span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                Updated {fmtDate(project.updated_at)}
              </span>
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight numeral" style={{ color: 'var(--ink)' }}>
              {project.name}
            </h1>
            <div className="mt-2 flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--ink-3)' }}>
              <MapPin size={13} />
              <span>
                {project.address.line1}
                {project.address.line2 ? `, ${project.address.line2}` : ''} · {project.address.city}, {project.address.state} {project.address.pincode}
              </span>
            </div>
            {(project.client_name || project.client_phone) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                {project.client_name && (
                  <span>
                    Client · <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{project.client_name}</span>
                  </span>
                )}
                {project.client_name && project.client_phone && <span className="dot" />}
                {project.client_phone && (
                  <span>
                    Phone · <span className="numeral" style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{project.client_phone}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleExport} disabled={exportLoading} className="btn btn-outline">
              <Download size={15} />
              {exportLoading ? 'Generating…' : 'Export report'}
            </button>
            <button onClick={newDraft} className="btn btn-accent">
              <Plus size={15} />
              Add entry
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6 md:grid-cols-4">
          <StatCell
            label="Progress"
            value={`${Math.round((project.progress ?? 0) * 100)}%`}
            tone="accent"
            sub={<Progress value={project.progress ?? 0} />}
          />
          <StatCell
            label="Budget"
            value={fmtCr(project.budget)}
            sub={<span className="text-[11.5px] numeral" style={{ color: 'var(--ink-4)' }}>{fmtCr(project.spent)} committed</span>}
          />
          <StatCell
            label="Units / Floors"
            value={`${project.units || 0} / ${project.floors || 0}`}
            sub={<span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{project.bhk_configs.length} BHK types</span>}
          />
          <StatCell
            label="Target handover"
            value={project.target_at ? fmtDateShort(project.target_at) : '—'}
            sub={<span className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>Started {project.started_at ? fmtDateShort(project.started_at) : '—'}</span>}
          />
        </div>

        <Tabs value={tab} onChange={setTab} items={tabs} />

        <div className="mt-6">
          {tab === 'overview' && (
            <OverviewTab
              project={project}
              activitySeries={activitySeries}
              recentEntries={recentEntries}
              costBreakdown={costBreakdown}
              onShowLogs={() => setTab('logs')}
            />
          )}
          {tab === 'logs' && (
            <LogsSection
              entries={filteredEntries}
              q={q}
              setQ={setQ}
              logTypeFilter={logTypeFilter}
              setLogTypeFilter={setLogTypeFilter}
              dateFilter={dateFilter}
              setDateFilter={setDateFilter}
              loading={logsLoading}
              drafts={drafts}
              editingDraft={editingDraft}
              allLogTypes={allLogTypes}
              editLogType={editLogType}
              categoriesByType={categoriesByType}
              itemsByCategory={itemsByCategory}
              onAdd={newDraft}
              onUpdateDraft={updateDraft}
              onCancelDraft={cancelDraft}
              onSaveDraft={saveDraft}
              onUpdateEdit={updateEditDraft}
              onCancelEdit={handleCloseEdit}
              onSaveEdit={handleSaveEdit}
              editSaving={editSaving}
              onEdit={handleOpenEdit}
              onDelete={handleDelete}
            />
          )}
          {tab === 'floorplans' && (
            <FloorPlansTab
              project={project}
              dragOver={dragOver}
              setDragOver={setDragOver}
              uploadingByBhk={uploadingByBhk}
              onBrowse={triggerUploadPicker}
              onDropFiles={uploadFiles}
            />
          )}
          {tab === 'team' && <TeamTab project={project} />}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,image/*"
          multiple
          onChange={(e) => {
            void uploadFiles(pendingUploadBhk, e.target.files)
            e.target.value = ''
          }}
        />
      </div>

    </>
  )
}

function StatCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: ReactNode
  tone?: 'accent'
}) {
  return (
    <div className="card p-3.5">
      <div className="eyebrow">{label}</div>
      <div
        className="mt-2 text-[22px] font-semibold numeral leading-none"
        style={tone === 'accent' ? { color: 'var(--accent-ink)' } : { color: 'var(--ink)' }}
      >
        {value}
      </div>
      <div className="mt-2.5">{sub}</div>
    </div>
  )
}

function Tabs({
  value,
  onChange,
  items,
}: {
  value: Tab
  onChange: (next: Tab) => void
  items: Array<{ value: Tab; label: string; count?: number }>
}) {
  return (
    <div className="flex items-center gap-0 border-b" style={{ borderColor: 'var(--line)' }}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            className="relative flex h-10 items-center gap-2 px-3.5 text-[13px] font-medium transition-colors"
            style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  background: active ? 'var(--accent-wash)' : 'var(--bg-sunken)',
                  color: active ? 'var(--accent-ink)' : 'var(--ink-3)',
                }}
              >
                {item.count}
              </span>
            )}
            {active && <div className="tab-active-bar" />}
          </button>
        )
      })}
    </div>
  )
}

function OverviewTab({
  project,
  activitySeries,
  recentEntries,
  costBreakdown,
  onShowLogs,
}: {
  project: Project
  activitySeries: number[]
  recentEntries: LogEntry[]
  costBreakdown: CostSlice[]
  onShowLogs: () => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Activity - last 30 days</h3>
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                Log entries per day across all log types
              </p>
            </div>
            <div
              className="inline-flex items-center rounded-lg p-0.5"
              style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}
            >
              {['7d', '30d', '90d'].map((item) => (
                <span
                  key={item}
                  className="rounded-md px-2.5 py-1 text-[11.5px] font-medium"
                  style={item === '30d'
                    ? { background: 'var(--bg-elev)', color: 'var(--ink)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--ink-3)' }}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
          <LineChart data={activitySeries} />
          <div className="mt-1 flex items-center justify-between text-[11px]" style={{ color: 'var(--ink-4)' }}>
            <span>{fmtDateShort(offsetDate(-29))}</span>
            <span>{fmtDateShort(offsetDate(-14))}</span>
            <span>{fmtDateShort(new Date().toISOString())}</span>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Recent entries</h3>
            <button onClick={onShowLogs} className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--ink-3)' }}>
              View all <ChevronRight size={11} />
            </button>
          </div>

          {recentEntries.length === 0 ? (
            <div className="rounded-xl p-5 text-center text-[12px]" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-4)' }}>
              No entries yet for this project.
            </div>
          ) : (
            <div className="space-y-1">
              {recentEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover-bg transition-colors">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
                    style={{ background: 'var(--bg-sunken)', color: 'var(--accent-ink)' }}
                  >
                    <Layers size={13} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                      {entry.log_type_name} · {entry.category_name}
                    </div>
                    <div className="truncate text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                      {entry.fields.slice(0, 3).map((field) => `${field.label}: ${displayVal(field.value)}`).join(' · ')}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px]" style={{ color: 'var(--ink-4)' }}>
                    {fmtDateShort(entry.log_date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="mb-1 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Cost breakdown</h3>
          <p className="mb-4 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {fmtCr(project.spent)} of {fmtCr(project.budget)} committed
          </p>
          <div className="mb-4 flex items-center justify-center">
            <div className="relative">
              <Donut data={costBreakdown} size={140} thickness={16} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="eyebrow text-[10.5px]" style={{ color: 'var(--ink-4)' }}>Spent</div>
                <div className="text-[18px] font-semibold numeral" style={{ color: 'var(--ink)' }}>{fmtCr(project.spent)}</div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {costBreakdown.map((slice) => (
              <div key={slice.label} className="flex items-center gap-2.5 text-[12px]">
                <div className="h-2 w-2 rounded-sm shrink-0" style={{ background: colorVar(slice.color) }} />
                <span style={{ color: 'var(--ink-2)' }}>{slice.label}</span>
                <span className="ml-auto numeral" style={{ color: 'var(--ink)' }}>{fmtCr(slice.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Team</h3>
          <div className="mb-3 flex items-center gap-2">
            {buildTeam(project).slice(0, 4).map((member, index) => (
              <div
                key={member.name}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: `oklch(0.55 0.16 ${262 - index * 35})` }}
              >
                {member.initial}
              </div>
            ))}
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-4)' }}
            >
              <Plus size={12} />
            </button>
          </div>
          <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
            Lead · <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{project.lead || 'Unassigned'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LogsSection({
  entries,
  q,
  setQ,
  logTypeFilter,
  setLogTypeFilter,
  dateFilter,
  setDateFilter,
  loading,
  drafts,
  editingDraft,
  allLogTypes,
  editLogType,
  categoriesByType,
  itemsByCategory,
  onAdd,
  onUpdateDraft,
  onCancelDraft,
  onSaveDraft,
  onUpdateEdit,
  onCancelEdit,
  onSaveEdit,
  editSaving,
  onEdit,
  onDelete,
}: {
  entries: LogEntry[]
  q: string
  setQ: (value: string) => void
  logTypeFilter: string
  setLogTypeFilter: (value: string) => void
  dateFilter: string
  setDateFilter: (value: string) => void
  loading: boolean
  drafts: DraftEntry[]
  editingDraft: EditDraft | null
  allLogTypes: LogType[]
  editLogType: LogType | null
  categoriesByType: Record<string, LogCategory[]>
  itemsByCategory: Record<string, LogItem[]>
  onAdd: () => void
  onUpdateDraft: (id: string, patch: Partial<DraftEntry>) => void | Promise<void>
  onCancelDraft: (id: string) => void
  onSaveDraft: (id: string) => void | Promise<void>
  onUpdateEdit: (id: string, patch: Partial<DraftEntry>) => void | Promise<void>
  onCancelEdit: () => void
  onSaveEdit: () => void | Promise<void>
  editSaving: boolean
  onEdit: (entry: LogEntry) => void
  onDelete: (entryId: string) => void
}) {
  const hasFilter = logTypeFilter || dateFilter || q

  const grouped = useMemo(() => {
    const map = new Map<string, LogEntry[]>()
    entries.forEach((entry) => {
      const dateKey = toDateKey(entry.log_date)
      const rows = map.get(dateKey) ?? []
      rows.push(entry)
      map.set(dateKey, rows)
    })
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries])

  const showEmptyState = entries.length === 0 && drafts.length === 0 && !loading

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--ink-4)' }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search logs…"
            className="input h-8"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <div style={{ width: 150 }}>
          <DatePicker value={dateFilter} onChange={setDateFilter} className="h-8" placeholder="Filter date" />
        </div>
        <SearchableSelect
          value={logTypeFilter}
          onChange={setLogTypeFilter}
          options={[
            { value: '', label: 'All log types' },
            ...allLogTypes.map((logType) => ({ value: logType.id, label: logType.name })),
          ]}
          placeholder="All log types"
          searchPlaceholder="Search log types…"
          className="h-8"
          style={{ width: 180 }}
        />
        {hasFilter && (
          <button onClick={() => { setQ(''); setLogTypeFilter(''); setDateFilter('') }} className="btn btn-ghost btn-sm">
            <X size={12} /> Clear
          </button>
        )}
        <span className="ml-auto text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{entries.length} entries</span>
        <button onClick={onAdd} className="btn btn-accent btn-sm">
          <Plus size={13} /> Add entry
        </button>
      </div>

      {drafts.length > 0 && (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <InlineDraftComposer
              key={draft.id}
              draft={draft}
              logTypes={allLogTypes}
              categories={categoriesByType[draft.log_type_id] ?? []}
              items={itemsByCategory[draft.category_id] ?? []}
              onUpdate={onUpdateDraft}
              onCancel={onCancelDraft}
              onSave={onSaveDraft}
            />
          ))}
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
          Loading entries…
        </div>
      ) : showEmptyState ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
            <Layers size={20} />
          </div>
          <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>
            No entries match
          </p>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-3)' }}>
            Try clearing filters or add your first entry.
          </p>
          <button onClick={onAdd} className="btn btn-accent mt-5">
            <Plus size={15} /> Add entry
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr style={{ background: 'var(--bg-sunken)' }}>
                  <Th2>Type</Th2>
                  <Th2>Entry</Th2>
                  <Th2 align="right">Quantity</Th2>
                  <Th2 align="right">Total cost</Th2>
                  <Th2>Key values</Th2>
                  <Th2>Notes</Th2>
                  <Th2>Logged by</Th2>
                  <Th2 width="120"> </Th2>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([date, rows]) => (
                  <Fragment key={date}>
                    <tr style={{ background: 'var(--bg-sunken)' }}>
                      <td colSpan={8} className="px-4 py-1.5 text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>
                        <span className="inline-flex items-center gap-2">
                          <Calendar size={11} />
                          {fmtDate(date)}
                          <span style={{ color: 'var(--ink-4)' }}>· {rows.length} entries</span>
                        </span>
                      </td>
                    </tr>
                    {rows.map((entry) => {
                      const details = extractEntryDetails(entry)
                      const primary = buildEntryPrimary(entry, details.name)
                      const secondary = buildEntrySecondary(entry)
                      const quantity = entry.quantity ?? details.quantity
                      const totalCost = entry.total_cost ?? details.cost
                      const keyValues = buildEntryKeyValues(entry)
                      const isEditingThisRow = editingDraft?.entry_id === entry.id
                      return (
                        <Fragment key={entry.id}>
                          <tr className="group transition-colors hover-bg" style={{ borderTop: '1px solid var(--line-2)' }}>
                            <td className="px-4 py-2.5">
                              <div className="inline-flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: 'var(--bg-sunken)' }}>
                                  <Layers size={12} style={{ color: 'var(--accent-ink)' }} />
                                </div>
                                <div>
                                  <div className="text-[12.5px] font-medium leading-tight" style={{ color: 'var(--ink)' }}>{entry.log_type_name}</div>
                                  <div className="text-[10.5px] leading-tight" style={{ color: 'var(--ink-4)' }}>{entry.category_name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium" style={{ color: 'var(--ink)' }}>{primary}</div>
                              <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-4)' }}>{secondary}</div>
                            </td>
                            <td className="px-4 py-2.5 text-right numeral" style={{ color: quantity != null ? 'var(--ink-2)' : 'var(--ink-5)' }}>
                              {quantity != null ? displayVal(quantity) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right numeral" style={{ color: totalCost != null ? 'var(--ink-2)' : 'var(--ink-5)' }}>
                              {totalCost != null ? fmtMoney(totalCost) : '—'}
                            </td>
                            <td className="max-w-[260px] px-4 py-2.5">
                              <div className="truncate text-[12px]" style={{ color: keyValues ? 'var(--ink-2)' : 'var(--ink-5)' }}>
                                {keyValues || 'No extra values'}
                              </div>
                            </td>
                            <td className="max-w-[180px] truncate px-4 py-2.5" style={{ color: 'var(--ink-3)' }}>{entry.notes || <Null />}</td>
                            <td className="px-4 py-2.5" style={{ color: 'var(--ink-3)' }}>{entry.created_by}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <button onClick={() => onEdit(entry)} className="btn btn-ghost btn-sm btn-icon" title="Edit">
                                  <Edit2 size={12} />
                                </button>
                                <button onClick={() => onDelete(entry.id)} className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: 'var(--bad)' }}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isEditingThisRow && editingDraft && (
                            <tr style={{ background: 'var(--bg-elev)' }}>
                              <td colSpan={8} className="px-4 py-3">
                                <InlineDraftComposer
                                  draft={editingDraft}
                                  logTypes={editLogType && !allLogTypes.some((item) => item.id === editLogType.id) ? [editLogType, ...allLogTypes] : allLogTypes}
                                  categories={categoriesByType[editingDraft.log_type_id] ?? []}
                                  items={itemsByCategory[editingDraft.category_id] ?? []}
                                  onUpdate={onUpdateEdit}
                                  onCancel={onCancelEdit}
                                  onSave={() => onSaveEdit()}
                                  title="Inline log editor"
                                  description="Same guided flow as add entry, with source details locked while you update the logged values."
                                  saveLabel={editSaving ? 'Saving…' : 'Save changes'}
                                  lockedSource
                                  saving={editSaving}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function InlineDraftComposer({
  draft,
  logTypes,
  categories,
  items,
  onUpdate,
  onCancel,
  onSave,
  title = 'Inline log composer',
  description = 'Guided flow: basics, source, details, then review and save.',
  saveLabel = 'Save entry',
  lockedSource = false,
  saving = false,
}: {
  draft: DraftEntry
  logTypes: LogType[]
  categories: LogCategory[]
  items: LogItem[]
  onUpdate: (id: string, patch: Partial<DraftEntry>) => void | Promise<void>
  onCancel: (id: string) => void
  onSave: (id: string) => void | Promise<void>
  title?: string
  description?: string
  saveLabel?: string
  lockedSource?: boolean
  saving?: boolean
}) {
  const logType = logTypes.find((item) => item.id === draft.log_type_id)
  const itemSchema = getItemSchema(logType)
  const entrySchema = getEntrySchema(logType)
  const costMode = getEffectiveCostMode(logType)
  const itemSelectorField = findItemSelectorField(itemSchema)
  const itemSelectionEnabled = Boolean(draft.category_id && items.length > 0)
  const quantityVisible = costMode === 'quantity_x_unit_cost'
  const visibleFields = getVisibleEntryFields(entrySchema, costMode)
  const selectedItem = items.find((item) => item.id === draft.item_id)
  const missingRequired = entrySchema.find((field) => field.required && isDraftFieldEmpty(field, draft.values[field.field_id]))
  const quantityRequired = quantityVisible && isQuantityRequired(entrySchema, selectedItem?.fields ?? [])
  const parsedQuantity = parseOptionalNumber(draft.quantity)
  const unitCost = findUnitCostValue(entrySchema, selectedItem?.fields ?? [], draft.values)
  const totalCost = computeDraftTotalCost(costMode, entrySchema, selectedItem?.fields ?? [], draft.values, parsedQuantity)
  const missingQuantity = quantityRequired && parsedQuantity == null
  const canSave = !!draft.log_type_id && !!draft.category_id && !missingRequired && !missingQuantity && !saving
  const completedSteps = [
    Boolean(draft.log_date && draft.log_type_id),
    Boolean(draft.category_id && (!itemSelectionEnabled || draft.item_id)),
    !missingRequired && !missingQuantity,
  ].filter(Boolean).length

  const applyItemSelection = (itemId: string) => {
    if (!logType) return
    const item = items.find((row) => row.id === itemId)
    if (!item) {
      void onUpdate(draft.id, { item_id: '' })
      return
    }

    const nextValues = mergeItemValuesIntoEntryFields(entrySchema, draft.values, item.fields)
    void onUpdate(draft.id, { item_id: itemId, values: nextValues })
  }

  const handleFieldChange = (field: SchemaField, value: unknown) => {
    void onUpdate(draft.id, {
      values: { ...draft.values, [field.field_id]: value },
    })
  }

  return (
    <div className="card overflow-hidden border" style={{ borderColor: 'color-mix(in oklab, var(--accent) 18%, var(--line))' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5" style={{ background: 'color-mix(in oklab, var(--accent-wash) 62%, var(--bg-elev))', borderBottom: '1px solid color-mix(in oklab, var(--accent) 18%, var(--line))' }}>
        <div>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</div>
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
            {description}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: 'var(--bg-elev)', color: 'var(--accent-ink)' }}>
            {completedSteps}/3 steps ready
          </span>
          <button onClick={() => onCancel(draft.id)} className="btn btn-ghost btn-sm">
            <X size={12} /> Close
          </button>
        </div>
      </div>

      <div data-draft-id={draft.id} className="grid gap-5 p-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <section className="space-y-3">
            <DraftStep number={1} title="Basics" hint="Pick the date and log type first." />
            <div className="grid gap-3 md:grid-cols-[180px_1fr]">
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>Date</span>
                <DatePicker
                  value={draft.log_date}
                  onChange={(value) => { void onUpdate(draft.id, { log_date: value }) }}
                  className="h-10 text-[12.5px] numeral"
                  disabled={lockedSource}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>Log type</span>
                <SearchableSelect
                  value={draft.log_type_id}
                  onChange={(value) => { void onUpdate(draft.id, { log_type_id: value }) }}
                  options={logTypes.map((item) => ({ value: item.id, label: item.name }))}
                  placeholder="Select a log type…"
                  searchPlaceholder="Search log types…"
                  className="h-10 text-[13px]"
                  disabled={lockedSource}
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <DraftStep number={2} title="Source" hint="Choose where this log belongs." />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>Category</span>
                <SearchableSelect
                  value={draft.category_id}
                  onChange={(value) => { void onUpdate(draft.id, { category_id: value }) }}
                  options={categories.map((category) => ({ value: category.id, label: category.name }))}
                  placeholder={logType ? 'Select a category…' : 'Pick a type first'}
                  searchPlaceholder="Search categories…"
                  className="h-10 text-[13px]"
                  disabled={!logType || lockedSource}
                />
              </label>

              {itemSelectionEnabled ? (
                <label className="space-y-1.5">
                  <span className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>{itemSelectorField?.label || 'Item'}</span>
                  <SearchableSelect
                    value={draft.item_id}
                    onChange={applyItemSelection}
                    options={items.map((item) => ({ value: item.id, label: item.name }))}
                    placeholder="Select an item…"
                    searchPlaceholder="Search items…"
                    className="h-10 text-[13px]"
                    disabled={lockedSource}
                  />
                </label>
              ) : (
                <div className="rounded-xl border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                  {draft.category_id
                    ? 'No saved items under this category yet. The main field will be entered manually below.'
                    : 'Saved items will appear here once a category is selected.'}
                </div>
              )}
            </div>
            {selectedItem && (
              <div className="rounded-xl border px-3 py-3 text-[12px]" style={{ borderColor: 'color-mix(in oklab, var(--accent) 18%, var(--line))', background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
                <div>Using saved item <strong>{selectedItem.name}</strong>.</div>
                <div className="mt-1" style={{ color: 'var(--ink-3)' }}>
                  {(selectedItem.fields ?? [])
                    .filter((field) => field.value != null && field.value !== '')
                    .slice(0, 3)
                    .map((field) => `${field.label}: ${displayVal(field.value)}`)
                    .join(' · ') || 'Matching values have been filled where possible.'}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <DraftStep number={3} title="Details" hint="Confirm the remaining schema fields for this entry." />
            <div className="grid gap-3 md:grid-cols-[180px_1fr]">
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>
                  Quantity
                  {quantityRequired && <span style={{ color: 'var(--bad)' }}> *</span>}
                </span>
                {quantityVisible ? (
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="input h-10 text-[13px] numeral"
                    placeholder="Enter quantity"
                    value={draft.quantity}
                    onChange={(e) => { void onUpdate(draft.id, { quantity: e.target.value }) }}
                  />
                ) : (
                  <div className="input h-10 flex items-center text-[12px]" style={{ color: 'var(--ink-4)' }}>
                    Not used for this cost mode
                  </div>
                )}
              </label>
              <div className="rounded-xl border px-3 py-3" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-elev)' }}>
                <div className="text-[11px] font-medium" style={{ color: 'var(--ink-4)' }}>Total cost</div>
                <div className="mt-1 text-[18px] font-semibold numeral" style={{ color: totalCost != null ? 'var(--ink)' : 'var(--ink-4)' }}>
                  {totalCost != null ? fmtMoney(totalCost) : '—'}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-4)' }}>
                  {costMode === 'direct_amount'
                    ? `Taken from ${findDirectAmountLabel(entrySchema) || 'daily amount'}`
                    : costMode === 'manual_total'
                      ? `Taken from ${findTotalCostLabel(entrySchema) || 'total cost'}`
                      : unitCost != null
                        ? `Calculated from quantity × ${findUnitCostLabel(entrySchema, selectedItem?.fields ?? []) || 'cost'}`
                        : 'Add a numeric cost/rate field value to calculate total cost.'}
                </div>
              </div>
            </div>
            {!logType ? (
              <div className="rounded-xl border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-sunken)', color: 'var(--ink-4)' }}>
                Pick a log type to load the correct fields.
              </div>
            ) : visibleFields.length === 0 ? (
              <div className="rounded-xl border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-sunken)', color: 'var(--ink-4)' }}>
                No extra fields left to fill. You can review and save.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleFields.map((field) => (
                  <DraftFieldInput
                    key={field.field_id}
                    field={field}
                    value={draft.values[field.field_id]}
                    onChange={(value) => handleFieldChange(field, value)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 rounded-2xl border p-4" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-sunken)' }}>
          <div>
            <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Review</div>
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
              This summary updates as you fill the inline form.
            </p>
          </div>

          <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-elev)' }}>
            <ReviewLine label="Date" value={draft.log_date ? fmtDate(draft.log_date) : 'Pick a date'} />
            <ReviewLine label="Type" value={logType?.name || 'Pick a log type'} />
            <ReviewLine label="Category" value={categories.find((category) => category.id === draft.category_id)?.name || 'Pick a category'} />
            <ReviewLine label="Item" value={selectedItem?.name || (itemSelectionEnabled ? 'Pick an item' : 'Manual entry')} />
            {quantityVisible && <ReviewLine label="Quantity" value={parsedQuantity != null ? String(parsedQuantity) : '—'} />}
            <ReviewLine label="Total" value={totalCost != null ? fmtMoney(totalCost) : '—'} />
            {logType && visibleFields.slice(0, 4).map((field) => (
              <ReviewLine
                key={field.field_id}
                label={field.label}
                value={isDraftFieldEmpty(field, draft.values[field.field_id]) ? '—' : displayVal(draft.values[field.field_id])}
              />
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>Notes</span>
            <textarea
              className="input min-h-[104px] resize-none text-[12.5px]"
              placeholder="Add any site context, issues, or follow-up notes."
              value={draft.notes}
              onChange={(e) => { void onUpdate(draft.id, { notes: e.target.value }) }}
            />
          </label>

          {missingRequired || missingQuantity ? (
            <div className="rounded-xl border px-3 py-2.5 text-[12px]" style={{ borderColor: 'color-mix(in oklab, var(--warn) 24%, var(--line))', background: 'var(--warn-wash)', color: 'var(--warn-ink)' }}>
              {missingRequired
                ? <>Complete <strong>{missingRequired.label}</strong> before saving.</>
                : <>Add <strong>Quantity</strong> before saving.</>}
            </div>
          ) : (
            <div className="rounded-xl border px-3 py-2.5 text-[12px]" style={{ borderColor: 'color-mix(in oklab, var(--ok) 24%, var(--line))', background: 'var(--ok-wash)', color: 'var(--ok-ink)' }}>
              This entry is ready to save.
            </div>
          )}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => onCancel(draft.id)} className="btn btn-ghost">Discard</button>
            <button onClick={() => { void onSave(draft.id) }} disabled={!canSave} className="btn btn-accent">
              <Check size={13} /> {saveLabel}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function DraftStep({ number, title, hint }: { number: number; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
        {number}
      </div>
      <div>
        <div className="text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</div>
        <div className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>{hint}</div>
      </div>
    </div>
  )
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-[12px]">
      <span className="w-20 shrink-0" style={{ color: 'var(--ink-4)' }}>{label}</span>
      <span style={{ color: 'var(--ink-2)' }}>{value}</span>
    </div>
  )
}

function DraftFieldInput({
  field,
  value,
  onChange,
  itemOptions = [],
}: {
  field: SchemaField
  value: unknown
  onChange: (next: unknown) => void
  itemOptions?: LogItem[]
}) {
  const label = `${field.label}${field.required ? ' *' : ''}`

  if (itemOptions.length > 0) {
    return (
      <label className="flex min-w-[140px] flex-col gap-1">
        <span className="text-[9.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
        <SearchableSelect
          value={(value as string) ?? ''}
          onChange={onChange}
          options={itemOptions.map((item) => ({ value: item.name, label: item.name }))}
          placeholder="Select item…"
          searchPlaceholder="Search items…"
          className="h-8 text-[12px]"
        />
      </label>
    )
  }

  if (field.field_type === 'number') {
    return (
      <label className="flex min-w-[96px] flex-col gap-1">
        <span className="text-[9.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
        <input
          type="number"
          className="input h-8 text-[12px] numeral"
          value={(value as string | number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </label>
    )
  }

  if (field.field_type === 'dropdown') {
    return (
      <label className="flex min-w-[120px] flex-col gap-1">
        <span className="text-[9.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
        <SearchableSelect
          value={(value as string) ?? ''}
          onChange={onChange}
          options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
          placeholder="Select…"
          searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
          className="h-8 text-[12px]"
        />
      </label>
    )
  }

  if (field.field_type === 'date') {
    return (
      <label className="flex min-w-[128px] flex-col gap-1">
        <span className="text-[9.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
        <DatePicker value={(value as string) ?? ''} onChange={onChange} className="h-8 text-[12px] numeral" />
      </label>
    )
  }

  if (field.field_type === 'boolean') {
    return (
      <label className="flex min-w-[92px] flex-col gap-1">
        <span className="text-[9.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md border text-[11.5px] font-medium transition-colors"
          style={{
            background: value ? 'var(--ok-wash)' : 'var(--bg-elev)',
            color: value ? 'var(--ok-ink)' : 'var(--ink-3)',
            borderColor: value ? 'color-mix(in oklab, var(--ok) 30%, transparent)' : 'var(--line)',
          }}
        >
          {value ? <><Check size={11} /> Yes</> : 'No'}
        </button>
      </label>
    )
  }

  return (
    <label className="flex min-w-[132px] flex-col gap-1">
      <span className="text-[9.5px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</span>
      <input type="text" className="input h-8 text-[12px]" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Th2({
  children,
  width,
  align,
}: {
  children: ReactNode
  width?: string
  align?: 'left' | 'right'
}) {
  return (
    <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-4)', width, textAlign: align || 'left' }}>
      {children}
    </th>
  )
}

function FloorPlansTab({
  project,
  dragOver,
  setDragOver,
  uploadingByBhk,
  onBrowse,
  onDropFiles,
}: {
  project: Project
  dragOver: string | null
  setDragOver: (value: string | null) => void
  uploadingByBhk: Record<string, boolean>
  onBrowse: (bhkType: string) => void
  onDropFiles: (bhkType: string, files: FileList | File[] | null) => Promise<void>
}) {
  if (project.bhk_configs.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
          Add BHK types on the project to start uploading floor plans.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {project.bhk_configs.map((config) => (
        <div key={config.bhk_type} className="card">
          <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}>
                <Home size={13} />
              </div>
              <div>
                <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>{config.bhk_type}</div>
                <div className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                  {config.floor_plans.length} floor plan{config.floor_plans.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <button onClick={() => onBrowse(config.bhk_type)} className="btn btn-outline btn-sm" disabled={uploadingByBhk[config.bhk_type]}>
              <Upload size={13} />
              {uploadingByBhk[config.bhk_type] ? 'Uploading…' : 'Upload'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {config.floor_plans.map((plan) => <FloorPlanCard key={plan.plan_id} plan={plan} />)}

            <button
              onClick={() => onBrowse(config.bhk_type)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(config.bhk_type) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                void onDropFiles(config.bhk_type, e.dataTransfer.files)
              }}
              className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all"
              style={{
                borderColor: dragOver === config.bhk_type ? 'var(--accent)' : 'var(--line)',
                background: dragOver === config.bhk_type ? 'var(--accent-wash)' : 'var(--bg-sunken)',
              }}
            >
              <Upload size={18} style={{ color: dragOver === config.bhk_type ? 'var(--accent-ink)' : 'var(--ink-3)' }} />
              <div className="mt-2 text-[12.5px] font-medium" style={{ color: 'var(--ink-2)' }}>Drop PDF or image here</div>
              <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-4)' }}>or click to browse</div>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function FloorPlanCard({ plan }: { plan: FloorPlan }) {
  return (
    <div className="group overflow-hidden rounded-xl border transition-all" style={{ borderColor: 'var(--line)' }}>
      <div className="relative aspect-[4/3] flex items-center justify-center" style={{ background: 'var(--bg-sunken)' }}>
        <div className="absolute inset-0 bg-blueprint opacity-30" />
        <svg viewBox="0 0 120 90" className="relative h-3/4 w-3/4">
          <rect x="5" y="8" width="110" height="74" fill="var(--bg-elev)" stroke="var(--ink-3)" strokeWidth="1.5" />
          <line x1="5" y1="35" x2="70" y2="35" stroke="var(--ink-3)" strokeWidth="1" />
          <line x1="70" y1="8" x2="70" y2="82" stroke="var(--ink-3)" strokeWidth="1" />
          <line x1="35" y1="35" x2="35" y2="82" stroke="var(--ink-3)" strokeWidth="1" />
          <rect x="10" y="12" width="8" height="2" fill="var(--ink-4)" />
          <rect x="74" y="12" width="10" height="2" fill="var(--ink-4)" />
        </svg>

        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <a href={plan.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
            <Eye size={11} />
          </a>
          <a href={plan.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
            <Download size={11} />
          </a>
        </div>

        <span className="absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase" style={{ background: 'var(--bg-elev)', color: 'var(--ink-3)' }}>
          {plan.file_type}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <div className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>{plan.label}</div>
        <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-4)' }}>Uploaded {fmtDateShort(plan.uploaded_at)}</div>
      </div>
    </div>
  )
}

function TeamTab({ project }: { project: Project }) {
  const team = buildTeam(project)

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Site team</h3>
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {team.length} members with access to this project
          </p>
        </div>
        <button className="btn btn-outline btn-sm">
          <Plus size={13} /> Invite
        </button>
      </div>

      <div>
        {team.map((member) => (
          <div key={member.name} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--line-2)' }}>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-[11.5px] font-semibold text-white"
              style={{ background: `linear-gradient(135deg, oklch(0.55 0.16 ${member.hue}), oklch(0.62 0.18 ${member.hue + 24}))` }}
            >
              {member.initial}
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{member.name}</div>
              <div className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{member.role}</div>
            </div>
            <span className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{member.tasks} active tasks</span>
            <button className="btn btn-ghost btn-sm btn-icon">
              <MoreHorizontal size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

function LineChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const width = 620
  const height = 220
  const innerHeight = 180

  const points = data.map((value, index) => {
    const x = (index / Math.max(data.length - 1, 1)) * width
    const normalized = (value - min) / Math.max(max - min, 1)
    const y = 20 + (1 - normalized) * innerHeight
    return `${x},${y}`
  }).join(' ')

  const areaPoints = `0,200 ${points} ${width},200`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full">
      <defs>
        <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((step) => (
        <line
          key={step}
          x1="0"
          x2={width}
          y1={20 + step * innerHeight}
          y2={20 + step * innerHeight}
          stroke="var(--line)"
          strokeDasharray="3 5"
        />
      ))}
      <polyline fill="url(#activity-fill)" points={areaPoints} />
      <polyline fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={points} />
      {data.map((value, index) => {
        const x = (index / Math.max(data.length - 1, 1)) * width
        const normalized = (value - min) / Math.max(max - min, 1)
        const y = 20 + (1 - normalized) * innerHeight
        return <circle key={`${index}-${value}`} cx={x} cy={y} r="3" fill="var(--bg-elev)" stroke="var(--accent)" strokeWidth="2" />
      })}
    </svg>
  )
}

function Donut({
  data,
  size,
  thickness,
}: {
  data: CostSlice[]
  size: number
  thickness: number
}) {
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const total = Math.max(data.reduce((sum, item) => sum + item.value, 0), 1)

  let offset = 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--line-2)"
        strokeWidth={thickness}
      />
      {data.map((slice) => {
        const length = (slice.value / total) * circumference
        const dashOffset = circumference - offset
        offset += length

        return (
          <circle
            key={slice.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colorVar(slice.color)}
            strokeWidth={thickness}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

function Null() {
  return <span style={{ color: 'var(--ink-5)' }}>null</span>
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { dot: string; bg: string; text: string; label: string }> = {
    active: { dot: 'var(--ok)', bg: 'var(--ok-wash)', text: 'var(--ok-ink)', label: 'Active' },
    inactive: { dot: 'var(--warn)', bg: 'var(--warn-wash)', text: 'var(--warn-ink)', label: 'On hold' },
    archived: { dot: 'var(--ink-4)', bg: 'var(--bg-sunken)', text: 'var(--ink-3)', label: 'Archived' },
  }
  const current = map[status] ?? map.active

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: current.bg, color: current.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: current.dot }} />
      {current.label}
    </span>
  )
}

function initialDraftValues(logType?: LogType): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  getEntrySchema(logType).forEach((field) => {
    values[field.field_id] = field.field_type === 'boolean' ? false : ''
  })
  return values
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

function isDraftFieldEmpty(field: SchemaField, value: unknown): boolean {
  if (field.field_type === 'boolean') return value !== true && value !== false ? true : false
  return value === '' || value === null || value === undefined
}

function normalizeDraftValue(field: SchemaField, value: unknown): unknown {
  if (value === '' || value === undefined) return field.field_type === 'boolean' ? false : null
  if (field.field_type === 'number') return typeof value === 'number' ? value : Number(value)
  if (field.field_type === 'boolean') return Boolean(value)
  return value
}

function buildEntryPrimary(entry: LogEntry, fallbackName: unknown): string {
  if (entry.item_name) return entry.item_name
  if (fallbackName != null && fallbackName !== '') return displayVal(fallbackName)
  return entry.category_name
}

function buildEntrySecondary(entry: LogEntry): string {
  if (entry.item_name) return `Catalog item in ${entry.category_name}`
  return `Manual entry in ${entry.category_name}`
}

function buildEntryKeyValues(entry: LogEntry): string {
  return entry.fields
    .filter((field) => field.value != null && field.value !== '' && !isNameLikeField(field.label))
    .slice(0, 3)
    .map((field) => `${field.label}: ${displayVal(field.value)}`)
    .join(' · ')
}

function isNameLikeField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'name' || value.includes('name') || value.includes('item') || value.includes('material')
}

function isQuantityRequired(schema: SchemaField[], itemFields: FieldValue[]): boolean {
  return schema.some((field) => isUnitCostField(field.label)) || itemFields.some((field) => isUnitCostField(field.label))
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

function findUnitCostValue(schema: SchemaField[], itemFields: FieldValue[], values: Record<string, unknown>): number | null {
  const field = schema.find((item) => isUnitCostField(item.label))
  if (field) {
    const value = values[field.field_id]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  const itemField = itemFields.find((item) => isUnitCostField(item.label))
  if (!itemField) return null
  if (typeof itemField.value === 'number' && Number.isFinite(itemField.value)) return itemField.value
  if (typeof itemField.value === 'string' && itemField.value.trim()) {
    const parsed = Number(itemField.value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function findUnitCostLabel(schema: SchemaField[], itemFields: FieldValue[]): string | null {
  return schema.find((field) => isUnitCostField(field.label))?.label
    ?? itemFields.find((field) => isUnitCostField(field.label))?.label
    ?? null
}

function findDirectAmountLabel(schema: SchemaField[]): string | null {
  return schema.find((field) => isDirectAmountField(field.label))?.label ?? null
}

function findTotalCostLabel(schema: SchemaField[]): string | null {
  return schema.find((field) => isTotalCostField(field.label))?.label ?? null
}

function isUnitCostField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'cost' || value.includes('unit cost') || value.includes('cost per unit') || value.includes('rate') || value.includes('price')
}

function isDirectAmountField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value.includes('daily cost') || value.includes('daily payment') || value.includes('payment') || value.includes('amount paid') || value.includes('wage') || value.includes('charges')
}

function isTotalCostField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'total' || value === 'total cost' || value.includes('total cost')
}

function isQuantityField(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'quantity' || value === 'qty' || value.includes('quantity') || value.includes('qty')
}

function extractEntryDetails(entry: LogEntry) {
  const find = (re: RegExp) => {
    const hit = entry.fields.find((field) => re.test((field.label || '').toLowerCase()))
    return hit && hit.value !== '' && hit.value != null ? hit.value : null
  }
  const name = find(/(item|material|name|activity|task|description)/)
  const quantity = entry.quantity ?? toNum(find(/(qty|quantity|count|amount|volume|weight|hours)/))
  const unit = find(/(unit|uom|measure)/)
  let cost = entry.total_cost ?? toNum(find(/(^cost$|total|amount paid|total cost|value)/))
  const unitCost = toNum(find(/(rate|cost\s*per|unit\s*cost|price)/))
  if (cost == null && unitCost != null && quantity != null) cost = unitCost * quantity
  const vendor = find(/(vendor|supplier|contractor|agency|provider)/)
  return { name, quantity, unit, cost, vendor }
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

function computeDraftTotalCost(
  costMode: LogCostMode,
  schema: SchemaField[],
  itemFields: FieldValue[],
  values: Record<string, unknown>,
  quantity: number | null,
): number | null {
  if (costMode === 'direct_amount') return findDirectAmountValue(schema, values) ?? findSchemaTotalCostValue(schema, values)
  if (costMode === 'manual_total') return findSchemaTotalCostValue(schema, values)
  if (quantity == null) return null
  const unitCost = findUnitCostValue(schema, itemFields, values)
  if (unitCost == null) return null
  return quantity * unitCost
}

function findDirectAmountValue(schema: SchemaField[], values: Record<string, unknown>): number | null {
  const field = schema.find((item) => isDirectAmountField(item.label))
  if (!field) return null
  return toNum(values[field.field_id])
}

function findSchemaTotalCostValue(schema: SchemaField[], values: Record<string, unknown>): number | null {
  const field = schema.find((item) => isTotalCostField(item.label))
  if (!field) return null
  return toNum(values[field.field_id])
}

function buildDraftFieldPayload(
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

function deriveCostBreakdown(entries: LogEntry[], spent: number): CostSlice[] {
  const grouped = new Map<string, number>()

  entries.forEach((entry) => {
    const details = extractEntryDetails(entry)
    if (details.cost == null || details.cost <= 0) return

    const key = entry.log_type_name || entry.category_name || 'Other'
    grouped.set(key, (grouped.get(key) ?? 0) + details.cost)
  })

  const mapped = Array.from(grouped.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, value], index) => ({
      label,
      value,
      color: (['accent', 'ok', 'warn', 'ink-3'] as const)[index] ?? 'ink-3',
    }))

  if (mapped.length > 0) return mapped

  const fallbackBase = Math.max(spent, 1)
  return [
    { label: 'Materials', value: fallbackBase * 0.42, color: 'accent' },
    { label: 'Labour', value: fallbackBase * 0.28, color: 'ok' },
    { label: 'Finishing', value: fallbackBase * 0.18, color: 'warn' },
    { label: 'Services', value: fallbackBase * 0.12, color: 'ink-3' },
  ]
}

function buildTeam(project: Project) {
  const leadName = project.lead || 'Project lead'
  return [
    {
      name: leadName,
      role: 'Site lead',
      initial: initials(leadName),
      hue: 262,
      tasks: 12,
    },
    { name: 'Priya Raghavan', role: 'QA engineer', initial: 'PR', hue: 200, tasks: 7 },
    { name: 'Ravi Menon', role: 'Procurement', initial: 'RM', hue: 155, tasks: 4 },
    { name: 'Nikhil Sharma', role: 'Safety officer', initial: 'NS', hue: 25, tasks: 2 },
  ]
}

function buildActivitySeries(entries: LogEntry[], days: number): number[] {
  const counts = new Map<string, number>()
  entries.forEach((entry) => {
    const dateKey = toDateKey(entry.log_date)
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1)
  })

  return Array.from({ length: days }, (_, index) => {
    const date = offsetDate(index - (days - 1)).slice(0, 10)
    return counts.get(date) ?? 0
  })
}

function offsetDate(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString()
}

function toDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'NA'
}

function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

function toNum(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(num) ? num : null
}

function colorVar(color: CostSlice['color']): string {
  return `var(--${color})`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function fmtCr(value: number): string {
  if (!value) return '—'
  return `₹${value % 1 === 0 ? value.toLocaleString('en-IN') : value.toFixed(2)}`
}

function fmtMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

function displayVal(value: unknown): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return String(value)
}
