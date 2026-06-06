import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Save, Download,
  Square, MousePointer, Hand, Minus, PanelLeft, LayoutGrid, Trash2, RotateCcw, Pencil, Undo2, Redo2,
  Eye, EyeOff, Ruler, Layers, Box, Maximize2, X, Moon, Sun, Plus, Check, ImagePlus, Copy, Upload,
} from 'lucide-react'
import {
  DEFAULT_BACK_PANEL_THICKNESS,
  DEFAULT_SECTION_CONFIG,
  useFurnitureStore,
  type DrawingMode,
  type DoorType,
  type SelectedFurnitureItem,
} from '../../stores/furnitureStore'
import {
  FURNITURE_PREVIEW_MATERIAL_TARGETS,
  FURNITURE_PREVIEW_MATERIALS,
  getFurniturePreviewMaterial,
  useFurniturePreviewStore,
  type FurniturePreviewMaterial,
  type FurniturePreviewMaterialId,
  type FurniturePreviewMaterialSource,
  type FurniturePreviewMaterialTarget,
  type FurniturePreviewView,
} from '../../stores/furniturePreviewStore'
import {
  FURNITURE_MATERIAL_FINISHES,
  FURNITURE_MATERIAL_FINISH_LABELS,
  FURNITURE_MATERIAL_GRAIN_DIRECTIONS,
  FURNITURE_MATERIAL_GRAIN_DIRECTION_LABELS,
  FURNITURE_MATERIAL_TEXTURE_MIME_TYPES,
  FURNITURE_TEXTURE_MAX_SIZE_BYTES,
  FURNITURE_TEXTURE_REPEAT_LIMITS,
  FURNITURE_TEXTURE_SCALE_LIMITS,
  createFurnitureMaterialId,
  isFurnitureMaterialTextureMimeType,
  type CustomFurnitureMaterial,
  type CustomFurnitureMaterialInput,
  type FurnitureMaterialFinish,
  type FurnitureMaterialGrainDirection,
  type FurnitureMaterialTextureImage,
  type FurnitureMaterialTextureRepeat,
} from '../../types/furnitureMaterials'
import DrawingCanvas, { OUTER_BOX_SELECTION_ID } from '../../components/furniture/DrawingCanvas'
import ThreeCanvas from '../../components/furniture/ThreeCanvas'
import LoadingButton from '../../components/LoadingButton'
import {
  createFurnitureDesign,
  getFurnitureDesign,
  updateFurnitureDesign,
} from '../../services/furnitureDesignService'
import { calculateCutList } from '../../utils/cutListCalculator'
import { exportCutListPdf } from '../../utils/exportCutListPdf'

// ── Page ──────────────────────────────────────────────────────────────────────

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
}

export default function FurnitureDesignerPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const {
    designId,
    designName,
    hasUnsavedChanges,
    lastSavedAt,
    setDesignName,
    reset,
    loadDesign,
    markSaved,
    serializeDesign,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useFurnitureStore()
  const loadPreviewSettings = useFurniturePreviewStore((state) => state.loadPreviewSettings)
  const serializePreviewSettings = useFurniturePreviewStore((state) => state.serializePreviewSettings)
  const markPreviewSaved = useFurniturePreviewStore((state) => state.markSaved)
  const hasUnsavedPreviewChanges = useFurniturePreviewStore((state) => state.hasUnsavedChanges)
  const [loadError, setLoadError] = useState<{ designId: string; message: string } | null>(null)
  const [saveError, setSaveError] = useState<{ scope: string; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const loadErrorMessage = id && loadError?.designId === id ? loadError.message : ''
  const saveScope = id ?? 'new'
  const saveErrorMessage = saveError?.scope === saveScope ? saveError.message : ''
  const loadingDesign = Boolean(id && designId !== id && !loadErrorMessage)

  useEffect(() => {
    loadPreviewSettings(null)

    if (!id) {
      reset()
      return
    }

    let active = true

    getFurnitureDesign(id)
      .then((res) => {
        if (!active) return
        loadDesign(res.data.data)
        loadPreviewSettings(res.data.data.preview_settings)
        setLoadError(null)
      })
      .catch(() => {
        if (!active) return
        setLoadError({
          designId: id,
          message: 'Failed to load this furniture design. It may have been deleted or the backend is not reachable.',
        })
      })

    return () => {
      active = false
    }
  }, [id, loadDesign, loadPreviewSettings, reset])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return

      const key = event.key.toLowerCase()
      const wantsUndo = key === 'z' && !event.shiftKey
      const wantsRedo = (key === 'z' && event.shiftKey) || key === 'y'

      if (wantsUndo && canUndo()) {
        event.preventDefault()
        undo()
        return
      }

      if (wantsRedo && canRedo()) {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canRedo, canUndo, redo, undo])

  if (loadingDesign) {
    return <DesignerLoadingState onBack={() => navigate('/furniture')} />
  }

  if (loadErrorMessage) {
    return <DesignerErrorState message={loadErrorMessage} onBack={() => navigate('/furniture')} />
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        ...serializeDesign(),
        preview_settings: serializePreviewSettings(),
      }
      if (designId) {
        const res = await updateFurnitureDesign(designId, payload)
        markSaved(res.data.data)
        markPreviewSaved()
      } else {
        const res = await createFurnitureDesign(payload)
        markSaved(res.data.data)
        markPreviewSaved()
        navigate(`/furniture/${res.data.data.design_id}`, { replace: true })
      }
    } catch {
      setSaveError({ scope: saveScope, message: 'Failed to save. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetDrawing = () => {
    if (!confirm('Reset the entire drawing?')) return
    reset()
    loadPreviewSettings(null)
  }

  const undoAvailable = canUndo()
  const redoAvailable = canRedo()

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]" style={{ background: 'var(--bg)' }}>

      {/* ── Top toolbar ── */}
      <div
        className="h-12 px-4 flex items-center gap-3 shrink-0"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}
      >
        <button
          onClick={() => navigate('/furniture')}
          className="btn btn-ghost btn-sm btn-icon"
          title="Back to designs"
        >
          <ArrowLeft size={15} />
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--line)' }} />

        <input
          value={designName}
          onChange={(e) => setDesignName(e.target.value)}
          className="bg-transparent outline-none text-[14px] font-medium w-56"
          style={{ color: 'var(--ink)', border: 'none', padding: 0, fontFamily: 'inherit' }}
        />
        <SaveStatus
          saving={saving}
          saveError={saveErrorMessage}
          hasUnsavedChanges={hasUnsavedChanges || hasUnsavedPreviewChanges}
          lastSavedAt={lastSavedAt}
          designId={designId}
        />

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!undoAvailable}
            className="btn btn-ghost btn-sm btn-icon"
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={redo}
            disabled={!redoAvailable}
            className="btn btn-ghost btn-sm btn-icon"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
          >
            <Redo2 size={14} />
          </button>
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--line)' }} />

        <button
          onClick={handleResetDrawing}
          className="btn btn-ghost btn-sm flex items-center gap-1.5"
          title="Reset drawing"
        >
          <RotateCcw size={13} />
          Reset
        </button>
        <ExportPdfButton />
        <LoadingButton
          onClick={handleSave}
          loading={saving}
          loadingText="Saving..."
          className="btn btn-primary btn-sm flex items-center gap-1.5"
          leadingIcon={<Save size={13} />}
        >
          Save
        </LoadingButton>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Mode toolbar (left strip) ── */}
        <ModeToolbar />

        {/* ── 2D Drawing canvas (centre) ── */}
        <div className="flex-1 min-w-0 relative">
          <DrawingCanvas />
        </div>

        {/* ── Right panel ── */}
        <RightPanel />
      </div>
    </div>
  )
}

function SaveStatus({
  saving,
  saveError,
  hasUnsavedChanges,
  lastSavedAt,
  designId,
}: {
  saving: boolean
  saveError: string
  hasUnsavedChanges: boolean
  lastSavedAt: string | null
  designId: string | null
}) {
  if (saving) {
    return <span className="chip chip-accent shrink-0">Saving...</span>
  }
  if (saveError) {
    return <span className="chip chip-bad shrink-0" title={saveError}>Save failed</span>
  }
  if (hasUnsavedChanges) {
    return <span className="chip chip-warn shrink-0">Unsaved changes</span>
  }
  if (designId) {
    return <span className="chip chip-ok shrink-0">{lastSavedAt ? `Saved ${formatSavedAt(lastSavedAt)}` : 'Saved'}</span>
  }
  return <span className="chip shrink-0">Not saved yet</span>
}

function formatSavedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} min ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hr ago`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function DesignerLoadingState({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-[calc(100vh-56px)]" style={{ background: 'var(--bg)' }}>
      <div
        className="h-12 px-4 flex items-center gap-3 shrink-0"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}
      >
        <button onClick={onBack} className="btn btn-ghost btn-sm btn-icon" title="Back to designs">
          <ArrowLeft size={15} />
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--line)' }} />
        <div className="skeleton h-4 w-48" />
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-13 shrink-0" style={{ borderRight: '1px solid var(--line)', background: 'var(--bg-elev)' }} />
        <div className="flex-1 p-8">
          <div className="skeleton h-full w-full rounded-xl" />
        </div>
        <div className="w-64 shrink-0 p-4 space-y-4" style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
          <div className="skeleton h-48 w-full rounded-lg" />
          <div className="skeleton h-24 w-full rounded-lg" />
          <div className="skeleton h-32 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

function DesignerErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex h-[calc(100vh-56px)] items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
      <div className="card max-w-md px-6 py-6 text-center">
        <div className="text-[16px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>
          Could not open design
        </div>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: 'var(--ink-3)' }}>
          {message}
        </p>
        <button onClick={onBack} className="btn btn-primary">
          Back to designs
        </button>
      </div>
    </div>
  )
}

// ── Export PDF button ────────────────────────────────────────────────────────

function ExportPdfButton() {
  const { designName, outerBox, shelves, partitions, drawers, material, sectionConfigs, shelfPartitions, customPanels } = useFurnitureStore()

  const handleExport = () => {
    if (!outerBox) return
    const summary = calculateCutList(outerBox, shelves, partitions, drawers, material, sectionConfigs, shelfPartitions, customPanels)
    exportCutListPdf(designName, 'Furniture', outerBox, summary)
  }

  return (
    <button
      onClick={handleExport}
      disabled={!outerBox}
      className="btn btn-ghost btn-sm flex items-center gap-1.5"
      title={outerBox ? 'Export cut list as PDF' : 'Draw a box first'}
      style={{ opacity: outerBox ? 1 : 0.4 }}
    >
      <Download size={13} />
      Export PDF
    </button>
  )
}

// ── Mode toolbar ──────────────────────────────────────────────────────────────

interface ModeBtn {
  mode: DrawingMode
  Icon: React.ComponentType<{ size?: number }>
  label: string
  shortcut: string
}

const MODE_BUTTONS: ModeBtn[] = [
  { mode: 'draw_box',         Icon: Square,       label: 'Draw Box',       shortcut: 'B' },
  { mode: 'select',           Icon: MousePointer, label: 'Select',         shortcut: 'V' },
  { mode: 'pan',              Icon: Hand,         label: 'Pan Canvas',     shortcut: 'H' },
  { mode: 'add_shelf',        Icon: Minus,        label: 'Add Shelf',      shortcut: 'S' },
  { mode: 'add_partition',    Icon: PanelLeft,    label: 'Add Partition',  shortcut: 'P' },
  { mode: 'add_drawer',       Icon: LayoutGrid,   label: 'Add Drawer',     shortcut: 'D' },
  { mode: 'add_custom_panel', Icon: Pencil,       label: 'Custom Panel',   shortcut: 'C' },
]

function ModeToolbar() {
  const { mode, setMode, outerBox, selectedId, removeSelected } = useFurnitureStore()
  const canDelete = Boolean(selectedId && selectedId !== OUTER_BOX_SELECTION_ID)

  return (
    <div
      className="w-13 shrink-0 flex flex-col items-center py-3 gap-1"
      style={{ borderRight: '1px solid var(--line)', background: 'var(--bg-elev)' }}
    >
      {MODE_BUTTONS.map(({ mode: m, Icon, label, shortcut }) => {
        const active = mode === m
        // shelf/partition/drawer buttons disabled until outer box is drawn
        const disabled = (m !== 'draw_box' && m !== 'select' && m !== 'pan') && !outerBox

        return (
          <button
            key={m}
            onClick={() => !disabled && setMode(m)}
            title={`${label} (${shortcut})`}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all relative group"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'white' : disabled ? 'var(--ink-4)' : 'var(--ink-3)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
            }}
          >
            <Icon size={16} />
            {/* Tooltip */}
            <span
              className="absolute left-12 px-2 py-1 rounded-md text-[11px] whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
              style={{
                background: 'var(--ink)',
                color: 'var(--bg)',
              }}
            >
              {label}
              <span className="ml-1.5 opacity-60">{shortcut}</span>
            </span>
          </button>
        )
      })}

      {/* Separator */}
      <div className="my-1" style={{ width: 28, height: 1, background: 'var(--line)' }} />

      {/* Delete selected */}
      <button
        onClick={() => removeSelected()}
        disabled={!canDelete}
        title="Delete selected (Del)"
        className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
        style={{
          background: 'transparent',
          color: canDelete ? '#ef4444' : 'var(--ink-4)',
          cursor: canDelete ? 'pointer' : 'not-allowed',
          opacity: canDelete ? 1 : 0.3,
        }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

// ── 3D preview toolbar ───────────────────────────────────────────────────────

interface PreviewMaterialTileProps {
  material: FurniturePreviewMaterial
  active: boolean
  designColor: string
  onClick: () => void
}

interface PreviewCustomColorPickerProps {
  value: string
  active: boolean
  onChange: (value: string) => void
  onSelect: () => void
}

interface PreviewControlButtonProps {
  title: string
  Icon: React.ComponentType<{ size?: number }>
  active?: boolean
  onClick: () => void
  label?: string
}

interface PreviewMaterialLibraryProps {
  designColor: string
  customColor: string
  materialSource: FurniturePreviewMaterialSource
  materialApplyTarget: FurniturePreviewMaterialTarget
  selectedMaterialId: FurniturePreviewMaterialId
  selectedCustomMaterialId: string | null
  customMaterials: CustomFurnitureMaterial[]
  onSelectPreset: (id: FurniturePreviewMaterialId) => void
  onSetMaterialApplyTarget: (target: FurniturePreviewMaterialTarget) => void
  onSetCustomColor: (color: string) => void
  onAddCustomMaterial: (material: CustomFurnitureMaterialInput) => CustomFurnitureMaterial
  onUpdateCustomMaterial: (id: string, patch: CustomFurnitureMaterialInput) => void
  onRemoveCustomMaterial: (id: string) => void
  onSelectCustomMaterial: (id: string | null) => void
}

interface PreviewCustomMaterialRowProps {
  material: CustomFurnitureMaterial
  active: boolean
  onSelect: () => void
  onChangeColor: (color: string) => void
  onUploadTexture: (file: File) => void
  onRemoveTexture: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  uploadingTexture: boolean
}

interface MaterialEditorDraft {
  name: string
  baseColor: string
  finish: FurnitureMaterialFinish
  grainDirection: FurnitureMaterialGrainDirection
  texture: FurnitureMaterialTextureImage | null
  textureScale: number
  textureRepeat: FurnitureMaterialTextureRepeat
}

interface MaterialEditorModalProps {
  material: CustomFurnitureMaterial
  onClose: () => void
  onSave: (id: string, patch: CustomFurnitureMaterialInput) => void
}

interface CustomMaterialLibraryExport {
  version: 1
  exportedAt: string
  materials: CustomFurnitureMaterial[]
}

const TEXTURE_UPLOAD_ACCEPT = FURNITURE_MATERIAL_TEXTURE_MIME_TYPES.join(',')
const MATERIAL_LIBRARY_IMPORT_ACCEPT = '.json,application/json'

const MATERIAL_TARGET_LABELS: Record<FurniturePreviewMaterialTarget, string> = {
  all: 'All',
  carcass: 'Body',
  doors: 'Doors',
  drawers: 'Drawers',
  back: 'Back',
}

const previewDockStyle = {
  background: 'rgba(13,18,27,0.68)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
  backdropFilter: 'blur(10px)',
}

function previewSwatchBackground(color: string, secondaryColor: string) {
  return `linear-gradient(135deg, ${color} 0 52%, ${secondaryColor} 52% 100%)`
}

function formatTextureFileSize(sizeBytes: number | undefined) {
  if (!sizeBytes) return ''
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTextureDetails(texture: FurnitureMaterialTextureImage) {
  return [
    texture.width && texture.height ? `${texture.width} x ${texture.height}` : '',
    formatTextureFileSize(texture.sizeBytes),
  ].filter(Boolean).join(' - ')
}

function validateTextureFile(file: File) {
  if (!isFurnitureMaterialTextureMimeType(file.type)) {
    return 'Use a JPG, PNG or WebP texture image.'
  }

  if (file.size > FURNITURE_TEXTURE_MAX_SIZE_BYTES) {
    return `Texture must be ${formatTextureFileSize(FURNITURE_TEXTURE_MAX_SIZE_BYTES)} or smaller.`
  }

  return ''
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Texture file could not be read.'))
    }
    reader.onerror = () => reject(new Error('Texture file could not be read.'))
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Texture image could not be loaded.'))
    image.src = src
  })
}

async function createTextureImageFromFile(file: File): Promise<FurnitureMaterialTextureImage> {
  const src = await readFileAsDataUrl(file)
  let dimensions: { width?: number; height?: number } = {}

  try {
    dimensions = await readImageDimensions(src)
  } catch {
    dimensions = {}
  }

  return {
    id: createFurnitureMaterialId('tex'),
    name: file.name.replace(/\.[^.]+$/, '') || 'Texture',
    source: 'upload',
    src,
    mimeType: isFurnitureMaterialTextureMimeType(file.type) ? file.type : undefined,
    fileName: file.name,
    sizeBytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
  }
}

function clampRange(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function createMaterialEditorDraft(material: CustomFurnitureMaterial): MaterialEditorDraft {
  return {
    name: material.name,
    baseColor: material.baseColor,
    finish: material.finish,
    grainDirection: material.grainDirection,
    texture: material.texture,
    textureScale: material.textureScale,
    textureRepeat: { ...material.textureRepeat },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseImportedTexture(value: unknown): CustomFurnitureMaterialInput['texture'] | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined

  const src = stringField(value, 'src')
  if (!src) return undefined
  const mimeType = stringField(value, 'mimeType') ?? stringField(value, 'mime_type')

  return {
    id: createFurnitureMaterialId('tex'),
    name: stringField(value, 'name'),
    source: stringField(value, 'source') === 'remote' ? 'remote' : 'upload',
    src,
    mimeType: isFurnitureMaterialTextureMimeType(mimeType) ? mimeType : undefined,
    fileName: stringField(value, 'fileName') ?? stringField(value, 'file_name'),
    sizeBytes: numberField(value, 'sizeBytes') ?? numberField(value, 'size_bytes'),
    width: numberField(value, 'width'),
    height: numberField(value, 'height'),
  }
}

function parseImportedTextureRepeat(value: unknown): CustomFurnitureMaterialInput['textureRepeat'] | undefined {
  if (!isRecord(value)) return undefined

  return {
    x: numberField(value, 'x'),
    y: numberField(value, 'y'),
  }
}

function parseImportedMaterial(value: unknown, index: number): CustomFurnitureMaterialInput | null {
  if (!isRecord(value)) return null

  const texture = parseImportedTexture(value.texture)

  return {
    name: stringField(value, 'name') ?? `Imported material ${index + 1}`,
    baseColor: stringField(value, 'baseColor') ?? stringField(value, 'base_color'),
    finish: stringField(value, 'finish') as FurnitureMaterialFinish | undefined,
    grainDirection: (
      stringField(value, 'grainDirection')
      ?? stringField(value, 'grain_direction')
    ) as FurnitureMaterialGrainDirection | undefined,
    texture,
    textureScale: numberField(value, 'textureScale') ?? numberField(value, 'texture_scale'),
    textureRepeat: parseImportedTextureRepeat(value.textureRepeat ?? value.texture_repeat),
  }
}

function extractImportedMaterials(value: unknown) {
  const rawMaterials = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.materials)
      ? value.materials
      : isRecord(value) && Array.isArray(value.customMaterials)
        ? value.customMaterials
        : isRecord(value) && Array.isArray(value.custom_materials)
          ? value.custom_materials
          : []

  return rawMaterials
    .map(parseImportedMaterial)
    .filter((material): material is CustomFurnitureMaterialInput => material !== null)
}

function downloadJsonFile(filename: string, payload: CustomMaterialLibraryExport) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function PreviewMaterialTile({ material, active, designColor, onClick }: PreviewMaterialTileProps) {
  const primaryColor = material.id === 'design' ? designColor : material.color

  return (
    <button
      type="button"
      onClick={onClick}
      title={material.name}
      aria-label={material.name}
      className="h-10 rounded-md px-2 flex items-center gap-2 text-left transition-all min-w-0"
      style={{
        background: active ? 'rgba(37,99,235,0.1)' : 'var(--bg)',
        border: active ? '1px solid rgba(37,99,235,0.5)' : '1px solid var(--line)',
        color: active ? 'var(--accent)' : 'var(--ink-2)',
      }}
    >
      <span
        className="w-5 h-5 rounded shrink-0"
        style={{
          background: previewSwatchBackground(primaryColor, material.secondaryColor),
          border: '1px solid rgba(0,0,0,0.12)',
        }}
      />
      <span className="text-[11.5px] font-medium truncate min-w-0">{material.name}</span>
    </button>
  )
}

function PreviewCustomColorPicker({ value, active, onChange, onSelect }: PreviewCustomColorPickerProps) {
  const customMaterial = getFurniturePreviewMaterial('custom', value)

  return (
    <label
      title={customMaterial.name}
      aria-label={customMaterial.name}
      className="relative h-10 rounded-md px-2 flex items-center gap-2 text-left transition-all overflow-hidden min-w-0"
      onClick={onSelect}
      style={{
        background: active ? 'rgba(37,99,235,0.1)' : 'var(--bg)',
        border: active ? '1px solid rgba(37,99,235,0.5)' : '1px solid var(--line)',
        color: active ? 'var(--accent)' : 'var(--ink-2)',
        cursor: 'pointer',
      }}
    >
      <span
        className="w-5 h-5 rounded shrink-0"
        style={{
          background: previewSwatchBackground(customMaterial.color, customMaterial.secondaryColor),
          border: '1px solid rgba(0,0,0,0.12)',
        }}
      />
      <span className="text-[11.5px] font-medium truncate min-w-0">Quick colour</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onSelect}
        aria-label={customMaterial.name}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </label>
  )
}

function PreviewCustomMaterialRow({
  material,
  active,
  onSelect,
  onChangeColor,
  onUploadTexture,
  onRemoveTexture,
  onEdit,
  onDuplicate,
  onDelete,
  uploadingTexture,
}: PreviewCustomMaterialRowProps) {
  const previewMaterial = getFurniturePreviewMaterial('custom', material.baseColor)
  const textureDetails = material.texture ? formatTextureDetails(material.texture) : ''

  const handleTextureChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onUploadTexture(file)
    event.target.value = ''
  }

  return (
    <div
      className="rounded-md px-2 py-1.5 min-w-0"
      style={{
        background: active ? 'rgba(37,99,235,0.08)' : 'var(--bg)',
        border: active ? '1px solid rgba(37,99,235,0.45)' : '1px solid var(--line)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <label
          title={`Change ${material.name} colour`}
          aria-label={`Change ${material.name} colour`}
          className="relative w-6 h-6 rounded shrink-0 overflow-hidden"
          onClick={onSelect}
          style={{
            background: previewSwatchBackground(previewMaterial.color, previewMaterial.secondaryColor),
            border: '1px solid rgba(0,0,0,0.12)',
            boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.28)' : 'none',
            cursor: 'pointer',
          }}
        >
          <input
            type="color"
            value={material.baseColor}
            onChange={(event) => onChangeColor(event.target.value)}
            onFocus={onSelect}
            aria-label={`Change ${material.name} colour`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onSelect}
            className="block w-full text-left min-w-0"
            title={material.name}
            aria-label={`Select ${material.name}`}
          >
            <span className="block text-[12px] font-medium truncate" style={{ color: active ? 'var(--accent)' : 'var(--ink)' }}>
              {material.name}
            </span>
            <span className="block text-[10.5px] truncate" style={{ color: 'var(--ink-4)' }}>
              {FURNITURE_MATERIAL_FINISH_LABELS[material.finish]} - {FURNITURE_MATERIAL_GRAIN_DIRECTION_LABELS[material.grainDirection]}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <label
            className="btn btn-ghost btn-sm btn-icon relative overflow-hidden"
            title={material.texture ? 'Replace texture' : 'Upload texture'}
            aria-label={material.texture ? 'Replace texture' : 'Upload texture'}
          >
            <ImagePlus size={13} />
            <input
              type="file"
              accept={TEXTURE_UPLOAD_ACCEPT}
              onChange={handleTextureChange}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
          {material.texture && (
            <button
              type="button"
              onClick={onRemoveTexture}
              className="btn btn-ghost btn-sm btn-icon"
              title="Remove texture"
              aria-label="Remove texture"
            >
              <X size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="btn btn-ghost btn-sm btn-icon"
            title="Edit material"
            aria-label="Edit material"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="btn btn-ghost btn-sm btn-icon"
            title="Duplicate material"
            aria-label="Duplicate material"
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="btn btn-ghost btn-sm btn-icon"
            title="Delete material"
            aria-label="Delete material"
            style={{ color: '#ef4444' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {(material.texture || uploadingTexture) && (
        <div className="mt-2 flex items-center gap-2 min-w-0" style={{ paddingLeft: 32 }}>
          <div
            className="w-12 h-9 rounded-md shrink-0 overflow-hidden flex items-center justify-center"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)' }}
          >
            {material.texture ? (
              <img
                src={material.texture.src}
                alt={`${material.name} texture preview`}
                className="w-full h-full object-cover"
              />
            ) : (
              <ImagePlus size={14} style={{ color: 'var(--ink-4)' }} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium truncate" style={{ color: 'var(--ink)' }}>
              {uploadingTexture ? 'Reading texture...' : material.texture?.fileName || material.texture?.name}
            </div>
            {material.texture && (
              <div className="text-[10.5px] truncate" style={{ color: 'var(--ink-4)' }}>
                {textureDetails || 'Texture preview'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MaterialEditorModal({ material, onClose, onSave }: MaterialEditorModalProps) {
  const [draft, setDraft] = useState<MaterialEditorDraft>(() => createMaterialEditorDraft(material))
  const [textureError, setTextureError] = useState('')
  const [uploadingTexture, setUploadingTexture] = useState(false)
  const previewMaterial = getFurniturePreviewMaterial('custom', draft.baseColor)
  const textureDetails = draft.texture ? formatTextureDetails(draft.texture) : ''
  const canSave = draft.name.trim().length > 0

  const updateDraft = (patch: Partial<MaterialEditorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const updateTextureRepeat = (axis: keyof FurnitureMaterialTextureRepeat, value: number) => {
    setDraft((current) => ({
      ...current,
      textureRepeat: {
        ...current.textureRepeat,
        [axis]: clampRange(
          value,
          FURNITURE_TEXTURE_REPEAT_LIMITS.min,
          FURNITURE_TEXTURE_REPEAT_LIMITS.max,
          current.textureRepeat[axis],
        ),
      },
    }))
  }

  const handleTextureChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const validationError = validateTextureFile(file)
    if (validationError) {
      setTextureError(validationError)
      return
    }

    setTextureError('')
    setUploadingTexture(true)

    try {
      const texture = await createTextureImageFromFile(file)
      updateDraft({ texture })
    } catch {
      setTextureError('Could not read this texture image. Try another file.')
    } finally {
      setUploadingTexture(false)
    }
  }

  const handleSave = () => {
    if (!canSave) return

    onSave(material.id, {
      name: draft.name.trim(),
      baseColor: draft.baseColor,
      finish: draft.finish,
      grainDirection: draft.grainDirection,
      texture: draft.texture,
      textureScale: draft.textureScale,
      textureRepeat: draft.textureRepeat,
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-5"
      style={{ background: 'rgba(7,10,16,0.46)' }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[min(760px,calc(100vw-40px))] max-h-[min(720px,calc(100vh-40px))] rounded-lg overflow-hidden flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          boxShadow: '0 24px 72px rgba(0,0,0,0.34)',
        }}
      >
        <div
          className="h-12 px-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}
        >
          <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
            Edit Material
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-icon"
            title="Close"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-[220px_1fr] gap-4 max-md:grid-cols-1">
            <div className="space-y-3">
              <div
                className="aspect-square rounded-md overflow-hidden flex items-center justify-center"
                style={{
                  background: draft.texture
                    ? 'var(--bg)'
                    : previewSwatchBackground(previewMaterial.color, previewMaterial.secondaryColor),
                  border: '1px solid var(--line)',
                }}
              >
                {draft.texture ? (
                  <img
                    src={draft.texture.src}
                    alt={`${draft.name || 'Material'} texture preview`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full" style={{ background: previewSwatchBackground(previewMaterial.color, previewMaterial.secondaryColor) }} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label
                  className="btn btn-ghost btn-sm flex items-center justify-center gap-1.5 relative overflow-hidden"
                  title={draft.texture ? 'Replace texture' : 'Upload texture'}
                >
                  <ImagePlus size={13} />
                  {draft.texture ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept={TEXTURE_UPLOAD_ACCEPT}
                    onChange={handleTextureChange}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setTextureError('')
                    updateDraft({ texture: null })
                  }}
                  disabled={!draft.texture}
                  className="btn btn-ghost btn-sm flex items-center justify-center gap-1.5"
                  title="Remove texture"
                  style={{ opacity: draft.texture ? 1 : 0.45 }}
                >
                  <X size={13} />
                  Remove
                </button>
              </div>

              {(draft.texture || uploadingTexture) && (
                <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                  <div className="font-medium truncate" style={{ color: 'var(--ink)' }}>
                    {uploadingTexture ? 'Reading texture...' : draft.texture?.fileName || draft.texture?.name}
                  </div>
                  {draft.texture && <div>{textureDetails || 'Texture preview'}</div>}
                </div>
              )}

              {textureError && (
                <div className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                  {textureError}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="eyebrow mb-2 block">Name</label>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  className="input w-full"
                  placeholder="Material name"
                />
              </div>

              <div>
                <label className="eyebrow mb-2 block">Colour</label>
                <div className="flex items-center gap-2">
                  <label
                    className="relative w-10 h-10 rounded-md shrink-0 overflow-hidden"
                    style={{
                      background: previewSwatchBackground(previewMaterial.color, previewMaterial.secondaryColor),
                      border: '1px solid var(--line)',
                      cursor: 'pointer',
                    }}
                    title="Change colour"
                  >
                    <input
                      type="color"
                      value={draft.baseColor}
                      onChange={(event) => updateDraft({ baseColor: event.target.value })}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                  <input
                    value={draft.baseColor.toUpperCase()}
                    readOnly
                    className="input flex-1"
                    aria-label="Material colour"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="eyebrow mb-2 block">Finish</label>
                  <select
                    value={draft.finish}
                    onChange={(event) => updateDraft({ finish: event.target.value as FurnitureMaterialFinish })}
                    className="input w-full"
                  >
                    {FURNITURE_MATERIAL_FINISHES.map((finish) => (
                      <option key={finish} value={finish}>
                        {FURNITURE_MATERIAL_FINISH_LABELS[finish]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="eyebrow mb-2 block">Texture Scale</label>
                  <input
                    type="number"
                    min={FURNITURE_TEXTURE_SCALE_LIMITS.min}
                    max={FURNITURE_TEXTURE_SCALE_LIMITS.max}
                    step={0.05}
                    value={draft.textureScale}
                    onChange={(event) => updateDraft({
                      textureScale: clampRange(
                        Number(event.target.value),
                        FURNITURE_TEXTURE_SCALE_LIMITS.min,
                        FURNITURE_TEXTURE_SCALE_LIMITS.max,
                        draft.textureScale,
                      ),
                    })}
                    className="input w-full"
                  />
                </div>
              </div>

              <div>
                <label className="eyebrow mb-2 block">Grain Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  {FURNITURE_MATERIAL_GRAIN_DIRECTIONS.map((direction) => {
                    const active = draft.grainDirection === direction

                    return (
                      <button
                        key={direction}
                        type="button"
                        onClick={() => updateDraft({ grainDirection: direction })}
                        className="h-9 rounded-md px-2 text-[12px] font-medium transition-all"
                        style={{
                          background: active ? 'rgba(37,99,235,0.12)' : 'transparent',
                          border: active ? '1px solid rgba(37,99,235,0.45)' : '1px solid var(--line)',
                          color: active ? 'var(--accent)' : 'var(--ink-2)',
                        }}
                      >
                        {FURNITURE_MATERIAL_GRAIN_DIRECTION_LABELS[direction]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="eyebrow block">Texture Repeat</label>
                  <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
                    {draft.textureRepeat.x.toFixed(2)} x {draft.textureRepeat.y.toFixed(2)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    min={FURNITURE_TEXTURE_REPEAT_LIMITS.min}
                    max={FURNITURE_TEXTURE_REPEAT_LIMITS.max}
                    step={0.25}
                    value={draft.textureRepeat.x}
                    onChange={(event) => updateTextureRepeat('x', Number(event.target.value))}
                    className="input w-full"
                    aria-label="Texture repeat X"
                  />
                  <input
                    type="number"
                    min={FURNITURE_TEXTURE_REPEAT_LIMITS.min}
                    max={FURNITURE_TEXTURE_REPEAT_LIMITS.max}
                    step={0.25}
                    value={draft.textureRepeat.y}
                    onChange={(event) => updateTextureRepeat('y', Number(event.target.value))}
                    className="input w-full"
                    aria-label="Texture repeat Y"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 shrink-0 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--line)' }}>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="btn btn-primary btn-sm flex items-center gap-1.5"
            style={{ opacity: canSave ? 1 : 0.55 }}
          >
            <Check size={13} />
            Save Material
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewMaterialLibrary({
  designColor,
  customColor,
  materialSource,
  materialApplyTarget,
  selectedMaterialId,
  selectedCustomMaterialId,
  customMaterials,
  onSelectPreset,
  onSetMaterialApplyTarget,
  onSetCustomColor,
  onAddCustomMaterial,
  onUpdateCustomMaterial,
  onRemoveCustomMaterial,
  onSelectCustomMaterial,
}: PreviewMaterialLibraryProps) {
  const [editorMaterialId, setEditorMaterialId] = useState<string | null>(null)
  const [textureError, setTextureError] = useState('')
  const [importingMaterials, setImportingMaterials] = useState(false)
  const [uploadingTextureId, setUploadingTextureId] = useState<string | null>(null)
  const selectedCustomMaterial = customMaterials.find((material) => material.id === selectedCustomMaterialId)
  const editorMaterial = customMaterials.find((material) => material.id === editorMaterialId) ?? null
  const selectedPresetMaterial = getFurniturePreviewMaterial(selectedMaterialId, customColor)
  const addColor = materialSource === 'custom_material' && selectedCustomMaterial
    ? selectedCustomMaterial.baseColor
    : selectedPresetMaterial.id === 'design'
      ? designColor
      : selectedPresetMaterial.color
  const savingQuickColor = materialSource === 'preset' && selectedMaterialId === 'custom'
  const addButtonLabel = savingQuickColor ? 'Save colour' : 'Add'

  const openMaterialEditor = (material: CustomFurnitureMaterial) => {
    setTextureError('')
    setEditorMaterialId(material.id)
    onSelectCustomMaterial(material.id)
  }

  const addCustomMaterial = () => {
    const material = onAddCustomMaterial({
      name: `Custom material ${customMaterials.length + 1}`,
      baseColor: addColor,
    })

    openMaterialEditor(material)
  }

  const exportCustomMaterialLibrary = () => {
    if (customMaterials.length === 0) {
      setTextureError('Add at least one custom material before exporting.')
      return
    }

    const exportedAt = new Date().toISOString()

    setTextureError('')
    downloadJsonFile(`furniture-materials-${exportedAt.slice(0, 10)}.json`, {
      version: 1,
      exportedAt,
      materials: customMaterials,
    })
  }

  const importCustomMaterialLibrary = async (file: File) => {
    setTextureError('')
    setImportingMaterials(true)

    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const materials = extractImportedMaterials(parsed)

      if (materials.length === 0) {
        setTextureError('No custom materials found in this JSON file.')
        return
      }

      let importedMaterial: CustomFurnitureMaterial | null = null
      for (const material of materials) {
        importedMaterial = onAddCustomMaterial(material)
      }

      if (importedMaterial) onSelectCustomMaterial(importedMaterial.id)
    } catch {
      setTextureError('Could not import this material library. Use a valid JSON export file.')
    } finally {
      setImportingMaterials(false)
    }
  }

  const handleMaterialLibraryImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void importCustomMaterialLibrary(file)
  }

  const deleteCustomMaterial = (material: CustomFurnitureMaterial) => {
    if (!confirm(`Delete "${material.name}"?`)) return
    if (editorMaterialId === material.id) setEditorMaterialId(null)
    onRemoveCustomMaterial(material.id)
  }

  const duplicateCustomMaterial = (material: CustomFurnitureMaterial) => {
    const duplicatedMaterial = onAddCustomMaterial({
      name: `${material.name} copy`,
      baseColor: material.baseColor,
      finish: material.finish,
      grainDirection: material.grainDirection,
      texture: material.texture
        ? { ...material.texture, id: createFurnitureMaterialId('tex') }
        : null,
      textureScale: material.textureScale,
      textureRepeat: { ...material.textureRepeat },
    })

    openMaterialEditor(duplicatedMaterial)
  }

  const changeCustomMaterialColor = (material: CustomFurnitureMaterial, color: string) => {
    onUpdateCustomMaterial(material.id, { baseColor: color })
    onSelectCustomMaterial(material.id)
  }

  const uploadCustomMaterialTexture = async (material: CustomFurnitureMaterial, file: File) => {
    const validationError = validateTextureFile(file)
    if (validationError) {
      setTextureError(validationError)
      return
    }

    setTextureError('')
    setUploadingTextureId(material.id)

    try {
      const texture = await createTextureImageFromFile(file)
      onUpdateCustomMaterial(material.id, { texture })
      onSelectCustomMaterial(material.id)
    } catch {
      setTextureError('Could not read this texture image. Try another file.')
    } finally {
      setUploadingTextureId(null)
    }
  }

  const removeCustomMaterialTexture = (material: CustomFurnitureMaterial) => {
    setTextureError('')
    onUpdateCustomMaterial(material.id, { texture: null })
    onSelectCustomMaterial(material.id)
  }

  const saveMaterialEditor = (id: string, patch: CustomFurnitureMaterialInput) => {
    setTextureError('')
    onUpdateCustomMaterial(id, patch)
    onSelectCustomMaterial(id)
    setEditorMaterialId(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--ink-4)' }}>
            Apply To
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {FURNITURE_PREVIEW_MATERIAL_TARGETS.map((target) => {
            const active = materialApplyTarget === target

            return (
              <button
                key={target}
                type="button"
                onClick={() => onSetMaterialApplyTarget(target)}
                className="h-8 rounded-md px-1.5 text-[11px] font-medium transition-all"
                style={{
                  background: active ? 'rgba(37,99,235,0.12)' : 'transparent',
                  border: active ? '1px solid rgba(37,99,235,0.45)' : '1px solid var(--line)',
                  color: active ? 'var(--accent)' : 'var(--ink-2)',
                }}
              >
                {MATERIAL_TARGET_LABELS[target]}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--ink-4)' }}>
            Presets
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FURNITURE_PREVIEW_MATERIALS.map((material) => (
            <PreviewMaterialTile
              key={material.id}
              material={material}
              active={materialSource === 'preset' && selectedMaterialId === material.id}
              designColor={designColor}
              onClick={() => onSelectPreset(material.id)}
            />
          ))}
          <PreviewCustomColorPicker
            value={customColor}
            active={materialSource === 'preset' && selectedMaterialId === 'custom'}
            onChange={onSetCustomColor}
            onSelect={() => onSelectPreset('custom')}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--ink-4)' }}>
            Custom
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={exportCustomMaterialLibrary}
              disabled={customMaterials.length === 0}
              className="btn btn-ghost btn-sm btn-icon"
              title="Export custom materials"
              aria-label="Export custom materials"
            >
              <Download size={13} />
            </button>
            <label
              className="btn btn-ghost btn-sm btn-icon relative overflow-hidden"
              title={importingMaterials ? 'Importing materials' : 'Import materials'}
              aria-label="Import materials"
              style={{
                opacity: importingMaterials ? 0.55 : 1,
                pointerEvents: importingMaterials ? 'none' : 'auto',
              }}
            >
              <Upload size={13} />
              <input
                type="file"
                accept={MATERIAL_LIBRARY_IMPORT_ACCEPT}
                disabled={importingMaterials}
                onChange={handleMaterialLibraryImportChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
            <button
              type="button"
              onClick={addCustomMaterial}
              className="btn btn-ghost btn-sm flex items-center gap-1.5"
              title={savingQuickColor ? 'Save quick colour as material' : 'Add custom material'}
            >
              <Plus size={13} />
              {addButtonLabel}
            </button>
          </div>
        </div>

        {textureError && (
          <div className="mb-2 rounded-md px-2 py-1.5 text-[11px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
            {textureError}
          </div>
        )}

        {customMaterials.length > 0 ? (
          <div className="space-y-2">
            {customMaterials.map((material) => (
              <PreviewCustomMaterialRow
                key={material.id}
                material={material}
                active={materialSource === 'custom_material' && selectedCustomMaterialId === material.id}
                onSelect={() => onSelectCustomMaterial(material.id)}
                onChangeColor={(color) => changeCustomMaterialColor(material, color)}
                onUploadTexture={(file) => void uploadCustomMaterialTexture(material, file)}
                onRemoveTexture={() => removeCustomMaterialTexture(material)}
                onEdit={() => openMaterialEditor(material)}
                onDuplicate={() => duplicateCustomMaterial(material)}
                onDelete={() => deleteCustomMaterial(material)}
                uploadingTexture={uploadingTextureId === material.id}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={addCustomMaterial}
            className="h-10 w-full rounded-md flex items-center justify-center gap-2 text-[12px] font-medium transition-all"
            style={{
              background: 'var(--bg)',
              border: '1px dashed var(--line)',
              color: 'var(--ink-3)',
            }}
          >
            <Plus size={13} />
            {savingQuickColor ? 'Save colour' : 'Add material'}
          </button>
        )}
      </div>

      {editorMaterial && (
        <MaterialEditorModal
          key={editorMaterial.id}
          material={editorMaterial}
          onClose={() => setEditorMaterialId(null)}
          onSave={saveMaterialEditor}
        />
      )}
    </div>
  )
}

function PreviewControlButton({ title, Icon, active = false, onClick, label }: PreviewControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="h-9 rounded-md px-2.5 flex items-center justify-center gap-2 text-[12px] font-medium transition-all"
      style={{
        background: active ? 'rgba(37,99,235,0.12)' : 'transparent',
        border: active ? '1px solid rgba(37,99,235,0.45)' : '1px solid var(--line)',
        color: active ? 'var(--accent)' : 'var(--ink-2)',
      }}
    >
      <Icon size={14} />
      {label && <span>{label}</span>}
    </button>
  )
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-4" style={{ borderBottom: '1px solid var(--line)' }}>
      <label className="eyebrow mb-2 block">{title}</label>
      {children}
    </section>
  )
}

const PREVIEW_VIEW_BUTTONS: Array<{
  view: FurniturePreviewView
  title: string
  Icon: React.ComponentType<{ size?: number }>
}> = [
  { view: 'isometric', title: 'Isometric view', Icon: Box },
  { view: 'front', title: 'Front view', Icon: Square },
  { view: 'side', title: 'Side view', Icon: PanelLeft },
  { view: 'top', title: 'Top view', Icon: LayoutGrid },
]

function MiniPreviewControls({ onCustomize }: { onCustomize: () => void }) {
  const resetCamera = useFurniturePreviewStore((state) => state.resetCamera)

  return (
    <div className="absolute inset-x-2 top-2 z-20 flex items-start justify-between gap-2 pointer-events-none">
      <div
        className="h-7 rounded-md px-2 flex items-center text-[11px] font-medium shrink-0"
        style={{
          ...previewDockStyle,
          color: 'rgba(255,255,255,0.82)',
        }}
      >
        3D Preview
      </div>

      <div className="flex items-center gap-1 pointer-events-auto">
        <button
          type="button"
          onClick={resetCamera}
          title="Reset camera"
          aria-label="Reset camera"
          className="h-7 w-7 rounded-md flex items-center justify-center transition-all"
          style={{
            ...previewDockStyle,
            color: 'rgba(255,255,255,0.82)',
          }}
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          onClick={onCustomize}
          className="h-7 rounded-md px-2 flex items-center gap-1.5 text-[11px] font-medium transition-all"
          style={{
            ...previewDockStyle,
            color: 'white',
          }}
        >
          <Maximize2 size={13} />
          Customize
        </button>
      </div>
    </div>
  )
}

function PreviewCustomizeModal({ onClose }: { onClose: () => void }) {
  const designColor = useFurnitureStore((state) => state.material.color)
  const {
    showDoors,
    explodedView,
    explodedAmount,
    showDimensions,
    activeView,
    backgroundMode,
    materialSource,
    materialApplyTarget,
    selectedMaterialId,
    selectedCustomMaterialId,
    customColor,
    customMaterials,
    toggleShowDoors,
    toggleExplodedView,
    setExplodedAmount,
    toggleDimensions,
    setActiveView,
    setBackgroundMode,
    resetCamera,
    setMaterialApplyTarget,
    setSelectedMaterialId,
    setCustomColor,
    addCustomMaterial,
    updateCustomMaterial,
    removeCustomMaterial,
    selectCustomMaterial,
    resetPreview,
  } = useFurniturePreviewStore()
  const DoorIcon = showDoors ? Eye : EyeOff

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(7,10,16,0.62)' }}
    >
      <div
        className="w-[min(1120px,calc(100vw-40px))] h-[min(760px,calc(100vh-40px))] rounded-lg overflow-hidden flex"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          boxShadow: '0 28px 80px rgba(0,0,0,0.32)',
        }}
      >
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            className="h-12 px-4 flex items-center justify-between shrink-0"
            style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                3D Preview
              </div>
            </div>
            <button
              type="button"
              onClick={resetCamera}
              className="btn btn-ghost btn-sm btn-icon"
              title="Reset camera"
              aria-label="Reset camera"
            >
              <RotateCcw size={14} />
            </button>
          </div>
          <div className="relative flex-1 min-h-0">
            <ThreeCanvas />
          </div>
        </div>

        <div
          className="w-72 shrink-0 flex flex-col"
          style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-elev)' }}
        >
          <div
            className="h-12 px-4 flex items-center justify-between shrink-0"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
              Customize
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-sm btn-icon"
              title="Close"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="px-4 overflow-y-auto flex-1">
            <PreviewSection title="View">
              <div className="grid grid-cols-2 gap-2">
                {PREVIEW_VIEW_BUTTONS.map(({ view, title, Icon }) => (
                  <PreviewControlButton
                    key={view}
                    title={title}
                    Icon={Icon}
                    label={title.replace(' view', '')}
                    active={activeView === view}
                    onClick={() => setActiveView(view)}
                  />
                ))}
              </div>
            </PreviewSection>

            <PreviewSection title="Display">
              <div className="space-y-2">
                <PreviewControlButton
                  title={showDoors ? 'Hide doors' : 'Show doors'}
                  Icon={DoorIcon}
                  label="Doors"
                  active={showDoors}
                  onClick={toggleShowDoors}
                />
                <PreviewControlButton
                  title="Exploded view"
                  Icon={Layers}
                  label="Exploded"
                  active={explodedView}
                  onClick={toggleExplodedView}
                />
                {explodedView && (
                  <div className="px-1 pt-0.5 pb-1.5">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={explodedAmount}
                      onChange={(event) => setExplodedAmount(Number(event.target.value))}
                      aria-label="Exploded view amount"
                      title="Exploded view amount"
                      className="block w-full"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                  </div>
                )}
                <PreviewControlButton
                  title="Dimension labels"
                  Icon={Ruler}
                  label="Dimensions"
                  active={showDimensions}
                  onClick={toggleDimensions}
                />
                <div className="grid grid-cols-2 gap-2">
                  <PreviewControlButton
                    title="Dark background"
                    Icon={Moon}
                    label="Dark"
                    active={backgroundMode === 'dark'}
                    onClick={() => setBackgroundMode('dark')}
                  />
                  <PreviewControlButton
                    title="Light background"
                    Icon={Sun}
                    label="Light"
                    active={backgroundMode === 'light'}
                    onClick={() => setBackgroundMode('light')}
                  />
                </div>
              </div>
            </PreviewSection>

            <PreviewSection title="Materials">
              <PreviewMaterialLibrary
                designColor={designColor}
                customColor={customColor}
                materialSource={materialSource}
                materialApplyTarget={materialApplyTarget}
                selectedMaterialId={selectedMaterialId}
                selectedCustomMaterialId={selectedCustomMaterialId}
                customMaterials={customMaterials}
                onSelectPreset={setSelectedMaterialId}
                onSetMaterialApplyTarget={setMaterialApplyTarget}
                onSetCustomColor={setCustomColor}
                onAddCustomMaterial={addCustomMaterial}
                onUpdateCustomMaterial={updateCustomMaterial}
                onRemoveCustomMaterial={removeCustomMaterial}
                onSelectCustomMaterial={selectCustomMaterial}
              />
            </PreviewSection>
          </div>

          <div className="p-4 shrink-0">
            <button
              type="button"
              onClick={resetPreview}
              className="btn btn-ghost btn-sm w-full flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={13} />
              Reset Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Right panel ───────────────────────────────────────────────────────────────

function RightPanel() {
  const { outerBox, setDepth, setThickness, setBackPanelThickness, material, getSelectedItem } = useFurnitureStore()
  const [previewCustomizerOpen, setPreviewCustomizerOpen] = useState(false)
  const selectedItem = getSelectedItem()
  const showSelectedInspector = Boolean(outerBox && selectedItem)
  const backPanelThickness = material.backPanelThickness ?? DEFAULT_BACK_PANEL_THICKNESS
  const maxBackPanelThickness = outerBox ? Math.max(1, outerBox.depth - 1) : undefined

  return (
    <div
      className="w-64 shrink-0 flex flex-col"
      style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-elev)' }}
    >
      {/* ── 3D Preview ── */}
      <div style={{ height: 220, borderBottom: '1px solid var(--line)', position: 'relative' }}>
        <ThreeCanvas />
        <MiniPreviewControls onCustomize={() => setPreviewCustomizerOpen(true)} />
      </div>
      {previewCustomizerOpen && (
        <PreviewCustomizeModal onClose={() => setPreviewCustomizerOpen(false)} />
      )}

      {/* ── Settings ── */}
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {showSelectedInspector ? (
          <SelectedItemInspector />
        ) : (
          <>
            <BoxCreator />

            <div>
              <label className="eyebrow mb-2 block">Depth & Thickness</label>
              <div className="space-y-2">
                <SettingRow
                  label="Depth"
                  value={outerBox?.depth ?? 600}
                  disabled={!outerBox}
                  onChange={(v) => setDepth(v)}
                  hint="How deep the furniture is"
                />
                <SettingRow
                  label="Thickness"
                  value={material.thickness}
                  onChange={(v) => setThickness(v)}
                  hint="Panel board thickness"
                />
                <SettingRow
                  label="Back sheet"
                  value={backPanelThickness}
                  max={maxBackPanelThickness}
                  onChange={(v) => setBackPanelThickness(v)}
                  hint="Back panel sheet thickness"
                />
              </div>
            </div>
          </>
        )}

        {/* Structural presets */}
        <PanelPresets />

        {/* Section settings: doors + hanging rails */}
        <SectionSettings />

        {/* Cut list */}
        <CutList />
      </div>
    </div>
  )
}

function BoxCreator() {
  const { outerBox, setOuterBox } = useFurnitureStore()
  const [width, setWidth] = useState(1200)
  const [height, setHeight] = useState(2100)
  const [depth, setDepthValue] = useState(600)

  const canCreate = !outerBox && width > 0 && height > 0 && depth > 0
  const displayedWidth = outerBox?.width ?? width
  const displayedHeight = outerBox?.height ?? height
  const displayedDepth = outerBox?.depth ?? depth

  return (
    <div>
      <label className="eyebrow mb-2 block">Box Setup</label>
      <div
        className="rounded-md p-3 space-y-2.5"
        style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}
      >
        <SettingRow
          label="Width"
          value={displayedWidth}
          disabled={Boolean(outerBox)}
          onChange={(v) => setWidth(v)}
          hint={!outerBox ? 'Create the outer box with an exact width' : undefined}
        />
        <SettingRow
          label="Height"
          value={displayedHeight}
          disabled={Boolean(outerBox)}
          onChange={(v) => setHeight(v)}
        />
        <SettingRow
          label="Depth"
          value={displayedDepth}
          disabled={Boolean(outerBox)}
          onChange={(v) => setDepthValue(v)}
        />

        <button
          type="button"
          disabled={!canCreate}
          onClick={() => setOuterBox({ width, height, depth })}
          className="btn btn-primary btn-sm w-full"
          style={{ opacity: canCreate ? 1 : 0.5, cursor: canCreate ? 'pointer' : 'not-allowed' }}
        >
          Create Box
        </button>

        <p className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
          {outerBox
            ? 'Use Reset to start a new box from exact dimensions.'
            : 'You can still draw the box manually on the canvas if you prefer.'}
        </p>
      </div>
    </div>
  )
}

function SettingRow({
  label, value, disabled, onChange, hint, min = 1, max, suffix = 'mm',
}: {
  label: string
  value: number
  disabled?: boolean
  onChange: (v: number) => void
  hint?: string
  min?: number
  max?: number
  suffix?: string
}) {
  const updateValue = (raw: string) => {
    const parsed = Number(raw)
    const rounded = Math.round(Number.isFinite(parsed) ? parsed : min)
    const next = Math.max(min, Math.min(max ?? Number.MAX_SAFE_INTEGER, rounded))
    onChange(next)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[12px] flex-1" style={{ color: 'var(--ink-3)' }}>{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={1}
            value={value}
            disabled={disabled}
            onChange={(e) => updateValue(e.target.value)}
            className="w-20 h-7 px-2 rounded-md text-[12.5px] text-right"
            style={{
              background: disabled ? 'transparent' : 'var(--bg-sunken)',
              border: '1px solid var(--line)',
              color: disabled ? 'var(--ink-4)' : 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
          {suffix && <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>{suffix}</span>}
        </div>
      </div>
      {hint && <p className="text-[11px]" style={{ color: 'var(--ink-4)' }}>{hint}</p>}
    </div>
  )
}

function TextSettingRow({
  label,
  value,
  disabled,
  onCommit,
  fallback = value,
}: {
  label: string
  value: string
  disabled?: boolean
  onCommit: (value: string) => void
  fallback?: string
}) {
  const commit = (raw: string) => {
    const next = raw.trim() || fallback
    onCommit(next)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[12px] flex-1" style={{ color: 'var(--ink-3)' }}>{label}</span>
        <input
          type="text"
          key={value}
          defaultValue={value}
          disabled={disabled}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="w-32 h-7 px-2 rounded-md text-[12.5px]"
          style={{
            background: disabled ? 'transparent' : 'var(--bg-sunken)',
            border: '1px solid var(--line)',
            color: disabled ? 'var(--ink-4)' : 'var(--ink)',
            fontFamily: 'inherit',
          }}
        />
      </div>
    </div>
  )
}

function SelectedItemInspector() {
  const {
    outerBox,
    material,
    partitions,
    getSelectedItem,
    updateOuterBox,
    updateShelf,
    updatePartition,
    updateDrawer,
    updateShelfPartition,
    updateCustomPanel,
    removeSelected,
  } = useFurnitureStore()

  const selectedItem = getSelectedItem()
  if (!selectedItem || !outerBox) return null

  const sectionCount = partitions.length + 1
  const interiorHeight = Math.max(1, outerBox.height - material.thickness * 2)
  const backPanelThickness = material.backPanelThickness ?? DEFAULT_BACK_PANEL_THICKNESS
  const interiorDepth = Math.max(1, outerBox.depth - backPanelThickness)
  const maxDrawerSetback = Math.max(0, Math.floor(interiorDepth - material.thickness - 16 - 1))
  const title = selectedItemTitle(selectedItem.type)

  return (
    <div>
      <label className="eyebrow mb-2 block">Selected Item</label>
      <div
        className="rounded-md p-3 space-y-2.5"
        style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}
      >
        <div className="text-[11.5px] font-semibold" style={{ color: 'var(--ink)' }}>
          {title}
          {'sectionIndex' in selectedItem.item && ` · Section ${selectedItem.item.sectionIndex + 1}`}
          {selectedItem.type === 'custom_panel' && selectedItem.item.name ? ` · ${selectedItem.item.name}` : ''}
        </div>

        {selectedItem.type === 'outer_box' && (
          <>
            <SettingRow
              label="Width"
              value={selectedItem.item.width}
              onChange={(v) => updateOuterBox({ width: v })}
            />
            <SettingRow
              label="Height"
              value={selectedItem.item.height}
              onChange={(v) => updateOuterBox({ height: v })}
            />
            <SettingRow
              label="Depth"
              value={selectedItem.item.depth}
              onChange={(v) => updateOuterBox({ depth: v })}
            />
          </>
        )}

        {selectedItem.type === 'shelf' && (
          <>
            <SettingRow
              label="From bottom"
              value={selectedItem.item.fromBottom}
              max={interiorHeight}
              onChange={(v) => updateShelf(selectedItem.id, { fromBottom: v })}
            />
            <SettingRow
              label="Section"
              value={selectedItem.item.sectionIndex + 1}
              min={1}
              max={sectionCount}
              suffix=""
              onChange={(v) => updateShelf(selectedItem.id, { sectionIndex: v - 1 })}
            />
          </>
        )}

        {selectedItem.type === 'partition' && (
          <SettingRow
            label="From left"
            value={selectedItem.item.fromLeft}
            onChange={(v) => updatePartition(selectedItem.id, { fromLeft: v })}
          />
        )}

        {selectedItem.type === 'shelf_partition' && (
          <>
            <SettingRow
              label="Section"
              value={selectedItem.item.sectionIndex + 1}
              min={1}
              max={sectionCount}
              suffix=""
              onChange={(v) => updateShelfPartition(selectedItem.id, { sectionIndex: v - 1 })}
            />
            <SettingRow
              label="From left"
              value={selectedItem.item.fromLeft}
              onChange={(v) => updateShelfPartition(selectedItem.id, { fromLeft: v })}
            />
            <SettingRow
              label="From bottom"
              value={selectedItem.item.fromBottom}
              min={0}
              max={interiorHeight}
              onChange={(v) => updateShelfPartition(selectedItem.id, { fromBottom: v })}
            />
            <SettingRow
              label="To bottom"
              value={selectedItem.item.toBottom}
              min={1}
              max={interiorHeight}
              onChange={(v) => updateShelfPartition(selectedItem.id, { toBottom: v })}
            />
          </>
        )}

        {selectedItem.type === 'drawer' && (
          <>
            <SettingRow
              label="Section"
              value={selectedItem.item.sectionIndex + 1}
              min={1}
              max={sectionCount}
              suffix=""
              onChange={(v) => updateDrawer(selectedItem.id, { sectionIndex: v - 1 })}
            />
            <SettingRow
              label="From bottom"
              value={selectedItem.item.fromBottom}
              min={0}
              max={interiorHeight}
              onChange={(v) => updateDrawer(selectedItem.id, { fromBottom: v })}
            />
            <SettingRow
              label="Height"
              value={selectedItem.item.height}
              max={interiorHeight}
              onChange={(v) => updateDrawer(selectedItem.id, { height: v })}
            />
            <SettingRow
              label="Face setback"
              value={Math.min(selectedItem.item.frontSetback ?? 0, maxDrawerSetback)}
              min={0}
              max={maxDrawerSetback}
              onChange={(v) => updateDrawer(selectedItem.id, { frontSetback: v })}
              hint={`Drawer box depth becomes ${Math.max(1, Math.round(interiorDepth - Math.min(selectedItem.item.frontSetback ?? 0, maxDrawerSetback) - material.thickness - 16))}mm.`}
            />
          </>
        )}

        {selectedItem.type === 'custom_panel' && (
          <>
            <TextSettingRow
              label="Name"
              value={selectedItem.item.name}
              fallback="Custom Panel"
              onCommit={(value) => updateCustomPanel(selectedItem.id, { name: value })}
            />
            <SettingRow
              label="From left"
              value={selectedItem.item.fromLeft}
              min={0}
              onChange={(v) => updateCustomPanel(selectedItem.id, { fromLeft: v })}
            />
            <SettingRow
              label="From bottom"
              value={selectedItem.item.fromBottom}
              min={0}
              onChange={(v) => updateCustomPanel(selectedItem.id, { fromBottom: v })}
            />
            <SettingRow
              label="Width"
              value={selectedItem.item.width}
              onChange={(v) => updateCustomPanel(selectedItem.id, { width: v })}
            />
            <SettingRow
              label="Height"
              value={selectedItem.item.height}
              onChange={(v) => updateCustomPanel(selectedItem.id, { height: v })}
            />
            <SettingRow
              label="Thickness"
              value={selectedItem.item.thickness}
              onChange={(v) => updateCustomPanel(selectedItem.id, { thickness: v })}
            />
          </>
        )}

        {selectedItem.type !== 'outer_box' && (
          <>
            <div style={{ height: 1, background: 'var(--line)' }} />
            <button
              type="button"
              onClick={removeSelected}
              className="btn btn-ghost btn-sm w-full flex items-center justify-center gap-1.5"
              title="Delete selected item"
              style={{ color: '#ef4444' }}
            >
              <Trash2 size={13} />
              Delete Item
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function selectedItemTitle(type: SelectedFurnitureItem['type']) {
  switch (type) {
    case 'outer_box':
      return 'Outer Box'
    case 'shelf':
      return 'Shelf'
    case 'partition':
      return 'Partition'
    case 'shelf_partition':
      return 'Shelf Partition'
    case 'drawer':
      return 'Drawer'
    case 'custom_panel':
      return 'Custom Panel'
  }
}

// ── Cut list ──────────────────────────────────────────────────────────────────

// ── Structural presets ────────────────────────────────────────────────────────

type Preset = {
  label: string
  sub: string
  build: (iW: number, iH: number, T: number) => Omit<import('../../stores/furnitureStore').CustomPanel, 'id'>
}

const PRESETS: Preset[] = [
  {
    label: 'Toe Kick',
    sub: '100mm base board',
    build: (iW, _iH, T) => ({ name: 'Toe Kick',  fromLeft: 0, fromBottom: 0,          width: iW, height: 100, thickness: T }),
  },
  {
    label: 'Cornice',
    sub: '100mm top trim',
    build: (iW, iH, T) => ({ name: 'Cornice',   fromLeft: 0, fromBottom: iH - 100,    width: iW, height: 100, thickness: T }),
  },
  {
    label: 'Mid Rail',
    sub: '80mm centre rail',
    build: (iW, iH, T) => ({ name: 'Mid Rail',  fromLeft: 0, fromBottom: Math.round((iH - 80) / 2), width: iW, height: 80, thickness: T }),
  },
]

function PanelPresets() {
  const { outerBox, material, addCustomPanel } = useFurnitureStore()

  if (!outerBox) return null

  const T  = material.thickness
  const iW = outerBox.width  - T * 2
  const iH = outerBox.height - T * 2

  return (
    <div>
      <label className="eyebrow mb-2 block">Structural Presets</label>
      <div className="grid grid-cols-3 gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addCustomPanel(preset.build(iW, iH, T))}
            title={preset.sub}
            className="flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-md transition-colors text-center"
            style={{
              background: 'var(--bg-sunken)',
              border: '1px solid var(--line)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#22c55e')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
          >
            <span className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>
              {preset.label}
            </span>
            <span className="text-[9px] leading-tight" style={{ color: 'var(--ink-4)' }}>
              {preset.sub}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Section settings (doors + hanging rails) ─────────────────────────────────

const DOOR_OPTIONS: { value: DoorType; label: string }[] = [
  { value: 'none',   label: 'No Door' },
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
]

function SectionSettings() {
  const { outerBox, partitions, sectionConfigs, setSectionConfig } = useFurnitureStore()

  if (!outerBox) return null

  const sectionCount = partitions.length + 1

  return (
    <div>
      <label className="eyebrow mb-2 block">Sections</label>
      <div className="space-y-2">
        {Array.from({ length: sectionCount }, (_, i) => {
          const cfg = sectionConfigs[i] ?? DEFAULT_SECTION_CONFIG
          return (
            <div
              key={i}
              className="rounded-md px-2.5 py-2.5 space-y-2"
              style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}
            >
              <div className="text-[11.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                Section {i + 1}
              </div>

              {/* Door selector */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] flex-1" style={{ color: 'var(--ink-3)' }}>Door</span>
                <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                  {DOOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSectionConfig(i, { door: opt.value })}
                      className="px-2 py-0.5 text-[10.5px] transition-colors"
                      style={{
                        background: cfg.door === opt.value ? 'var(--accent)' : 'var(--bg)',
                        color: cfg.door === opt.value ? 'white' : 'var(--ink-3)',
                        borderRight: opt.value !== 'double' ? '1px solid var(--line)' : 'none',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hanging rail toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] flex-1" style={{ color: 'var(--ink-3)' }}>Hanging Rail</span>
                <button
                  onClick={() => setSectionConfig(i, { hangingRail: !cfg.hangingRail })}
                  className="px-2.5 py-0.5 rounded text-[10.5px] transition-colors"
                  style={{
                    background: cfg.hangingRail ? 'var(--accent)' : 'var(--bg)',
                    color: cfg.hangingRail ? 'white' : 'var(--ink-3)',
                    border: '1px solid var(--line)',
                  }}
                >
                  {cfg.hangingRail ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Cut list ──────────────────────────────────────────────────────────────────

function CutList() {
  const { outerBox, shelves, partitions, drawers, material, sectionConfigs, shelfPartitions, customPanels } = useFurnitureStore()

  if (!outerBox) {
    return (
      <div>
        <label className="eyebrow mb-2 block">Cut List</label>
        <p className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
          Draw or create the furniture box to generate the cut list.
        </p>
      </div>
    )
  }

  const summary = calculateCutList(outerBox, shelves, partitions, drawers, material, sectionConfigs, shelfPartitions, customPanels)

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <label className="eyebrow">Cut List</label>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}
        >
          {summary.totalPieces} pieces
        </span>
      </div>

      <div className="space-y-3">
        {summary.groups.map((group) => (
          <div key={group.category}>
            <div
              className="text-[10.5px] font-semibold uppercase tracking-wide mb-1"
              style={{ color: 'var(--ink-4)' }}
            >
              {group.label}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md px-2.5 py-2"
                  style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--ink)' }}>
                      {item.name}
                    </span>
                    <span
                      className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--accent)', color: 'white', fontSize: 10 }}
                    >
                      ×{item.qty}
                    </span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
                    {item.length} × {item.width} × {item.thickness} mm
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-3 pt-3 text-[11px]"
        style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-3)' }}
      >
        Total board area: <strong style={{ color: 'var(--ink)' }}>{summary.totalAreaM2.toFixed(2)} m²</strong>
      </div>
    </div>
  )
}
