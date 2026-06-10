import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { DRAWER_BOX_HEIGHT_ALLOWANCE, OUTER_BOX_SELECTION_ID, useFurnitureStore } from '../../stores/furnitureStore'
import { useFurniturePreviewStore } from '../../stores/furniturePreviewStore'
import {
  displayHorizontalPanelPosition,
  displayVerticalBoxOffset,
  displayVerticalPanelPosition,
  getSectionForHorizontalRange,
  getSectionForIndex,
  horizontalMeasurementLabel,
  verticalMeasurementLabel,
} from '../../utils/furnitureMeasurements'
import {
  FURNITURE_BOX_FRAME_PADDING,
  FURNITURE_CANVAS_PX_PER_MM,
} from '../../utils/furnitureCanvasGeometry'
export { OUTER_BOX_SELECTION_ID }

// ── Scale ─────────────────────────────────────────────────────────────────────
const PX_PER_MM = FURNITURE_CANVAS_PX_PER_MM
const GRID_MINOR_MM = 50     // minor grid every 50mm
const GRID_MAJOR_MM = 250    // major grid every 250mm
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.02
const MAX_ZOOM = 8
const VIEWPORT_PADDING = 24
const BOX_FRAME_PADDING = FURNITURE_BOX_FRAME_PADDING

function pxToMm(px: number): number {
  return px / PX_PER_MM
}
function mmToPx(mm: number): number {
  return mm * PX_PER_MM
}
function minDrawerHeightMm(thickness: number): number {
  return Math.max(20, thickness + DRAWER_BOX_HEIGHT_ALLOWANCE + 1)
}

// Euclidean distance between two points (px)
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

interface CanvasBox { x: number; y: number; width: number; height: number }
interface PencilSnapGuides { x: number[]; y: number[] }
interface PencilSnapResult {
  x: number
  y: number
  snappedX: boolean
  snappedY: boolean
}

type FillGapKind = 'shelves' | 'partitions'

interface FillGapDraft {
  screenX: number
  screenY: number
  kind: FillGapKind
  count: number
  sectionIndex: number
  fromBottom: number
  toBottom: number
  fromLeft: number
  toLeft: number
  sectionClearStart: number
  sectionClearEnd: number
  isShelfCell: boolean
}

// Interior bounds of the drawn box (in canvas px), accounting for panel thickness
function interiorOf(box: CanvasBox, T: number) {
  return {
    left:   box.x + T,
    right:  box.x + box.width  - T,
    top:    box.y + T,
    bottom: box.y + box.height - T,
  }
}

function isInsideInterior(
  pos: { x: number; y: number },
  box: CanvasBox,
  T: number,
): boolean {
  const { left, right, top, bottom } = interiorOf(box, T)
  return pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom
}

// Returns canvas-pixel left/right boundaries for every section between partitions
function getSectionBoundaries(
  box: CanvasBox,
  partitionsSortedByFromLeft: { id: string; fromLeft: number }[],
  T: number,
): Array<{ index: number; left: number; right: number }> {
  const { left: iLeft, right: iRight } = interiorOf(box, T)
  const xs = [
    iLeft,
    ...partitionsSortedByFromLeft.map((p) => iLeft + mmToPx(p.fromLeft)),
    iRight,
  ]
  return xs.slice(0, -1).map((left, i) => ({ index: i, left, right: xs[i + 1] }))
}

// Returns the open cells between shelves using shelf FACES, not centres.
// Each cell is the empty space between adjacent horizontal surfaces.
function getShelfCells(
  shelfFromBottoms: number[],  // centres in mm (already sorted ascending)
  T_mm: number,
  interiorHeightMm: number,
): Array<{ from: number; to: number }> {
  const cells: Array<{ from: number; to: number }> = []
  let prevTop = 0
  for (const fb of shelfFromBottoms) {
    const shelfBottomFace = Math.max(prevTop, fb - T_mm / 2)
    cells.push({ from: prevTop, to: shelfBottomFace })
    prevTop = fb + T_mm / 2
  }
  cells.push({ from: prevTop, to: interiorHeightMm })
  return cells
}

function getClearVerticalCells(
  shelfFromBottoms: number[],
  drawerSpans: Array<{ fromBottom: number; height: number }>,
  T_mm: number,
  interiorHeightMm: number,
): Array<{ from: number; to: number }> {
  const blockers = [
    ...shelfFromBottoms.map((fromBottom) => ({
      from: Math.max(0, fromBottom - T_mm / 2),
      to: Math.min(interiorHeightMm, fromBottom + T_mm / 2),
    })),
    ...drawerSpans.map((drawer) => ({
      from: Math.max(0, drawer.fromBottom),
      to: Math.min(interiorHeightMm, drawer.fromBottom + drawer.height),
    })),
  ]
    .filter((blocker) => blocker.to > blocker.from)
    .sort((a, b) => a.from - b.from)

  const cells: Array<{ from: number; to: number }> = []
  let cursor = 0

  for (const blocker of blockers) {
    if (blocker.from > cursor) cells.push({ from: cursor, to: blocker.from })
    cursor = Math.max(cursor, blocker.to)
  }

  if (cursor < interiorHeightMm) cells.push({ from: cursor, to: interiorHeightMm })
  return cells
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
}

function snapCoordinate(
  value: number,
  guides: number[],
  threshold: number,
): { value: number; snapped: boolean } {
  const gridValue = Math.round(value / GRID_MINOR_MM) * GRID_MINOR_MM
  let nearest = gridValue
  let nearestDistance = Math.abs(value - gridValue)

  for (const guide of guides) {
    const distance = Math.abs(value - guide)
    if (distance < nearestDistance) {
      nearest = guide
      nearestDistance = distance
    }
  }

  return nearestDistance <= threshold
    ? { value: nearest, snapped: true }
    : { value, snapped: false }
}

function snapPencilPointToGuides(
  point: { x: number; y: number },
  guides: PencilSnapGuides,
  threshold: number,
  enabled: boolean,
): PencilSnapResult {
  if (!enabled) return { ...point, snappedX: false, snappedY: false }

  const x = snapCoordinate(point.x, guides.x, threshold)
  const y = snapCoordinate(point.y, guides.y, threshold)
  return {
    x: x.value,
    y: y.value,
    snappedX: x.snapped,
    snappedY: y.snapped,
  }
}

function freehandPathBounds(points: number[]) {
  const xs = points.filter((_, index) => index % 2 === 0)
  const ys = points.filter((_, index) => index % 2 === 1)
  if (!xs.length || !ys.length) return null
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

function snapDeltaForFreehandPath(
  points: number[],
  deltaX: number,
  deltaY: number,
  guides: PencilSnapGuides,
  threshold: number,
  enabled: boolean,
): { dx: number; dy: number; snappedX: boolean; snappedY: boolean } {
  if (!enabled) return { dx: deltaX, dy: deltaY, snappedX: false, snappedY: false }

  const bounds = freehandPathBounds(points)
  if (!bounds) return { dx: deltaX, dy: deltaY, snappedX: false, snappedY: false }

  const snapAxisDelta = (anchors: number[], axisGuides: number[], delta: number) => {
    let bestAdjustment = 0
    let bestDistance = Number.POSITIVE_INFINITY

    for (const anchor of anchors) {
      const snapped = snapCoordinate(anchor + delta, axisGuides, threshold)
      if (!snapped.snapped) continue
      const adjustment = snapped.value - (anchor + delta)
      const distance = Math.abs(adjustment)
      if (distance < bestDistance) {
        bestAdjustment = adjustment
        bestDistance = distance
      }
    }

    return bestDistance <= threshold
      ? { value: delta + bestAdjustment, snapped: true }
      : { value: delta, snapped: false }
  }

  const x = snapAxisDelta([bounds.left, bounds.centerX, bounds.right], guides.x, deltaX)
  const y = snapAxisDelta([bounds.top, bounds.centerY, bounds.bottom], guides.y, deltaY)

  return { dx: x.value, dy: y.value, snappedX: x.snapped, snappedY: y.snapped }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DrawingCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })

  // Canvas-pixel position of the drawn outer box
  const [boxCanvas, setBoxCanvas] = useState<CanvasBox | null>(null)

  // draw_box drag tracking
  const [drawStart,   setDrawStart]   = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)

  // add_custom_panel drag tracking
  const [customDrawStart,   setCustomDrawStart]   = useState<{ x: number; y: number } | null>(null)
  const [customDrawCurrent, setCustomDrawCurrent] = useState<{ x: number; y: number } | null>(null)

  // add_drawer drag tracking
  const [drawerDrawStart,   setDrawerDrawStart]   = useState<{ x: number; y: number } | null>(null)
  const [drawerDrawCurrent, setDrawerDrawCurrent] = useState<{ x: number; y: number } | null>(null)

  // pencil freehand tracking
  const [pencilPoints, setPencilPoints] = useState<number[] | null>(null)
  const [pencilSnapPreview, setPencilSnapPreview] = useState<PencilSnapResult | null>(null)

  // Current mouse position (always tracked, used for ghost previews)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  // Where mouse went down (used to distinguish click vs drag for add_* modes)
  const [clickStart, setClickStart] = useState<{ x: number; y: number } | null>(null)
  const [fillGapDraft, setFillGapDraft] = useState<FillGapDraft | null>(null)

  const {
    outerBox, mode, material,
    shelves, partitions, drawers, customPanels, shelfPartitions, freehandPaths,
    setOuterBox, addShelf, addPartition, addDrawer, addCustomPanel, addShelfPartition,
    addEqualShelves, addEqualPartitions, addEqualShelfPartitions, addFreehandPath,
    moveShelf, movePartition, moveDrawer, moveCustomPanel, moveShelfPartition, moveFreehandPath, renameCustomPanel,
    pencilStroke, pencilStrokeWidth, pencilSnapEnabled,
    selectedId, setSelected,
  } = useFurnitureStore()
  const {
    measurementHorizontalReference,
    measurementVerticalReference,
    measurementPanelReference,
  } = useFurniturePreviewStore()

  // Live mm value shown while dragging an element
  const [dragLive, setDragLive] = useState<{ id: string; mm: number } | null>(null)
  // Prevents Stage onMouseMove from triggering ghost previews while dragging an element
  const isDraggingElement = useRef(false)
  const viewWasAdjustedRef = useRef(false)
  const T = mmToPx(material.thickness)   // panel thickness in px

  // ── Zoom / pan ────────────────────────────────────────────────────────────
  const [zoom,     setZoom]     = useState(DEFAULT_ZOOM)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panLastRef = useRef<{ x: number; y: number } | null>(null)

  // ── Custom panel inline rename ────────────────────────────────────────────
  const [renamingPanelId, setRenamingPanelId]   = useState<string | null>(null)
  const [renameValue,     setRenameValue]         = useState('Custom Panel')
  const renameInputRef    = useRef<HTMLInputElement>(null)
  // Canvas-px position recorded at drag-end, used to place the floating input
  const pendingRenamePosRef = useRef<{ x: number; y: number; w: number } | null>(null)
  // Track panel count to detect when a new panel is added
  const prevPanelCountRef   = useRef(0)

  // ── Container resize tracking ────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const getCenteredStagePos = useCallback((nextZoom: number) => ({
    x: (size.width * (1 - nextZoom)) / 2,
    y: (size.height * (1 - nextZoom)) / 2,
  }), [size.height, size.width])

  useEffect(() => {
    if (viewWasAdjustedRef.current) return
    setStagePos(getCenteredStagePos(DEFAULT_ZOOM))
  }, [getCenteredStagePos])

  // When store box is cleared (reset), clear local canvas box too
  useEffect(() => {
    if (!outerBox) {
      setBoxCanvas(null)
      setZoom(DEFAULT_ZOOM)
      setStagePos(getCenteredStagePos(DEFAULT_ZOOM))
      viewWasAdjustedRef.current = false
      setFillGapDraft(null)
    }
  }, [outerBox, getCenteredStagePos])

  useEffect(() => {
    if (mode !== 'fill_gap') setFillGapDraft(null)
  }, [mode])

  const fitBoxToViewport = useCallback((widthPx: number, heightPx: number) => {
    const contentWidth = widthPx + BOX_FRAME_PADDING.left + BOX_FRAME_PADDING.right
    const contentHeight = heightPx + BOX_FRAME_PADDING.top + BOX_FRAME_PADDING.bottom
    const availableWidth = Math.max(160, size.width - VIEWPORT_PADDING * 2)
    const availableHeight = Math.max(160, size.height - VIEWPORT_PADDING * 2)
    const fitZoom = Math.max(
      MIN_ZOOM,
      Math.min(
        DEFAULT_ZOOM,
        availableWidth / contentWidth,
        availableHeight / contentHeight,
      ),
    )
    const screenContentWidth = contentWidth * fitZoom
    const screenContentHeight = contentHeight * fitZoom
    const offsetX = (size.width - screenContentWidth) / 2
    const offsetY = (size.height - screenContentHeight) / 2

    setZoom(fitZoom)
    setStagePos({ x: offsetX, y: offsetY })
    setBoxCanvas({
      x: BOX_FRAME_PADDING.left,
      y: BOX_FRAME_PADDING.top,
      width: widthPx,
      height: heightPx,
    })
    viewWasAdjustedRef.current = true
  }, [size.height, size.width])

  useEffect(() => {
    if (!outerBox) return
    fitBoxToViewport(mmToPx(outerBox.width), mmToPx(outerBox.height))
  }, [outerBox?.width, outerBox?.height, fitBoxToViewport])

  // Detect newly added custom panel → open rename popup
  useEffect(() => {
    if (customPanels.length > prevPanelCountRef.current && pendingRenamePosRef.current) {
      const newest = customPanels[customPanels.length - 1]
      setRenamingPanelId(newest.id)
      setRenameValue('Custom Panel')
    }
    prevPanelCountRef.current = customPanels.length
  }, [customPanels.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the rename input whenever it appears
  useEffect(() => {
    if (renamingPanelId) {
      setTimeout(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      }, 30)
    }
  }, [renamingPanelId])

  const commitRename = useCallback(() => {
    if (!renamingPanelId) return
    renameCustomPanel(renamingPanelId, renameValue.trim() || 'Custom Panel')
    setRenamingPanelId(null)
    pendingRenamePosRef.current = null
  }, [renamingPanelId, renameValue, renameCustomPanel])

  // ── Grid lines ───────────────────────────────────────────────────────────

  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = []
    const minor = GRID_MINOR_MM * PX_PER_MM
    const major = GRID_MAJOR_MM * PX_PER_MM
    const viewLeft = Math.floor((-stagePos.x / zoom) / minor) * minor - minor
    const viewTop = Math.floor((-stagePos.y / zoom) / minor) * minor - minor
    const viewRight = Math.ceil(((-stagePos.x + size.width) / zoom) / minor) * minor + minor
    const viewBottom = Math.ceil(((-stagePos.y + size.height) / zoom) / minor) * minor + minor
    const boxRight = outerBox
      ? BOX_FRAME_PADDING.left + mmToPx(outerBox.width) + BOX_FRAME_PADDING.right
      : 0
    const boxBottom = outerBox
      ? BOX_FRAME_PADDING.top + mmToPx(outerBox.height) + BOX_FRAME_PADDING.bottom
      : 0
    const left = Math.min(0, viewLeft)
    const top = Math.min(0, viewTop)
    const right = Math.max(size.width / zoom, viewRight, boxRight)
    const bottom = Math.max(size.height / zoom, viewBottom, boxBottom)

    for (let x = left; x <= right; x += minor) {
      const isMajor = Math.round(x) % Math.round(major) === 0
      lines.push(
        <Line key={`v${x}`} points={[x, top, x, bottom]}
          stroke={isMajor ? '#cccccc' : '#ececec'}
          strokeWidth={isMajor ? 1 : 0.5}
          listening={false} />,
      )
    }
    for (let y = top; y <= bottom; y += minor) {
      const isMajor = Math.round(y) % Math.round(major) === 0
      lines.push(
        <Line key={`h${y}`} points={[left, y, right, y]}
          stroke={isMajor ? '#cccccc' : '#ececec'}
          strokeWidth={isMajor ? 1 : 0.5}
          listening={false} />,
      )
    }
    return lines
  }, [outerBox?.height, outerBox?.width, size.height, size.width, stagePos.x, stagePos.y, zoom])

  const pencilSnapGuides = useMemo<PencilSnapGuides>(() => {
    if (!boxCanvas || !outerBox) return { x: [], y: [] }

    const { left: iLeft, right: iRight, top: iTop, bottom: iBottom } = interiorOf(boxCanvas, T)
    const xs = [
      boxCanvas.x,
      iLeft,
      (iLeft + iRight) / 2,
      iRight,
      boxCanvas.x + boxCanvas.width,
      ...partitions.map((partition) => iLeft + mmToPx(partition.fromLeft)),
      ...shelfPartitions.map((partition) => iLeft + mmToPx(partition.fromLeft)),
      ...customPanels.flatMap((panel) => {
        const left = iLeft + mmToPx(panel.fromLeft)
        const right = left + mmToPx(panel.width)
        return [left, (left + right) / 2, right]
      }),
    ]
    const ys = [
      boxCanvas.y,
      iTop,
      (iTop + iBottom) / 2,
      iBottom,
      boxCanvas.y + boxCanvas.height,
      ...shelves.map((shelf) => iBottom - mmToPx(shelf.fromBottom)),
      ...drawers.flatMap((drawer) => {
        const bottom = iBottom - mmToPx(drawer.fromBottom)
        const top = bottom - mmToPx(drawer.height)
        return [top, (top + bottom) / 2, bottom]
      }),
      ...shelfPartitions.flatMap((partition) => [
        iBottom - mmToPx(partition.fromBottom),
        iBottom - mmToPx(partition.toBottom),
      ]),
      ...customPanels.flatMap((panel) => {
        const bottom = iBottom - mmToPx(panel.fromBottom)
        const top = bottom - mmToPx(panel.height)
        return [top, (top + bottom) / 2, bottom]
      }),
    ]

    return {
      x: uniqueSortedNumbers(xs),
      y: uniqueSortedNumbers(ys),
    }
  }, [
    boxCanvas,
    outerBox,
    T,
    partitions,
    shelfPartitions,
    customPanels,
    shelves,
    drawers,
  ])

  const pencilSnapThreshold = Math.min(24, Math.max(4, 10 / zoom))

  const snapPencilPoint = useCallback((pos: { x: number; y: number }) => (
    snapPencilPointToGuides(pos, pencilSnapGuides, pencilSnapThreshold, pencilSnapEnabled)
  ), [pencilSnapEnabled, pencilSnapGuides, pencilSnapThreshold])

  const snapFreehandMove = useCallback((points: number[], deltaX: number, deltaY: number) => (
    snapDeltaForFreehandPath(
      points,
      deltaX,
      deltaY,
      pencilSnapGuides,
      pencilSnapThreshold,
      pencilSnapEnabled,
    )
  ), [pencilSnapEnabled, pencilSnapGuides, pencilSnapThreshold])

  // ── Mouse handlers ───────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const raw = e.target.getStage()?.getPointerPosition()
    if (!raw) return
    e.evt.preventDefault()

    if (mode === 'pan') {
      panLastRef.current = raw
      setIsPanning(true)
      viewWasAdjustedRef.current = true
      return
    }

    const pos = { x: (raw.x - stagePos.x) / zoom, y: (raw.y - stagePos.y) / zoom }

    setClickStart(pos)

    if (mode === 'draw_box') {
      setDrawStart(pos)
      setDrawCurrent(pos)
    }

    if (mode === 'pencil') {
      const snapped = snapPencilPoint(pos)
      setPencilPoints([snapped.x, snapped.y])
      setPencilSnapPreview(snapped.snappedX || snapped.snappedY ? snapped : null)
    }

    if (mode === 'add_custom_panel' && boxCanvas) {
      const Tpx = mmToPx(material.thickness)
      if (isInsideInterior(pos, boxCanvas, Tpx)) {
        setCustomDrawStart(pos)
        setCustomDrawCurrent(pos)
      }
    }

    if (mode === 'add_drawer' && boxCanvas) {
      const Tpx = mmToPx(material.thickness)
      if (isInsideInterior(pos, boxCanvas, Tpx)) {
        setDrawerDrawStart(pos)
        setDrawerDrawCurrent(pos)
      }
    }
  }, [mode, boxCanvas, material.thickness, snapPencilPoint, zoom, stagePos])

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const raw = e.target.getStage()?.getPointerPosition()
    if (!raw) return

    if (mode === 'pan' && panLastRef.current) {
      const dx = raw.x - panLastRef.current.x
      const dy = raw.y - panLastRef.current.y
      panLastRef.current = raw
      setStagePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
      return
    }

    const pos = { x: (raw.x - stagePos.x) / zoom, y: (raw.y - stagePos.y) / zoom }

    // Suppress ghost previews while user is dragging a placed element
    if (!isDraggingElement.current) setMousePos(pos)

    // Continue draw_box drag
    if (mode === 'draw_box' && drawStart) {
      setDrawCurrent(pos)
    }

    if (mode === 'add_custom_panel' && customDrawStart) {
      setCustomDrawCurrent(pos)
    }

    if (mode === 'add_drawer' && drawerDrawStart) {
      setDrawerDrawCurrent(pos)
    }

    if (mode === 'pencil' && pencilPoints) {
      const snapped = snapPencilPoint(pos)
      setPencilPoints((points) => {
        if (!points) return points
        const lastX = points[points.length - 2]
        const lastY = points[points.length - 1]
        if (Math.abs(lastX - snapped.x) < 0.5 && Math.abs(lastY - snapped.y) < 0.5) return points
        return [...points, snapped.x, snapped.y]
      })
      setPencilSnapPreview(snapped.snappedX || snapped.snappedY ? snapped : null)
    }
  }, [mode, drawStart, customDrawStart, drawerDrawStart, pencilPoints, snapPencilPoint, zoom, stagePos])

  const createFillGapDraft = useCallback((
    pos: { x: number; y: number },
    raw: { x: number; y: number },
  ): FillGapDraft | null => {
    if (!boxCanvas || !outerBox) return null

    const Tpx = mmToPx(material.thickness)
    if (!isInsideInterior(pos, boxCanvas, Tpx)) return null

    const { left: iLeft, bottom: iBottom } = interiorOf(boxCanvas, Tpx)
    const interiorWidthMm = outerBox.width - material.thickness * 2
    const interiorHeightMm = outerBox.height - material.thickness * 2
    const clickFromLeft = Math.round(pxToMm(pos.x - iLeft))
    const clickFromBottom = Math.round(pxToMm(iBottom - pos.y))
    const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
    const sections = getSectionBoundaries(boxCanvas, sorted, Tpx)
    const section = sections.find((item) => pos.x >= item.left && pos.x <= item.right)
    if (!section) return null

    const sectionStart = section.index === 0 ? 0 : sorted[section.index - 1]?.fromLeft
    const sectionEnd = section.index === sorted.length ? interiorWidthMm : sorted[section.index]?.fromLeft
    if (sectionStart === undefined || sectionEnd === undefined) return null

    const sectionClearStart = sectionStart + (section.index === 0 ? 0 : material.thickness / 2)
    const sectionClearEnd = sectionEnd - (section.index === sorted.length ? 0 : material.thickness / 2)
    if (clickFromLeft < sectionClearStart || clickFromLeft > sectionClearEnd) return null

    const sectionShelves = shelves
      .filter((shelf) => shelf.sectionIndex === section.index)
      .map((shelf) => shelf.fromBottom)
      .sort((a, b) => a - b)
    const sectionDrawers = drawers
      .filter((drawer) => drawer.sectionIndex === section.index)
      .map((drawer) => ({ fromBottom: drawer.fromBottom, height: drawer.height }))
    const cell = getClearVerticalCells(sectionShelves, sectionDrawers, material.thickness, interiorHeightMm)
      .find((item) => clickFromBottom >= item.from && clickFromBottom <= item.to)
    if (!cell) return null

    const cellDividers = shelfPartitions
      .filter((partition) => (
        partition.sectionIndex === section.index
        && clickFromBottom >= partition.fromBottom
        && clickFromBottom <= partition.toBottom
      ))
      .sort((a, b) => a.fromLeft - b.fromLeft)

    let gapStart = sectionClearStart
    let gapEnd = sectionClearEnd
    let foundHorizontalGap = cellDividers.length === 0

    for (const divider of cellDividers) {
      const dividerLeftFace = divider.fromLeft - material.thickness / 2
      const dividerRightFace = divider.fromLeft + material.thickness / 2

      if (clickFromLeft >= gapStart && clickFromLeft <= dividerLeftFace) {
        gapEnd = dividerLeftFace
        foundHorizontalGap = true
        break
      }

      gapStart = dividerRightFace
    }

    if (!foundHorizontalGap) {
      if (clickFromLeft >= gapStart && clickFromLeft <= sectionClearEnd) {
        gapEnd = sectionClearEnd
        foundHorizontalGap = true
      }
    }
    if (!foundHorizontalGap || gapEnd <= gapStart) return null

    return {
      screenX: raw.x,
      screenY: raw.y,
      kind: 'shelves',
      count: 1,
      sectionIndex: section.index,
      fromBottom: Math.round(cell.from),
      toBottom: Math.round(cell.to),
      fromLeft: Math.round(gapStart),
      toLeft: Math.round(gapEnd),
      sectionClearStart: Math.round(sectionClearStart),
      sectionClearEnd: Math.round(sectionClearEnd),
      isShelfCell: sectionShelves.length > 0 || sectionDrawers.length > 0,
    }
  }, [boxCanvas, outerBox, material.thickness, partitions, shelves, drawers, shelfPartitions])

  const handleMouseUp = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (mode === 'pan') {
      panLastRef.current = null
      setIsPanning(false)
      setClickStart(null)
      return
    }

    const raw = e.target.getStage()?.getPointerPosition()
    if (!raw) return
    const pos = { x: (raw.x - stagePos.x) / zoom, y: (raw.y - stagePos.y) / zoom }

    // ── draw_box: finalise rectangle ──────────────────────────────────────
    if (mode === 'draw_box' && drawStart && drawCurrent) {
      const w = Math.abs(drawCurrent.x - drawStart.x)
      const h = Math.abs(drawCurrent.y - drawStart.y)

      if (w >= 30 && h >= 30) {
        // Don't set boxCanvas here — fitBoxToViewport (via useEffect) will place
        // it at the canonical position with the correct zoom.
        setOuterBox({ width: Math.round(pxToMm(w)), height: Math.round(pxToMm(h)), depth: 600 })
      }
      setDrawStart(null)
      setDrawCurrent(null)
      setClickStart(null)
      return
    }

    // ── pencil: finalise freehand annotation ─────────────────────────────
    if (mode === 'pencil' && pencilPoints) {
      if (pencilPoints.length >= 4) {
        addFreehandPath({
          points: pencilPoints,
          stroke: pencilStroke,
          strokeWidth: pencilStrokeWidth,
        })
      }
      setPencilPoints(null)
      setPencilSnapPreview(null)
      setClickStart(null)
      return
    }

    // ── fill_gap: click an opening, then choose count/type ───────────────
    if (mode === 'fill_gap' && boxCanvas && outerBox && clickStart) {
      if (dist(clickStart, pos) > 6) { setClickStart(null); return }

      const draft = createFillGapDraft(pos, raw)
      if (draft) {
        setFillGapDraft(draft)
        setSelected(null)
      }
      setClickStart(null)
      return
    }

    // ── add_custom_panel: finalise drag rectangle ─────────────────────────
    if (mode === 'add_custom_panel' && customDrawStart && customDrawCurrent && boxCanvas && outerBox) {
      const Tpx = mmToPx(material.thickness)
      const { left: iLeft, right: iRight, top: iTop, bottom: iBottom } = interiorOf(boxCanvas, Tpx)

      const rawX = Math.min(customDrawStart.x, customDrawCurrent.x)
      const rawY = Math.min(customDrawStart.y, customDrawCurrent.y)
      const rawR = Math.max(customDrawStart.x, customDrawCurrent.x)
      const rawB = Math.max(customDrawStart.y, customDrawCurrent.y)

      // Clamp to interior
      const clampedX = Math.max(iLeft,  rawX)
      const clampedY = Math.max(iTop,   rawY)
      const clampedR = Math.min(iRight, rawR)
      const clampedB = Math.min(iBottom, rawB)
      const clampedW = clampedR - clampedX
      const clampedH = clampedB - clampedY

      if (clampedW >= mmToPx(20) && clampedH >= mmToPx(10)) {
        addCustomPanel({
          name:       'Custom Panel',
          fromLeft:   pxToMm(clampedX - iLeft),
          fromBottom: pxToMm(iBottom - clampedB),
          width:      pxToMm(clampedW),
          height:     pxToMm(clampedH),
          thickness:  material.thickness,
        })
        // Record canvas position so the rename overlay appears at the right spot
        pendingRenamePosRef.current = { x: clampedX, y: clampedY, w: clampedW }
      }

      setCustomDrawStart(null)
      setCustomDrawCurrent(null)
      setClickStart(null)
      return
    }

    // ── add_shelf: place on click (not drag) ──────────────────────────────
    if (mode === 'add_shelf' && boxCanvas && outerBox && clickStart) {
      if (dist(clickStart, pos) > 6) { setClickStart(null); return }

      const T = mmToPx(material.thickness)
      if (!isInsideInterior(pos, boxCanvas, T)) { setClickStart(null); return }

      const interiorHeightMm = outerBox.height - material.thickness * 2
      const fromTopMm = pxToMm(pos.y - (boxCanvas.y + T))
      const fromBottom = Math.max(0, interiorHeightMm - fromTopMm)

      const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
      const sections = getSectionBoundaries(boxCanvas, sorted, T)
      const section  = sections.find((s) => pos.x >= s.left && pos.x <= s.right)

      addShelf(fromBottom, section?.index ?? 0)
    }

    // ── add_partition: full-height OR shelf-cell partition ─────────────────
    if (mode === 'add_partition' && boxCanvas && outerBox && clickStart) {
      if (dist(clickStart, pos) > 6) { setClickStart(null); return }

      const T = mmToPx(material.thickness)
      if (!isInsideInterior(pos, boxCanvas, T)) { setClickStart(null); return }

      const { left: iLeft, bottom: iBottom } = interiorOf(boxCanvas, T)
      const fromLeft = pxToMm(pos.x - iLeft)

      const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
      const sections = getSectionBoundaries(boxCanvas, sorted, T)
      const section  = sections.find((s) => pos.x >= s.left && pos.x <= s.right)
      const sIdx     = section?.index ?? 0

      // Find shelves in this section to see if we're clicking between two shelves
      const interiorHeightMm = outerBox.height - material.thickness * 2
      const sectionShelves   = shelves
        .filter((sh) => sh.sectionIndex === sIdx)
        .map((sh) => sh.fromBottom)
        .sort((a, b) => a - b)

      if (sectionShelves.length > 0) {
        const clickYMm = pxToMm(iBottom - pos.y)
        const cells    = getShelfCells(sectionShelves, material.thickness, interiorHeightMm)
        const cell     = cells.find((c) => clickYMm >= c.from && clickYMm <= c.to)
        // Ignore clicks that land exactly on a shelf panel face
        if (cell) addShelfPartition(sIdx, fromLeft, cell.from, cell.to)
      } else {
        // No shelves in section → full-height section divider
        addPartition(fromLeft)
      }
    }

    // ── add_drawer: finalise drag rectangle ───────────────────────────────
    if (mode === 'add_drawer' && drawerDrawStart && drawerDrawCurrent && boxCanvas && outerBox) {
      const Tpx = mmToPx(material.thickness)
      const { top: iTop, bottom: iBottom } = interiorOf(boxCanvas, Tpx)

      const topY = Math.max(iTop,   Math.min(drawerDrawStart.y, drawerDrawCurrent.y))
      const botY = Math.min(iBottom, Math.max(drawerDrawStart.y, drawerDrawCurrent.y))
      const heightPx = botY - topY

      if (heightPx >= mmToPx(minDrawerHeightMm(material.thickness))) {
        const midX    = (drawerDrawStart.x + drawerDrawCurrent.x) / 2
        const sorted  = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
        const sections = getSectionBoundaries(boxCanvas, sorted, Tpx)
        const section  = sections.find((s) => midX >= s.left && midX <= s.right)

        if (section) {
          addDrawer(section.index, pxToMm(iBottom - botY), pxToMm(heightPx))
        }
      }

      setDrawerDrawStart(null)
      setDrawerDrawCurrent(null)
      setClickStart(null)
      return
    }

    setClickStart(null)
  }, [mode, drawStart, drawCurrent, customDrawStart, customDrawCurrent, drawerDrawStart, drawerDrawCurrent, pencilPoints, boxCanvas, outerBox, material, clickStart, partitions, shelves, addShelf, addPartition, addShelfPartition, addDrawer, addCustomPanel, addFreehandPath, pencilStroke, pencilStrokeWidth, setOuterBox, createFillGapDraft, setSelected, zoom, stagePos])

  const handleMouseLeave = useCallback(() => {
    setMousePos(null)
    setPencilPoints(null)
    setPencilSnapPreview(null)
    panLastRef.current = null
    setIsPanning(false)
  }, [])

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (mode === 'pan') return
    const clickedStage = e.target === e.target.getStage()
    if (clickedStage) setSelected(null)
  }, [mode, setSelected])

  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const SCALE_BY = 1.12
    const newZoom = e.evt.deltaY < 0
      ? Math.min(zoom * SCALE_BY, MAX_ZOOM)
      : Math.max(zoom / SCALE_BY, MIN_ZOOM)
    const mx = (pointer.x - stagePos.x) / zoom
    const my = (pointer.y - stagePos.y) / zoom
    viewWasAdjustedRef.current = true
    setZoom(newZoom)
    setStagePos({ x: pointer.x - mx * newZoom, y: pointer.y - my * newZoom })
  }, [zoom, stagePos])

  // ── Derived canvas values ────────────────────────────────────────────────

  const measurementContext = outerBox
    ? {
        outerWidth: outerBox.width,
        outerHeight: outerBox.height,
        interiorWidth: Math.max(1, outerBox.width - material.thickness * 2),
        interiorHeight: Math.max(1, outerBox.height - material.thickness * 2),
        thickness: material.thickness,
      }
    : null
  const measurementSettings = {
    horizontalReference: measurementHorizontalReference,
    verticalReference: measurementVerticalReference,
    panelReference: measurementPanelReference,
  }

  // Ghost rect while drawing outer box
  const ghostRect: CanvasBox | null = (drawStart && drawCurrent)
    ? {
        x: Math.min(drawStart.x, drawCurrent.x),
        y: Math.min(drawStart.y, drawCurrent.y),
        width:  Math.abs(drawCurrent.x - drawStart.x),
        height: Math.abs(drawCurrent.y - drawStart.y),
      }
    : null

  // Ghost shelf info while hovering in add_shelf mode
  const ghostShelf = useMemo(() => {
    if (mode !== 'add_shelf' || !mousePos || !boxCanvas || !outerBox) return null
    if (!isInsideInterior(mousePos, boxCanvas, T)) return null

    const { bottom } = interiorOf(boxCanvas, T)
    const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
    const sections = getSectionBoundaries(boxCanvas, sorted, T)
    const section  = sections.find((s) => mousePos.x >= s.left && mousePos.x <= s.right)
    if (!section) return null

    const leftOff  = section.index === 0               ? 0 : T / 2
    const rightOff = section.index === sorted.length   ? 0 : T / 2
    const left  = section.left  + leftOff
    const right = section.right - rightOff

    const interiorHeightMm = outerBox.height - material.thickness * 2
    const fromTopMm  = pxToMm(mousePos.y - (boxCanvas.y + T))
    const fromBottom = Math.round(Math.max(0, Math.min(interiorHeightMm, interiorHeightMm - fromTopMm)))
    const canvasY    = bottom - mmToPx(fromBottom)

    return { canvasY, fromBottom, left, right, sectionIndex: section.index }
  }, [mode, mousePos, boxCanvas, outerBox, T, material.thickness, partitions])

  // Ghost partition info while hovering in add_partition mode
  const ghostPartition = useMemo(() => {
    if (mode !== 'add_partition' || !mousePos || !boxCanvas || !outerBox) return null
    if (!isInsideInterior(mousePos, boxCanvas, T)) return null

    const { left: iLeft, top: iTop, bottom: iBottom } = interiorOf(boxCanvas, T)
    const interiorWidthMm  = outerBox.width  - material.thickness * 2
    const interiorHeightMm = outerBox.height - material.thickness * 2
    const fromLeftMm = Math.round(Math.max(0, Math.min(interiorWidthMm, pxToMm(mousePos.x - iLeft))))
    const canvasX    = iLeft + mmToPx(fromLeftMm)

    // Detect which section the mouse is in
    const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
    const sections = getSectionBoundaries(boxCanvas, sorted, T)
    const section  = sections.find((s) => mousePos.x >= s.left && mousePos.x <= s.right)
    const sectionIndex = section?.index ?? 0

    // Find shelves in this section and detect which vertical cell the mouse is in
    const sectionShelves = shelves
      .filter((sh) => sh.sectionIndex === sectionIndex)
      .map((sh) => sh.fromBottom)
      .sort((a, b) => a - b)

    const clickYMm = Math.round(pxToMm(iBottom - mousePos.y))  // mm from interior bottom
    const cells    = getShelfCells(sectionShelves, material.thickness, interiorHeightMm)
    const cell     = cells.find((c) => clickYMm >= c.from && clickYMm <= c.to)

    // Mouse is on a shelf panel itself — no ghost
    if (sectionShelves.length > 0 && !cell) return null

    const cellFromBottom = cell?.from ?? 0
    const cellToBottom   = cell?.to   ?? interiorHeightMm
    const isShelfCell    = sectionShelves.length > 0
    const ghostTop       = iBottom - mmToPx(cellToBottom)
    const ghostBottom    = iBottom - mmToPx(cellFromBottom)

    return {
      canvasX, fromLeft: fromLeftMm,
      top: ghostTop, bottom: ghostBottom,
      isShelfCell, sectionIndex,
      cellFromBottom, cellToBottom,
      iTop,  // original interior top (for the guide line on full-height)
    }
  }, [mode, mousePos, boxCanvas, outerBox, T, material.thickness, partitions, shelves])

  // Ghost drawer: hover = section highlight, drag = actual rectangle
  const ghostDrawer = useMemo(() => {
    if (mode !== 'add_drawer' || !boxCanvas || !outerBox) return null

    const Tpx = mmToPx(material.thickness)
    const { top: iTop, bottom: iBottom } = interiorOf(boxCanvas, Tpx)
    const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
    const sections = getSectionBoundaries(boxCanvas, sorted, Tpx)

    // Helper: wall boundaries need no inset; partition boundaries need Tpx/2 clearance
    const sectionOffsets = (sec: { index: number }) => ({
      leftOff:  sec.index === 0               ? 0 : Tpx / 2,
      rightOff: sec.index === sorted.length   ? 0 : Tpx / 2,
    })

    // ── Drag in progress: show the exact rectangle ──────────────────────
    if (drawerDrawStart && drawerDrawCurrent) {
      const midX    = (drawerDrawStart.x + drawerDrawCurrent.x) / 2
      const section = sections.find((s) => midX >= s.left && midX <= s.right)
      if (!section) return null

      const { leftOff, rightOff } = sectionOffsets(section)
      const topY = Math.max(iTop,   Math.min(drawerDrawStart.y, drawerDrawCurrent.y))
      const botY = Math.min(iBottom, Math.max(drawerDrawStart.y, drawerDrawCurrent.y))

      return {
        kind: 'drag' as const,
        left: section.left + leftOff,
        right: section.right - rightOff,
        drawerTop: topY,
        drawerBottom: botY,
        heightMm:     Math.round(pxToMm(botY - topY)),
        fromBottomMm: Math.round(pxToMm(iBottom - botY)),
      }
    }

    // ── Hover: highlight the section the mouse is in ────────────────────
    if (!mousePos || !isInsideInterior(mousePos, boxCanvas, Tpx)) return null
    const section = sections.find((s) => mousePos.x >= s.left && mousePos.x <= s.right)
    if (!section) return null

    const { leftOff, rightOff } = sectionOffsets(section)
    return {
      kind: 'hover' as const,
      left: section.left + leftOff,
      right: section.right - rightOff,
      drawerTop:    iTop,
      drawerBottom: iBottom,
    }
  }, [mode, mousePos, boxCanvas, outerBox, T, partitions, drawerDrawStart, drawerDrawCurrent, material.thickness])

  // Ghost custom panel while dragging
  const ghostCustomPanel = useMemo(() => {
    if (mode !== 'add_custom_panel' || !customDrawStart || !customDrawCurrent || !boxCanvas) return null
    const Tpx = mmToPx(material.thickness)
    const { left: iLeft, right: iRight, top: iTop, bottom: iBottom } = interiorOf(boxCanvas, Tpx)

    const x = Math.max(iLeft,  Math.min(customDrawStart.x, customDrawCurrent.x))
    const y = Math.max(iTop,   Math.min(customDrawStart.y, customDrawCurrent.y))
    const r = Math.min(iRight, Math.max(customDrawStart.x, customDrawCurrent.x))
    const b = Math.min(iBottom, Math.max(customDrawStart.y, customDrawCurrent.y))
    const w = Math.max(0, r - x)
    const h = Math.max(0, b - y)

    return { x, y, w, h, widthMm: Math.round(pxToMm(w)), heightMm: Math.round(pxToMm(h)) }
  }, [mode, customDrawStart, customDrawCurrent, boxCanvas, material.thickness])

  const hoverFillGap = useMemo(() => {
    if (mode !== 'fill_gap' || !mousePos || !boxCanvas || !outerBox || fillGapDraft) return null

    const raw = {
      x: mousePos.x * zoom + stagePos.x,
      y: mousePos.y * zoom + stagePos.y,
    }
    return createFillGapDraft(mousePos, raw)
  }, [mode, mousePos, boxCanvas, outerBox, fillGapDraft, createFillGapDraft, zoom, stagePos])

  const cursor = (() => {
    if (mode === 'pan') return isPanning ? 'grabbing' : 'grab'
    if (mode === 'draw_box' || mode === 'add_shelf' || mode === 'add_partition' || mode === 'add_drawer' || mode === 'add_custom_panel' || mode === 'fill_gap' || mode === 'pencil') return 'crosshair'
    return 'default'
  })()

  const fillGapCount = fillGapDraft ? Math.max(1, Math.min(20, Math.round(fillGapDraft.count))) : 1
  const fillGapAvailable = fillGapDraft
    ? fillGapDraft.kind === 'shelves'
      ? Math.max(0, fillGapDraft.toBottom - fillGapDraft.fromBottom)
      : Math.max(0, fillGapDraft.toLeft - fillGapDraft.fromLeft)
    : 0
  const fillGapRequired = fillGapCount * material.thickness
  const fillGapCanAdd = Boolean(fillGapDraft && fillGapAvailable >= fillGapRequired)
  const fillGapOpening = fillGapCanAdd
    ? Math.round((fillGapAvailable - fillGapRequired) / (fillGapCount + 1))
    : 0

  const applyFillGap = useCallback(() => {
    if (!fillGapDraft || !measurementContext || !fillGapCanAdd) return

    if (fillGapDraft.kind === 'shelves') {
      addEqualShelves(
        fillGapCount,
        fillGapDraft.sectionIndex,
        fillGapDraft.fromBottom,
        measurementContext.interiorHeight - fillGapDraft.toBottom,
      )
    } else if (fillGapDraft.isShelfCell) {
      addEqualShelfPartitions(
        fillGapCount,
        fillGapDraft.sectionIndex,
        fillGapDraft.fromBottom,
        fillGapDraft.toBottom,
        fillGapDraft.fromLeft,
        fillGapDraft.toLeft,
      )
    } else {
      addEqualPartitions(
        fillGapCount,
        fillGapDraft.sectionIndex,
        fillGapDraft.fromLeft - fillGapDraft.sectionClearStart,
        fillGapDraft.sectionClearEnd - fillGapDraft.toLeft,
      )
    }

    setFillGapDraft(null)
  }, [
    addEqualPartitions,
    addEqualShelfPartitions,
    addEqualShelves,
    fillGapCanAdd,
    fillGapCount,
    fillGapDraft,
    measurementContext,
  ])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#fafafa', position: 'relative' }}
    >
      <Stage
        width={size.width}
        height={size.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleStageClick}
        onWheel={handleWheel}
        style={{ cursor }}
      >
        {/* ── Grid ── */}
        <Layer listening={false} x={stagePos.x} y={stagePos.y} scaleX={zoom} scaleY={zoom}>
          {gridLines}
          <Text x={10} y={10} text="Grid: 50mm · Precision: 1mm" fontSize={10} fill="#bbb" />
        </Layer>

        {/* ── Drawing layer ── */}
        <Layer x={stagePos.x} y={stagePos.y} scaleX={zoom} scaleY={zoom} listening={mode !== 'pan'}>

          {/* Ghost rect while drawing outer box */}
          {ghostRect && ghostRect.width > 2 && ghostRect.height > 2 && (
            <Group listening={false}>
              <Rect
                x={ghostRect.x} y={ghostRect.y}
                width={ghostRect.width} height={ghostRect.height}
                fill="rgba(59,130,246,0.07)"
                stroke="#3b82f6" strokeWidth={1.5}
                dash={[8, 4]}
              />
              <Text
                x={ghostRect.x + ghostRect.width / 2 - 28}
                y={ghostRect.y - 22}
                text={`${Math.round(pxToMm(ghostRect.width))}mm`}
                fontSize={12} fontStyle="bold" fill="#3b82f6"
              />
              <Text
                x={ghostRect.x + ghostRect.width + 6}
                y={ghostRect.y + ghostRect.height / 2 - 8}
                text={`${Math.round(pxToMm(ghostRect.height))}mm`}
                fontSize={12} fontStyle="bold" fill="#3b82f6"
              />
            </Group>
          )}

          {/* Confirmed outer box */}
          {boxCanvas && outerBox && (
            <Group>
              {selectedId === OUTER_BOX_SELECTION_ID && (
                <Rect
                  x={boxCanvas.x - 4}
                  y={boxCanvas.y - 4}
                  width={boxCanvas.width + 8}
                  height={boxCanvas.height + 8}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dash={[8, 4]}
                  listening={false}
                />
              )}
              {/* Outer fill + border — listening=false so interior clicks reach elements */}
              <Rect
                x={boxCanvas.x} y={boxCanvas.y}
                width={boxCanvas.width} height={boxCanvas.height}
                fill="rgba(200,169,110,0.10)"
                stroke={selectedId === OUTER_BOX_SELECTION_ID ? '#3b82f6' : '#b8945a'}
                strokeWidth={selectedId === OUTER_BOX_SELECTION_ID ? 2.5 : 2}
                listening={false}
              />

              {/* Left wall — clickable to select outer box */}
              <Rect
                x={boxCanvas.x} y={boxCanvas.y}
                width={T} height={boxCanvas.height}
                fill="rgba(184,148,90,0.35)"
                stroke="#b8945a" strokeWidth={0.5}
                hitStrokeWidth={8}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.cancelBubble = true; setSelected(OUTER_BOX_SELECTION_ID) }}
              />
              {/* Right wall */}
              <Rect
                x={boxCanvas.x + boxCanvas.width - T} y={boxCanvas.y}
                width={T} height={boxCanvas.height}
                fill="rgba(184,148,90,0.35)"
                stroke="#b8945a" strokeWidth={0.5}
                hitStrokeWidth={8}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.cancelBubble = true; setSelected(OUTER_BOX_SELECTION_ID) }}
              />
              {/* Top wall */}
              <Rect
                x={boxCanvas.x + T} y={boxCanvas.y}
                width={boxCanvas.width - T * 2} height={T}
                fill="rgba(184,148,90,0.35)"
                stroke="#b8945a" strokeWidth={0.5}
                hitStrokeWidth={8}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.cancelBubble = true; setSelected(OUTER_BOX_SELECTION_ID) }}
              />
              {/* Bottom wall */}
              <Rect
                x={boxCanvas.x + T} y={boxCanvas.y + boxCanvas.height - T}
                width={boxCanvas.width - T * 2} height={T}
                fill="rgba(184,148,90,0.35)"
                stroke="#b8945a" strokeWidth={0.5}
                hitStrokeWidth={8}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.cancelBubble = true; setSelected(OUTER_BOX_SELECTION_ID) }}
              />

              {/* ── Width dimension (top) ── */}
              <Line
                points={[boxCanvas.x, boxCanvas.y - 18, boxCanvas.x + boxCanvas.width, boxCanvas.y - 18]}
                stroke="#555" strokeWidth={1} listening={false}
              />
              <Line points={[boxCanvas.x, boxCanvas.y - 24, boxCanvas.x, boxCanvas.y - 12]}
                stroke="#555" strokeWidth={1} listening={false} />
              <Line points={[boxCanvas.x + boxCanvas.width, boxCanvas.y - 24, boxCanvas.x + boxCanvas.width, boxCanvas.y - 12]}
                stroke="#555" strokeWidth={1} listening={false} />
              <Text
                x={boxCanvas.x + boxCanvas.width / 2 - 28}
                y={boxCanvas.y - 33}
                text={`${outerBox.width}mm`}
                fontSize={12} fontStyle="bold" fill="#333" listening={false}
              />

              {/* ── Height dimension (left) ── */}
              <Line
                points={[boxCanvas.x - 18, boxCanvas.y, boxCanvas.x - 18, boxCanvas.y + boxCanvas.height]}
                stroke="#555" strokeWidth={1} listening={false}
              />
              <Line points={[boxCanvas.x - 24, boxCanvas.y, boxCanvas.x - 12, boxCanvas.y]}
                stroke="#555" strokeWidth={1} listening={false} />
              <Line points={[boxCanvas.x - 24, boxCanvas.y + boxCanvas.height, boxCanvas.x - 12, boxCanvas.y + boxCanvas.height]}
                stroke="#555" strokeWidth={1} listening={false} />
              <Text
                x={boxCanvas.x - 30}
                y={boxCanvas.y + boxCanvas.height / 2 + 24}
                text={`${outerBox.height}mm`}
                fontSize={12} fontStyle="bold" fill="#333"
                rotation={-90} listening={false}
              />
            </Group>
          )}

          {/* ── Placed shelves ── */}
          {boxCanvas && outerBox && (() => {
            const { bottom: interiorBottom } = interiorOf(boxCanvas, T)
            const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
            const sections = getSectionBoundaries(boxCanvas, sorted, T)

            return shelves.map((shelf) => {
              const section  = sections[shelf.sectionIndex]
              const leftOff  = shelf.sectionIndex === 0             ? 0 : T / 2
              const rightOff = shelf.sectionIndex === sorted.length ? 0 : T / 2
              const left  = section ? section.left  + leftOff  : interiorOf(boxCanvas, T).left
              const right = section ? section.right - rightOff : interiorOf(boxCanvas, T).right

              const displayFromBottom = dragLive?.id === shelf.id ? dragLive.mm : shelf.fromBottom
              const labelMm = measurementContext
                ? displayVerticalPanelPosition(displayFromBottom, measurementSettings, measurementContext)
                : Math.round(displayFromBottom)
              const shelfCenterY = interiorBottom - mmToPx(displayFromBottom)
              const isSelected   = selectedId === shelf.id

              return (
                <Group key={shelf.id}>
                  <Rect
                    x={left}
                    y={shelfCenterY - T / 2}
                    width={right - left}
                    height={T}
                    fill={isSelected ? 'rgba(59,130,246,0.5)' : 'rgba(184,148,90,0.75)'}
                    stroke={isSelected ? '#3b82f6' : '#b8945a'}
                    strokeWidth={isSelected ? 1.5 : 0.75}
                    hitStrokeWidth={12}
                    draggable={mode === 'select'}
                    style={{ cursor: mode === 'select' ? 'grab' : 'pointer' }}
                    onClick={() => setSelected(shelf.id)}
                    onDragStart={() => {
                      isDraggingElement.current = true
                      setSelected(shelf.id)
                    }}
                    onDragMove={(e) => {
                      const newCenterY = e.target.y() + T / 2
                      const fromBottom = Math.max(0, pxToMm(interiorBottom - newCenterY))
                      setDragLive({ id: shelf.id, mm: fromBottom })
                    }}
                    onDragEnd={(e) => {
                      const newCenterY = e.target.y() + T / 2
                      const fromBottom = Math.max(0, pxToMm(interiorBottom - newCenterY))
                      moveShelf(shelf.id, fromBottom)
                      isDraggingElement.current = false
                      setDragLive(null)
                    }}
                    dragBoundFunc={(pos) => ({
                      x: left * zoom + stagePos.x,
                      y: Math.max(
                        (boxCanvas.y + T) * zoom + stagePos.y,
                        Math.min((interiorBottom - T) * zoom + stagePos.y, pos.y),
                      ),
                    })}
                  />
                  {/* mm label — right of box, follows live position */}
                  <Text
                    x={boxCanvas.x + boxCanvas.width + 8}
                    y={shelfCenterY - 8}
                    text={`${labelMm}mm`}
                    fontSize={11}
                    fontStyle={isSelected ? 'bold' : 'normal'}
                    fill={isSelected || dragLive?.id === shelf.id ? '#3b82f6' : '#888'}
                    listening={false}
                  />
                  <Text
                    x={boxCanvas.x + boxCanvas.width + 8}
                    y={shelfCenterY + 3}
                    text={verticalMeasurementLabel(measurementVerticalReference)}
                    fontSize={9}
                    fill={isSelected || dragLive?.id === shelf.id ? '#3b82f6' : '#aaa'}
                    listening={false}
                  />
                </Group>
              )
            })
          })()}

          {/* ── Placed partitions ── */}
          {boxCanvas && outerBox && partitions.map((partition) => {
            const { left: interiorLeft, right: interiorRight, top, bottom } = interiorOf(boxCanvas, T)
            const displayMm       = dragLive?.id === partition.id ? dragLive.mm : partition.fromLeft
            const partitionCenterX = interiorLeft + mmToPx(displayMm)
            const isSelected      = selectedId === partition.id
            const sortedForBounds = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
            const sortedIndex = sortedForBounds.findIndex((p) => p.id === partition.id)
            const prevPartition = sortedForBounds[sortedIndex - 1]
            const nextPartition = sortedForBounds[sortedIndex + 1]
            const measurementSection = measurementContext
              ? getSectionForHorizontalRange(partitions, measurementContext.interiorWidth, displayMm)
              : undefined
            const labelMm = measurementContext
              ? displayHorizontalPanelPosition(
                  displayMm,
                  measurementSettings,
                  measurementContext,
                  measurementSection?.fromLeft ?? 0,
                )
              : Math.round(displayMm)
            const minCenterX = prevPartition
              ? interiorLeft + mmToPx(prevPartition.fromLeft + material.thickness)
              : interiorLeft + T / 2
            const maxCenterX = nextPartition
              ? interiorLeft + mmToPx(nextPartition.fromLeft - material.thickness)
              : interiorRight - T / 2

            return (
              <Group key={partition.id}>
                <Rect
                  x={partitionCenterX - T / 2}
                  y={top}
                  width={T}
                  height={bottom - top}
                  fill={isSelected ? 'rgba(59,130,246,0.5)' : 'rgba(184,148,90,0.75)'}
                  stroke={isSelected ? '#3b82f6' : '#b8945a'}
                  strokeWidth={isSelected ? 1.5 : 0.75}
                  hitStrokeWidth={12}
                  draggable={mode === 'select'}
                  style={{ cursor: mode === 'select' ? 'grab' : 'pointer' }}
                  onClick={() => setSelected(partition.id)}
                  onDragStart={() => {
                    isDraggingElement.current = true
                    setSelected(partition.id)
                  }}
                  onDragMove={(e) => {
                    const newCenterX = e.target.x() + T / 2
                    const fromLeft = Math.max(0, pxToMm(newCenterX - interiorLeft))
                    setDragLive({ id: partition.id, mm: fromLeft })
                  }}
                  onDragEnd={(e) => {
                    const newCenterX = e.target.x() + T / 2
                    const fromLeft = Math.max(0, pxToMm(newCenterX - interiorLeft))
                    movePartition(partition.id, fromLeft)
                    isDraggingElement.current = false
                    setDragLive(null)
                  }}
                  dragBoundFunc={(pos) => ({
                    x: Math.max((minCenterX - T / 2) * zoom + stagePos.x,
                      Math.min((maxCenterX - T / 2) * zoom + stagePos.x, pos.x)),
                    y: top * zoom + stagePos.y,
                  })}
                />
                {/* mm label — above box, follows live position */}
                <Text
                  x={partitionCenterX - 16}
                  y={boxCanvas.y - 46}
                  text={`${labelMm}mm`}
                  fontSize={11}
                  fontStyle={isSelected ? 'bold' : 'normal'}
                  fill={isSelected || dragLive?.id === partition.id ? '#3b82f6' : '#888'}
                  listening={false}
                />
                <Text
                  x={partitionCenterX - 16}
                  y={boxCanvas.y - 34}
                  text={horizontalMeasurementLabel(measurementHorizontalReference)}
                  fontSize={9}
                  fill={isSelected || dragLive?.id === partition.id ? '#3b82f6' : '#aaa'}
                  listening={false}
                />
                <Line
                  points={[partitionCenterX, boxCanvas.y - 26, partitionCenterX, boxCanvas.y]}
                  stroke={isSelected || dragLive?.id === partition.id ? '#3b82f6' : '#ccc'}
                  strokeWidth={1}
                  dash={[3, 3]}
                  listening={false}
                />
              </Group>
            )
          })}

          {/* ── Placed shelf partitions (between-shelf vertical dividers) ── */}
          {boxCanvas && outerBox && (() => {
            const { bottom: iBottom } = interiorOf(boxCanvas, T)
            const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
            const sections = getSectionBoundaries(boxCanvas, sorted, T)

            return shelfPartitions.map((sp) => {
              const section  = sections[sp.sectionIndex]
              if (!section) return null

              const centX      = interiorOf(boxCanvas, T).left + mmToPx(sp.fromLeft)
              const panelTop   = iBottom - mmToPx(sp.toBottom)
              const panelBot   = iBottom - mmToPx(sp.fromBottom)
              const panelH     = panelBot - panelTop
              const isSelected = selectedId === sp.id
              const measurementSection = measurementContext
                ? getSectionForIndex(partitions, measurementContext.interiorWidth, sp.sectionIndex)
                : undefined
              const labelMm = measurementContext
                ? displayHorizontalPanelPosition(
                    sp.fromLeft,
                    measurementSettings,
                    measurementContext,
                    measurementSection?.fromLeft ?? 0,
                  )
                : Math.round(sp.fromLeft)

              return (
                <Group key={sp.id}>
                  <Rect
                    x={centX - T / 2}
                    y={panelTop}
                    width={T}
                    height={panelH}
                    fill={isSelected ? 'rgba(59,130,246,0.5)' : 'rgba(184,148,90,0.75)'}
                    stroke={isSelected ? '#3b82f6' : '#b8945a'}
                    strokeWidth={isSelected ? 1.5 : 0.75}
                    hitStrokeWidth={12}
                    draggable={mode === 'select'}
                    style={{ cursor: mode === 'select' ? 'grab' : 'pointer' }}
                    onClick={() => setSelected(sp.id)}
                    onDragStart={() => {
                      isDraggingElement.current = true
                      setSelected(sp.id)
                    }}
                    onDragEnd={(e) => {
                      const newCentX = e.target.x() + T / 2
                      const fromLeft = Math.max(0, pxToMm(newCentX - interiorOf(boxCanvas, T).left))
                      moveShelfPartition(sp.id, fromLeft)
                      isDraggingElement.current = false
                    }}
                    dragBoundFunc={(pos) => {
                      const { left: sLeft, right: sRight } = section
                      const minCenterX = sLeft + (sp.sectionIndex === 0 ? T / 2 : T)
                      const maxCenterX = sRight - (sp.sectionIndex === sorted.length ? T / 2 : T)
                      return {
                        x: Math.max((minCenterX - T / 2) * zoom + stagePos.x,
                          Math.min((maxCenterX - T / 2) * zoom + stagePos.x, pos.x)),
                        y: panelTop * zoom + stagePos.y,
                      }
                    }}
                  />
                  {/* mm label beside the panel */}
                  <Text
                    x={centX + T / 2 + 6}
                    y={panelTop + panelH / 2 - 8}
                    text={`${labelMm}mm`}
                    fontSize={10}
                    fontStyle={isSelected ? 'bold' : 'normal'}
                    fill={isSelected ? '#3b82f6' : '#888'}
                    listening={false}
                  />
                </Group>
              )
            })
          })()}

          {/* ── Ghost partition preview (add_partition mode) ── */}
          {ghostPartition && boxCanvas && (() => {
            const section = measurementContext
              ? getSectionForIndex(partitions, measurementContext.interiorWidth, ghostPartition.sectionIndex)
              : undefined
            const labelMm = measurementContext
              ? displayHorizontalPanelPosition(
                  ghostPartition.fromLeft,
                  measurementSettings,
                  measurementContext,
                  section?.fromLeft ?? 0,
                )
              : Math.round(ghostPartition.fromLeft)

            return (
              <Group listening={false}>
                {/* Ghost partition panel — spans only the shelf cell */}
                <Rect
                  x={ghostPartition.canvasX - T / 2}
                  y={ghostPartition.top}
                  width={T}
                  height={ghostPartition.bottom - ghostPartition.top}
                  fill="rgba(59,130,246,0.20)"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dash={[6, 3]}
                />
                {/* Guide line — goes to box top only for full-height partitions */}
                {!ghostPartition.isShelfCell && (
                  <Line
                    points={[ghostPartition.canvasX, boxCanvas.y - 10, ghostPartition.canvasX, ghostPartition.top]}
                    stroke="#3b82f6" strokeWidth={0.75} dash={[4, 4]}
                  />
                )}
                {/* Label — above box for full-height, beside the panel for shelf cells */}
                {ghostPartition.isShelfCell ? (
                  <>
                    <Text
                      x={ghostPartition.canvasX + T / 2 + 6}
                      y={ghostPartition.top + (ghostPartition.bottom - ghostPartition.top) / 2 - 9}
                      text={`${labelMm}mm`}
                      fontSize={11} fontStyle="bold" fill="#3b82f6"
                    />
                    <Text
                      x={ghostPartition.canvasX + T / 2 + 6}
                      y={ghostPartition.top + (ghostPartition.bottom - ghostPartition.top) / 2 + 2}
                      text={`${horizontalMeasurementLabel(measurementHorizontalReference)} · shelf cell`}
                      fontSize={9} fill="#3b82f6" opacity={0.7}
                    />
                  </>
                ) : (
                  <>
                    <Text
                      x={ghostPartition.canvasX - 16}
                      y={boxCanvas.y - 46}
                      text={`${labelMm}mm`}
                      fontSize={12} fontStyle="bold" fill="#3b82f6"
                    />
                    <Text
                      x={ghostPartition.canvasX - 16}
                      y={boxCanvas.y - 34}
                      text={horizontalMeasurementLabel(measurementHorizontalReference)}
                      fontSize={9} fill="#3b82f6" opacity={0.7}
                    />
                  </>
                )}
              </Group>
            )
          })()}

          {/* ── Placed drawers ── */}
          {boxCanvas && outerBox && (() => {
            const { top: interiorTop, bottom: interiorBottom } = interiorOf(boxCanvas, T)
            const sorted   = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
            const sections = getSectionBoundaries(boxCanvas, sorted, T)

            return drawers.map((drawer) => {
              const section = sections[drawer.sectionIndex]
              if (!section) return null

              const displayFromBottom = dragLive?.id === drawer.id ? dragLive.mm : drawer.fromBottom
              const drawerBottom = interiorBottom - mmToPx(displayFromBottom)
              const drawerTop    = drawerBottom   - mmToPx(drawer.height)
              const isSelected   = selectedId === drawer.id
              const drawerH   = mmToPx(drawer.height)
              const labelMm = measurementContext
                ? displayVerticalBoxOffset(
                    displayFromBottom,
                    drawer.height,
                    measurementVerticalReference,
                    measurementContext,
                  )
                : Math.round(displayFromBottom)
              // Wall boundaries need no offset; partition boundaries need T/2 clearance
              const leftOff  = drawer.sectionIndex === 0             ? 0 : T / 2
              const rightOff = drawer.sectionIndex === sorted.length ? 0 : T / 2
              const rectX    = section.left + leftOff
              const rectW    = section.right - section.left - leftOff - rightOff

              return (
                <Group key={drawer.id}>
                  <Rect
                    x={rectX}
                    y={drawerTop}
                    width={rectW}
                    height={drawerH}
                    fill={isSelected ? 'rgba(59,130,246,0.45)' : 'rgba(200,169,110,0.65)'}
                    stroke={isSelected ? '#3b82f6' : '#b8945a'}
                    strokeWidth={isSelected ? 1.5 : 1}
                    hitStrokeWidth={8}
                    draggable={mode === 'select'}
                    style={{ cursor: mode === 'select' ? 'grab' : 'pointer' }}
                    onClick={() => setSelected(drawer.id)}
                    onDragStart={() => {
                      isDraggingElement.current = true
                      setSelected(drawer.id)
                    }}
                    onDragMove={(e) => {
                      const newDrawerBottom = e.target.y() + drawerH
                      const fromBottom = Math.max(0, pxToMm(interiorBottom - newDrawerBottom))
                      setDragLive({ id: drawer.id, mm: fromBottom })
                    }}
                    onDragEnd={(e) => {
                      const newDrawerBottom = e.target.y() + drawerH
                      const fromBottom = Math.max(0, pxToMm(interiorBottom - newDrawerBottom))
                      moveDrawer(drawer.id, fromBottom)
                      isDraggingElement.current = false
                      setDragLive(null)
                    }}
                    dragBoundFunc={(pos) => ({
                      x: rectX * zoom + stagePos.x,
                      y: Math.max(
                        interiorTop * zoom + stagePos.y,
                        Math.min((interiorBottom - drawerH) * zoom + stagePos.y, pos.y),
                      ),
                    })}
                  />
                  {/* Drawer handle line */}
                  <Line
                    points={[rectX + 14, drawerTop + drawerH / 2, rectX + rectW - 14, drawerTop + drawerH / 2]}
                    stroke={isSelected || dragLive?.id === drawer.id ? '#3b82f6' : '#a07840'}
                    strokeWidth={1.5}
                    listening={false}
                  />
                  {/* Height label */}
                  <Text
                    x={section.right - T / 2 + 8}
                    y={drawerTop + drawerH / 2 - 8}
                    text={`${labelMm}mm`}
                    fontSize={11}
                    fontStyle={isSelected ? 'bold' : 'normal'}
                    fill={isSelected || dragLive?.id === drawer.id ? '#3b82f6' : '#888'}
                    listening={false}
                  />
                  <Text
                    x={section.right - T / 2 + 8}
                    y={drawerTop + drawerH / 2 + 3}
                    text={verticalMeasurementLabel(measurementVerticalReference)}
                    fontSize={9}
                    fill={isSelected || dragLive?.id === drawer.id ? '#3b82f6' : '#aaa'}
                    listening={false}
                  />
                  {(drawer.frontSetback ?? 0) > 0 && (
                    <Text
                      x={rectX + 4}
                      y={drawerTop - 13}
                      text={`setback ${drawer.frontSetback}mm`}
                      fontSize={9}
                      fill={isSelected ? '#3b82f6' : '#888'}
                      listening={false}
                    />
                  )}
                </Group>
              )
            })
          })()}

          {/* ── Ghost drawer preview (add_drawer mode) ── */}
          {ghostDrawer && (
            <Group listening={false}>
              {ghostDrawer.kind === 'hover' ? (
                /* Hover: dim section outline — shows which section will receive the drawer */
                <Rect
                  x={ghostDrawer.left}
                  y={ghostDrawer.drawerTop}
                  width={ghostDrawer.right - ghostDrawer.left}
                  height={ghostDrawer.drawerBottom - ghostDrawer.drawerTop}
                  fill="rgba(59,130,246,0.05)"
                  stroke="#3b82f6"
                  strokeWidth={1}
                  dash={[6, 4]}
                />
              ) : (
                /* Drag: solid preview of the actual drawer being drawn */
                <>
                  <Rect
                    x={ghostDrawer.left}
                    y={ghostDrawer.drawerTop}
                    width={ghostDrawer.right - ghostDrawer.left}
                    height={ghostDrawer.drawerBottom - ghostDrawer.drawerTop}
                    fill="rgba(59,130,246,0.18)"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    dash={[6, 3]}
                  />
                  <Line
                    points={[
                      ghostDrawer.left + 14,
                      (ghostDrawer.drawerTop + ghostDrawer.drawerBottom) / 2,
                      ghostDrawer.right - 14,
                      (ghostDrawer.drawerTop + ghostDrawer.drawerBottom) / 2,
                    ]}
                    stroke="#3b82f6" strokeWidth={1.5} opacity={0.5}
                  />
                  <Text
                    x={ghostDrawer.right + 8}
                    y={(ghostDrawer.drawerTop + ghostDrawer.drawerBottom) / 2 - 9}
                    text={`${ghostDrawer.heightMm}mm tall`}
                    fontSize={12} fontStyle="bold" fill="#3b82f6"
                  />
                  <Text
                    x={ghostDrawer.right + 8}
                    y={(ghostDrawer.drawerTop + ghostDrawer.drawerBottom) / 2 + 3}
                    text={`${measurementContext
                      ? displayVerticalBoxOffset(
                          ghostDrawer.fromBottomMm,
                          ghostDrawer.heightMm,
                          measurementVerticalReference,
                          measurementContext,
                        )
                      : ghostDrawer.fromBottomMm}mm ${verticalMeasurementLabel(measurementVerticalReference)}`}
                    fontSize={9} fill="#3b82f6" opacity={0.7}
                  />
                </>
              )}
            </Group>
          )}

          {/* ── Ghost shelf preview (add_shelf mode) ── */}
          {ghostShelf && (() => {
            const labelMm = measurementContext
              ? displayVerticalPanelPosition(ghostShelf.fromBottom, measurementSettings, measurementContext)
              : Math.round(ghostShelf.fromBottom)

            return (
              <Group listening={false}>
                {/* Ghost shelf panel */}
                <Rect
                  x={ghostShelf.left}
                  y={ghostShelf.canvasY - T / 2}
                  width={ghostShelf.right - ghostShelf.left}
                  height={T}
                  fill="rgba(59,130,246,0.20)"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dash={[6, 3]}
                />
                {/* Horizontal guide line */}
                <Line
                  points={[boxCanvas!.x - 10, ghostShelf.canvasY, ghostShelf.left, ghostShelf.canvasY]}
                  stroke="#3b82f6" strokeWidth={0.75} dash={[4, 4]}
                />
                {/* mm label */}
                <Text
                  x={boxCanvas!.x + boxCanvas!.width + 8}
                  y={ghostShelf.canvasY - 9}
                  text={`${labelMm}mm`}
                  fontSize={12} fontStyle="bold" fill="#3b82f6"
                />
                <Text
                  x={boxCanvas!.x + boxCanvas!.width + 8}
                  y={ghostShelf.canvasY + 3}
                  text={verticalMeasurementLabel(measurementVerticalReference)}
                  fontSize={9} fill="#3b82f6" opacity={0.7}
                />
                {/* Height indicator on left */}
                <Text
                  x={boxCanvas!.x - 60}
                  y={ghostShelf.canvasY - 7}
                  text={`${labelMm}mm`}
                  fontSize={11} fontStyle="bold" fill="#3b82f6"
                />
              </Group>
            )
          })()}

          {/* ── Placed custom panels ── */}
          {boxCanvas && outerBox && (() => {
            const { left: iLeft, bottom: iBottom } = interiorOf(boxCanvas, T)
            const iW = outerBox.width - material.thickness * 2

            return customPanels.map((cp) => {
              const cpX  = iLeft + mmToPx(cp.fromLeft)
              const cpW  = mmToPx(cp.width)
              const cpH  = mmToPx(cp.height)
              const cpY  = iBottom - mmToPx(cp.fromBottom) - cpH
              const isSelected = selectedId === cp.id

              return (
                <Group key={cp.id}>
                  <Rect
                    x={cpX} y={cpY} width={cpW} height={cpH}
                    fill={isSelected ? 'rgba(34,197,94,0.50)' : 'rgba(34,197,94,0.22)'}
                    stroke={isSelected ? '#16a34a' : '#22c55e'}
                    strokeWidth={isSelected ? 1.5 : 1}
                    dash={[6, 3]}
                    hitStrokeWidth={8}
                    draggable={mode === 'select'}
                    style={{ cursor: mode === 'select' ? 'grab' : 'pointer' }}
                    onClick={() => setSelected(cp.id)}
                    onDragStart={() => {
                      isDraggingElement.current = true
                      setSelected(cp.id)
                    }}
                    onDragEnd={(e) => {
                      const fromLeft   = Math.max(0, pxToMm(e.target.x() - iLeft))
                      const fromBottom = Math.max(0, pxToMm(iBottom - e.target.y() - cpH))
                      moveCustomPanel(cp.id, fromLeft, fromBottom)
                      isDraggingElement.current = false
                    }}
                    dragBoundFunc={(pos) => ({
                      x: Math.max(iLeft * zoom + stagePos.x, Math.min((iLeft + mmToPx(iW) - cpW) * zoom + stagePos.x, pos.x)),
                      y: Math.max((boxCanvas.y + T) * zoom + stagePos.y, Math.min((iBottom - cpH) * zoom + stagePos.y, pos.y)),
                    })}
                  />
                  {/* Name label inside the panel */}
                  <Text
                    x={cpX + 4} y={cpY + cpH / 2 - 9}
                    text={cp.name}
                    fontSize={10} fontStyle="bold"
                    fill={isSelected ? '#15803d' : '#16a34a'}
                    listening={false}
                  />
                  <Text
                    x={cpX + 4} y={cpY + cpH / 2 + 2}
                    text={`${cp.width}×${cp.height}mm`}
                    fontSize={9}
                    fill={isSelected ? '#15803d' : '#4ade80'}
                    listening={false}
                  />
                </Group>
              )
            })
          })()}

          {/* ── Ghost custom panel (drag to draw) ── */}
          {ghostCustomPanel && ghostCustomPanel.w > 2 && ghostCustomPanel.h > 2 && (
            <Group listening={false}>
              <Rect
                x={ghostCustomPanel.x} y={ghostCustomPanel.y}
                width={ghostCustomPanel.w} height={ghostCustomPanel.h}
                fill="rgba(34,197,94,0.10)"
                stroke="#22c55e" strokeWidth={1.5} dash={[8, 4]}
              />
              <Text
                x={ghostCustomPanel.x + ghostCustomPanel.w / 2 - 24}
                y={ghostCustomPanel.y - 20}
                text={`${ghostCustomPanel.widthMm}mm`}
                fontSize={12} fontStyle="bold" fill="#16a34a"
              />
              <Text
                x={ghostCustomPanel.x + ghostCustomPanel.w + 6}
                y={ghostCustomPanel.y + ghostCustomPanel.h / 2 - 8}
                text={`${ghostCustomPanel.heightMm}mm`}
                fontSize={12} fontStyle="bold" fill="#16a34a"
              />
            </Group>
          )}

          {/* ── Freehand pencil annotations ── */}
          {freehandPaths.map((path) => {
            const isSelected = selectedId === path.id

            return (
              <Group key={path.id}>
                {isSelected && (
                  <Line
                    points={path.points}
                    stroke="#2563eb"
                    strokeWidth={path.strokeWidth + 6}
                    opacity={0.22}
                    tension={0.35}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )}
                <Line
                  points={path.points}
                  stroke={path.stroke}
                  strokeWidth={path.strokeWidth}
                  tension={0.35}
                  lineCap="round"
                  lineJoin="round"
                  hitStrokeWidth={Math.max(12, path.strokeWidth + 8)}
                  draggable={mode === 'select'}
                  listening={mode === 'select'}
                  style={{ cursor: mode === 'select' ? 'grab' : 'default' }}
                  onClick={(event) => {
                    event.cancelBubble = true
                    setSelected(path.id)
                  }}
                  onTap={(event) => {
                    event.cancelBubble = true
                    setSelected(path.id)
                  }}
                  onDragStart={(event) => {
                    event.cancelBubble = true
                    isDraggingElement.current = true
                    setSelected(path.id)
                  }}
                  onDragMove={(event) => {
                    const snapped = snapFreehandMove(path.points, event.target.x(), event.target.y())
                    event.target.position({ x: snapped.dx, y: snapped.dy })
                    const bounds = freehandPathBounds(path.points)
                    setPencilSnapPreview(
                      bounds && (snapped.snappedX || snapped.snappedY)
                        ? {
                          x: bounds.centerX + snapped.dx,
                          y: bounds.centerY + snapped.dy,
                          snappedX: snapped.snappedX,
                          snappedY: snapped.snappedY,
                        }
                        : null,
                    )
                  }}
                  onDragEnd={(event) => {
                    const snapped = snapFreehandMove(path.points, event.target.x(), event.target.y())
                    event.target.position({ x: 0, y: 0 })
                    moveFreehandPath(path.id, snapped.dx, snapped.dy)
                    isDraggingElement.current = false
                    setPencilSnapPreview(null)
                  }}
                />
              </Group>
            )
          })}
          {pencilPoints && pencilPoints.length >= 4 && (
            <Line
              points={pencilPoints}
              stroke={pencilStroke}
              strokeWidth={pencilStrokeWidth}
              tension={0.35}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}
          {pencilSnapPreview && (
            <Group listening={false}>
              <Line
                points={[
                  pencilSnapPreview.x - 8,
                  pencilSnapPreview.y,
                  pencilSnapPreview.x + 8,
                  pencilSnapPreview.y,
                ]}
                stroke="#2563eb"
                strokeWidth={1}
                dash={[4, 3]}
              />
              <Line
                points={[
                  pencilSnapPreview.x,
                  pencilSnapPreview.y - 8,
                  pencilSnapPreview.x,
                  pencilSnapPreview.y + 8,
                ]}
                stroke="#2563eb"
                strokeWidth={1}
                dash={[4, 3]}
              />
              <Rect
                x={pencilSnapPreview.x - 3}
                y={pencilSnapPreview.y - 3}
                width={6}
                height={6}
                fill="rgba(37,99,235,0.16)"
                stroke="#2563eb"
                strokeWidth={1}
              />
            </Group>
          )}

          {/* ── Empty state hint ── */}
          {!boxCanvas && !ghostRect && mode === 'draw_box' && (
            <Group listening={false}>
              <Text
                x={size.width / 2 - 120}
                y={size.height / 2 - 16}
                text="Click and drag to draw the wardrobe"
                fontSize={14} fill="#bbb"
              />
              <Text
                x={size.width / 2 - 90}
                y={size.height / 2 + 8}
                text="Measurements appear automatically"
                fontSize={12} fill="#ccc"
              />
            </Group>
          )}

          {/* ── Fill gap hover highlight ── */}
          {hoverFillGap && boxCanvas && (
            <Group listening={false}>
              <Rect
                x={interiorOf(boxCanvas, T).left + mmToPx(hoverFillGap.fromLeft)}
                y={interiorOf(boxCanvas, T).bottom - mmToPx(hoverFillGap.toBottom)}
                width={mmToPx(hoverFillGap.toLeft - hoverFillGap.fromLeft)}
                height={mmToPx(hoverFillGap.toBottom - hoverFillGap.fromBottom)}
                fill="rgba(37,99,235,0.10)"
                stroke="#2563eb"
                strokeWidth={1.25}
                dash={[7, 4]}
              />
              <Text
                x={interiorOf(boxCanvas, T).left + mmToPx(hoverFillGap.fromLeft) + 8}
                y={interiorOf(boxCanvas, T).bottom - mmToPx(hoverFillGap.toBottom) + 8}
                text={`${Math.round(hoverFillGap.toLeft - hoverFillGap.fromLeft)} x ${Math.round(hoverFillGap.toBottom - hoverFillGap.fromBottom)}mm`}
                fontSize={11}
                fontStyle="bold"
                fill="#2563eb"
              />
            </Group>
          )}

          {/* ── Mode hints ── */}
          {boxCanvas && mode === 'add_shelf' && (
            <Group listening={false}>
              <Text
                x={size.width / 2 - 105}
                y={size.height - 28}
                text="Click inside the box to place a shelf"
                fontSize={12} fill="#3b82f6"
              />
            </Group>
          )}
          {boxCanvas && mode === 'add_partition' && (
            <Group listening={false}>
              <Text
                x={size.width / 2 - 120}
                y={size.height - 28}
                text="Click inside the box to place a vertical partition"
                fontSize={12} fill="#3b82f6"
              />
            </Group>
          )}
          {boxCanvas && mode === 'add_drawer' && (
            <Group listening={false}>
              <Text
                x={size.width / 2 - 150}
                y={size.height - 28}
                text="Click and drag inside a section to place a drawer"
                fontSize={12} fill="#3b82f6"
              />
            </Group>
          )}
          {boxCanvas && mode === 'add_custom_panel' && (
            <Group listening={false}>
              <Text
                x={size.width / 2 - 160}
                y={size.height - 28}
                text="Click and drag inside the box to draw a custom panel"
                fontSize={12} fill="#22c55e"
              />
            </Group>
          )}
          {boxCanvas && mode === 'fill_gap' && (
            <Group listening={false}>
              <Text
                x={size.width / 2 - 145}
                y={size.height - 28}
                text="Click an empty opening to fill it equally"
                fontSize={12} fill="#3b82f6"
              />
            </Group>
          )}
        </Layer>
      </Stage>

      {fillGapDraft && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(size.width - 220, Math.max(12, fillGapDraft.screenX + 10)),
            top: Math.min(size.height - 178, Math.max(12, fillGapDraft.screenY + 10)),
            zIndex: 25,
            width: 208,
            padding: 10,
            borderRadius: 6,
            background: 'rgba(255,255,255,0.96)',
            border: '1px solid #d4d4d8',
            boxShadow: '0 14px 40px rgba(15,23,42,0.18)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>
            Fill clicked gap
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setFillGapDraft((draft) => draft ? { ...draft, kind: 'shelves' } : draft)}
              style={{
                height: 28,
                borderRadius: 5,
                border: fillGapDraft.kind === 'shelves' ? '1px solid #2563eb' : '1px solid #d4d4d8',
                background: fillGapDraft.kind === 'shelves' ? 'rgba(37,99,235,0.12)' : 'white',
                color: fillGapDraft.kind === 'shelves' ? '#2563eb' : '#52525b',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Shelves
            </button>
            <button
              type="button"
              onClick={() => setFillGapDraft((draft) => draft ? { ...draft, kind: 'partitions' } : draft)}
              style={{
                height: 28,
                borderRadius: 5,
                border: fillGapDraft.kind === 'partitions' ? '1px solid #2563eb' : '1px solid #d4d4d8',
                background: fillGapDraft.kind === 'partitions' ? 'rgba(37,99,235,0.12)' : 'white',
                color: fillGapDraft.kind === 'partitions' ? '#2563eb' : '#52525b',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Partitions
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ flex: 1, fontSize: 11, color: '#71717a' }}>Count</span>
            <input
              type="number"
              min={1}
              max={20}
              value={fillGapCount}
              onChange={(event) => setFillGapDraft((draft) => draft
                ? { ...draft, count: Number(event.target.value) }
                : draft)}
              style={{
                width: 64,
                height: 28,
                padding: '0 7px',
                borderRadius: 5,
                border: '1px solid #d4d4d8',
                textAlign: 'right',
                fontFamily: 'inherit',
                fontSize: 12,
              }}
            />
          </div>
          <div style={{ fontSize: 10.5, lineHeight: '15px', color: fillGapCanAdd ? '#71717a' : '#ef4444', marginBottom: 9 }}>
            {fillGapCanAdd
              ? `${fillGapOpening}mm clear opening in ${Math.round(fillGapAvailable)}mm.`
              : `Need ${fillGapRequired}mm in ${Math.round(fillGapAvailable)}mm.`}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setFillGapDraft(null)}
              style={{
                flex: 1,
                height: 28,
                borderRadius: 5,
                border: '1px solid #d4d4d8',
                background: 'white',
                color: '#52525b',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyFillGap}
              disabled={!fillGapCanAdd}
              style={{
                flex: 1,
                height: 28,
                borderRadius: 5,
                border: '1px solid #2563eb',
                background: '#2563eb',
                color: 'white',
                fontSize: 11,
                fontWeight: 700,
                opacity: fillGapCanAdd ? 1 : 0.45,
                cursor: fillGapCanAdd ? 'pointer' : 'not-allowed',
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* ── Inline rename overlay (appears right after placing a custom panel) ── */}
      {renamingPanelId && pendingRenamePosRef.current && (
        <div
          style={{
            position: 'absolute',
            left: pendingRenamePosRef.current.x * zoom + stagePos.x,
            top:  pendingRenamePosRef.current.y * zoom + stagePos.y,
            zIndex: 20,
          }}
        >
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') {
                renameCustomPanel(renamingPanelId, 'Custom Panel')
                setRenamingPanelId(null)
                pendingRenamePosRef.current = null
              }
            }}
            placeholder="Panel name"
            style={{
              display:    'block',
              width:      Math.max(130, pendingRenamePosRef.current.w * zoom),
              padding:    '4px 8px',
              fontSize:   11,
              fontFamily: 'inherit',
              border:     '1.5px solid #22c55e',
              borderRadius: 4,
              background: 'white',
              color:      '#15803d',
              outline:    'none',
              boxShadow:  '0 2px 10px rgba(0,0,0,0.18)',
            }}
          />
          <div style={{ fontSize: 9, color: '#666', marginTop: 3, textAlign: 'center' }}>
            Enter to confirm · Esc for default
          </div>
        </div>
      )}

      {outerBox && (
        <button
          type="button"
          onClick={() => {
            fitBoxToViewport(mmToPx(outerBox.width), mmToPx(outerBox.height))
          }}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 20,
            fontSize: 11,
            padding: '5px 9px',
            borderRadius: 6,
            border: '1px solid #d4d4d8',
            background: 'rgba(255,255,255,0.92)',
            color: '#444',
            cursor: 'pointer',
          }}
        >
          Fit to View
        </button>
      )}

      {/* Zoom indicator */}
      <div
        style={{
          position: 'absolute', bottom: 10, left: 10,
          fontSize: 10, color: '#999', pointerEvents: 'none',
          background: 'rgba(255,255,255,0.75)', padding: '2px 6px', borderRadius: 3,
        }}
      >
        {Math.round(zoom * 100)}% · scroll to zoom
      </div>
    </div>
  )
}
