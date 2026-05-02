import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Save, Download,
  Square, MousePointer, Minus, PanelLeft, LayoutGrid, Trash2, RotateCcw, Pencil,
} from 'lucide-react'
import { useFurnitureStore, type DrawingMode, type DoorType, DEFAULT_SECTION_CONFIG } from '../../stores/furnitureStore'
import DrawingCanvas, { OUTER_BOX_SELECTION_ID } from '../../components/furniture/DrawingCanvas'
import ThreeCanvas from '../../components/furniture/ThreeCanvas'
import { calculateCutList } from '../../utils/cutListCalculator'
import { exportCutListPdf } from '../../utils/exportCutListPdf'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FurnitureDesignerPage() {
  const navigate = useNavigate()
  const { designName, setDesignName, reset } = useFurnitureStore()

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

        <div className="flex-1" />

        <button
          onClick={() => { if (confirm('Reset the entire drawing?')) reset() }}
          className="btn btn-ghost btn-sm flex items-center gap-1.5"
          title="Reset drawing"
        >
          <RotateCcw size={13} />
          Reset
        </button>
        <ExportPdfButton />
        <button className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Save size={13} />
          Save
        </button>
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

// ── Export PDF button ────────────────────────────────────────────────────────

function ExportPdfButton() {
  const { designName, outerBox, shelves, partitions, drawers, material, sectionConfigs, customPanels } = useFurnitureStore()

  const handleExport = () => {
    if (!outerBox) return
    const summary = calculateCutList(outerBox, shelves, partitions, drawers, material, sectionConfigs, customPanels)
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
        const disabled = (m !== 'draw_box' && m !== 'select') && !outerBox

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

// ── Right panel ───────────────────────────────────────────────────────────────

function RightPanel() {
  const { outerBox, setDepth, setThickness, material } = useFurnitureStore()

  return (
    <div
      className="w-64 shrink-0 flex flex-col"
      style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-elev)' }}
    >
      {/* ── 3D Preview ── */}
      <div style={{ height: 220, borderBottom: '1px solid var(--line)', position: 'relative' }}>
        <div
          className="absolute top-2 left-2 z-10 text-[10.5px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}
        >
          3D Preview
        </div>
        <ThreeCanvas />
      </div>

      {/* ── Settings ── */}
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
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
          </div>
        </div>

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

  useEffect(() => {
    if (!outerBox) return
    setWidth(outerBox.width)
    setHeight(outerBox.height)
    setDepthValue(outerBox.depth)
  }, [outerBox])

  const canCreate = !outerBox && width > 0 && height > 0 && depth > 0

  return (
    <div>
      <label className="eyebrow mb-2 block">Box Setup</label>
      <div
        className="rounded-md p-3 space-y-2.5"
        style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}
      >
        <SettingRow
          label="Width"
          value={width}
          disabled={Boolean(outerBox)}
          onChange={(v) => setWidth(v)}
          hint={!outerBox ? 'Create the outer box with an exact width' : undefined}
        />
        <SettingRow
          label="Height"
          value={height}
          disabled={Boolean(outerBox)}
          onChange={(v) => setHeight(v)}
        />
        <SettingRow
          label="Depth"
          value={depth}
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
  label, value, disabled, onChange, hint,
}: {
  label: string; value: number; disabled?: boolean; onChange: (v: number) => void; hint?: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[12px] flex-1" style={{ color: 'var(--ink-3)' }}>{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-20 h-7 px-2 rounded-md text-[12.5px] text-right"
            style={{
              background: disabled ? 'transparent' : 'var(--bg-sunken)',
              border: '1px solid var(--line)',
              color: disabled ? 'var(--ink-4)' : 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
          <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>mm</span>
        </div>
      </div>
      {hint && <p className="text-[11px]" style={{ color: 'var(--ink-4)' }}>{hint}</p>}
    </div>
  )
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
  const { outerBox, shelves, partitions, drawers, material, sectionConfigs, customPanels } = useFurnitureStore()

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

  const summary = calculateCutList(outerBox, shelves, partitions, drawers, material, sectionConfigs, customPanels)

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
