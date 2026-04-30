import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useFurnitureStore } from '../../stores/furnitureStore'

// ── Scale ─────────────────────────────────────────────────────────────────────
const PX_PER_MM = 0.5        // 1mm = 0.5px  →  2400mm = 1200px on screen
const GRID_MINOR_MM = 50     // minor grid every 50mm
const GRID_MAJOR_MM = 250    // major grid every 250mm
export const OUTER_BOX_SELECTION_ID = 'outer-box'

function pxToMm(px: number): number {
  return Math.round(px / PX_PER_MM)
}
function mmToPx(mm: number): number {
  return mm * PX_PER_MM
}

// Euclidean distance between two points (px)
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

interface CanvasBox { x: number; y: number; width: number; height: number }

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

  // Current mouse position (always tracked, used for ghost previews)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  // Where mouse went down (used to distinguish click vs drag for add_* modes)
  const [clickStart, setClickStart] = useState<{ x: number; y: number } | null>(null)

  const {
    outerBox, mode, material,
    shelves, partitions, drawers, customPanels,
    setOuterBox, addShelf, addPartition, addDrawer, addCustomPanel,
    moveShelf, movePartition, moveDrawer, moveCustomPanel, renameCustomPanel,
    selectedId, setSelected,
  } = useFurnitureStore()

  // Live mm value shown while dragging an element
  const [dragLive, setDragLive] = useState<{ id: string; mm: number } | null>(null)
  // Prevents Stage onMouseMove from triggering ghost previews while dragging an element
  const isDraggingElement = useRef(false)

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

  // When store box is cleared (reset), clear local canvas box too
  useEffect(() => {
    if (!outerBox) setBoxCanvas(null)
  }, [outerBox])

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

    for (let x = 0; x <= size.width; x += minor) {
      const isMajor = Math.round(x) % Math.round(major) === 0
      lines.push(
        <Line key={`v${x}`} points={[x, 0, x, size.height]}
          stroke={isMajor ? '#cccccc' : '#ececec'}
          strokeWidth={isMajor ? 1 : 0.5}
          listening={false} />,
      )
    }
    for (let y = 0; y <= size.height; y += minor) {
      const isMajor = Math.round(y) % Math.round(major) === 0
      lines.push(
        <Line key={`h${y}`} points={[0, y, size.width, y]}
          stroke={isMajor ? '#cccccc' : '#ececec'}
          strokeWidth={isMajor ? 1 : 0.5}
          listening={false} />,
      )
    }
    return lines
  }, [size])

  // ── Mouse handlers ───────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    e.evt.preventDefault()

    setClickStart(pos)

    if (mode === 'draw_box') {
      setDrawStart(pos)
      setDrawCurrent(pos)
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
  }, [mode, boxCanvas, material.thickness])

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return

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
  }, [mode, drawStart, customDrawStart, drawerDrawStart])

  const handleMouseUp = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return

    // ── draw_box: finalise rectangle ──────────────────────────────────────
    if (mode === 'draw_box' && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x)
      const y = Math.min(drawStart.y, drawCurrent.y)
      const w = Math.abs(drawCurrent.x - drawStart.x)
      const h = Math.abs(drawCurrent.y - drawStart.y)

      if (w >= 30 && h >= 30) {
        setBoxCanvas({ x, y, width: w, height: h })
        setOuterBox({ width: pxToMm(w), height: pxToMm(h), depth: 600 })
      }
      setDrawStart(null)
      setDrawCurrent(null)
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

      addShelf(fromBottom)
    }

    // ── add_partition: place on click (not drag) ───────────────────────────
    if (mode === 'add_partition' && boxCanvas && outerBox && clickStart) {
      if (dist(clickStart, pos) > 6) { setClickStart(null); return }

      const T = mmToPx(material.thickness)
      if (!isInsideInterior(pos, boxCanvas, T)) { setClickStart(null); return }

      const { left } = interiorOf(boxCanvas, T)
      const fromLeft = pxToMm(pos.x - left)

      addPartition(fromLeft)
    }

    // ── add_drawer: finalise drag rectangle ───────────────────────────────
    if (mode === 'add_drawer' && drawerDrawStart && drawerDrawCurrent && boxCanvas && outerBox) {
      const Tpx = mmToPx(material.thickness)
      const { top: iTop, bottom: iBottom } = interiorOf(boxCanvas, Tpx)

      const topY = Math.max(iTop,   Math.min(drawerDrawStart.y, drawerDrawCurrent.y))
      const botY = Math.min(iBottom, Math.max(drawerDrawStart.y, drawerDrawCurrent.y))
      const heightPx = botY - topY

      if (heightPx >= mmToPx(20)) {
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
  }, [mode, drawStart, drawCurrent, customDrawStart, customDrawCurrent, drawerDrawStart, drawerDrawCurrent, boxCanvas, outerBox, material, clickStart, partitions, addShelf, addPartition, addDrawer, addCustomPanel, setOuterBox])

  const handleMouseLeave = useCallback(() => {
    setMousePos(null)
  }, [])

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const clickedStage = e.target === e.target.getStage()
    if (clickedStage) setSelected(null)
  }, [setSelected])

  // ── Derived canvas values ────────────────────────────────────────────────

  const T = mmToPx(material.thickness)   // panel thickness in px

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

    const { left, right, bottom } = interiorOf(boxCanvas, T)
    const interiorHeightMm = outerBox.height - material.thickness * 2
    const fromTopMm = pxToMm(mousePos.y - (boxCanvas.y + T))
    const fromBottom = Math.max(0, Math.min(interiorHeightMm, interiorHeightMm - fromTopMm))
    const canvasY = bottom - mmToPx(fromBottom)

    return { canvasY, fromBottom, left, right }
  }, [mode, mousePos, boxCanvas, outerBox, T, material.thickness])

  // Ghost partition info while hovering in add_partition mode
  const ghostPartition = useMemo(() => {
    if (mode !== 'add_partition' || !mousePos || !boxCanvas || !outerBox) return null
    if (!isInsideInterior(mousePos, boxCanvas, T)) return null

    const { left, top, bottom } = interiorOf(boxCanvas, T)
    const interiorWidthMm = outerBox.width - material.thickness * 2
    const fromLeftMm = Math.max(0, Math.min(interiorWidthMm, pxToMm(mousePos.x - left)))
    const canvasX = left + mmToPx(fromLeftMm)

    return { canvasX, fromLeft: fromLeftMm, top, bottom }
  }, [mode, mousePos, boxCanvas, outerBox, T, material.thickness])

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
        heightMm:     pxToMm(botY - topY),
        fromBottomMm: pxToMm(iBottom - botY),
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

    return { x, y, w, h, widthMm: pxToMm(w), heightMm: pxToMm(h) }
  }, [mode, customDrawStart, customDrawCurrent, boxCanvas, material.thickness])

  const cursor = (() => {
    if (mode === 'draw_box' || mode === 'add_shelf' || mode === 'add_partition' || mode === 'add_drawer' || mode === 'add_custom_panel') return 'crosshair'
    return 'default'
  })()

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
        style={{ cursor }}
      >
        {/* ── Grid ── */}
        <Layer listening={false}>
          {gridLines}
          <Text x={10} y={10} text="Grid: 50mm · Resolution: 1mm" fontSize={10} fill="#bbb" />
        </Layer>

        {/* ── Drawing layer ── */}
        <Layer>

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
                text={`${pxToMm(ghostRect.width)}mm`}
                fontSize={12} fontStyle="bold" fill="#3b82f6"
              />
              <Text
                x={ghostRect.x + ghostRect.width + 6}
                y={ghostRect.y + ghostRect.height / 2 - 8}
                text={`${pxToMm(ghostRect.height)}mm`}
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
          {boxCanvas && outerBox && shelves.map((shelf) => {
            const { left, right, bottom: interiorBottom } = interiorOf(boxCanvas, T)
            const displayMm   = dragLive?.id === shelf.id ? dragLive.mm : shelf.fromBottom
            const shelfCenterY = interiorBottom - mmToPx(displayMm)
            const isSelected  = selectedId === shelf.id

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
                    const absY = e.target.absolutePosition().y
                    const newCenterY = absY + T / 2
                    const fromBottom = Math.max(0, pxToMm(interiorBottom - newCenterY))
                    setDragLive({ id: shelf.id, mm: fromBottom })
                  }}
                  onDragEnd={(e) => {
                    const absY = e.target.absolutePosition().y
                    const newCenterY = absY + T / 2
                    const fromBottom = Math.max(0, pxToMm(interiorBottom - newCenterY))
                    moveShelf(shelf.id, fromBottom)
                    isDraggingElement.current = false
                    setDragLive(null)
                  }}
                  dragBoundFunc={(pos) => ({
                    x: left,
                    y: Math.max(
                      boxCanvas.y + T,
                      Math.min(interiorBottom - T, pos.y),
                    ),
                  })}
                />
                {/* mm label — right of box, follows live position */}
                <Text
                  x={boxCanvas.x + boxCanvas.width + 8}
                  y={shelfCenterY - 8}
                  text={`${displayMm}mm`}
                  fontSize={11}
                  fontStyle={isSelected ? 'bold' : 'normal'}
                  fill={isSelected || dragLive?.id === shelf.id ? '#3b82f6' : '#888'}
                  listening={false}
                />
                <Text
                  x={boxCanvas.x + boxCanvas.width + 8}
                  y={shelfCenterY + 3}
                  text="from bottom"
                  fontSize={9}
                  fill={isSelected || dragLive?.id === shelf.id ? '#3b82f6' : '#aaa'}
                  listening={false}
                />
              </Group>
            )
          })}

          {/* ── Placed partitions ── */}
          {boxCanvas && outerBox && partitions.map((partition) => {
            const { left: interiorLeft, right: interiorRight, top, bottom } = interiorOf(boxCanvas, T)
            const displayMm       = dragLive?.id === partition.id ? dragLive.mm : partition.fromLeft
            const partitionCenterX = interiorLeft + mmToPx(displayMm)
            const isSelected      = selectedId === partition.id

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
                    const absX = e.target.absolutePosition().x
                    const newCenterX = absX + T / 2
                    const fromLeft = Math.max(0, pxToMm(newCenterX - interiorLeft))
                    setDragLive({ id: partition.id, mm: fromLeft })
                  }}
                  onDragEnd={(e) => {
                    const absX = e.target.absolutePosition().x
                    const newCenterX = absX + T / 2
                    const fromLeft = Math.max(0, pxToMm(newCenterX - interiorLeft))
                    movePartition(partition.id, fromLeft)
                    isDraggingElement.current = false
                    setDragLive(null)
                  }}
                  dragBoundFunc={(pos) => ({
                    x: Math.max(
                      interiorLeft,
                      Math.min(interiorRight - T, pos.x),
                    ),
                    y: top,
                  })}
                />
                {/* mm label — above box, follows live position */}
                <Text
                  x={partitionCenterX - 16}
                  y={boxCanvas.y - 46}
                  text={`${displayMm}mm`}
                  fontSize={11}
                  fontStyle={isSelected ? 'bold' : 'normal'}
                  fill={isSelected || dragLive?.id === partition.id ? '#3b82f6' : '#888'}
                  listening={false}
                />
                <Text
                  x={partitionCenterX - 16}
                  y={boxCanvas.y - 34}
                  text="from left"
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

          {/* ── Ghost partition preview (add_partition mode) ── */}
          {ghostPartition && boxCanvas && (
            <Group listening={false}>
              {/* Ghost partition panel */}
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
              {/* Vertical guide line up to label */}
              <Line
                points={[ghostPartition.canvasX, boxCanvas.y - 10, ghostPartition.canvasX, ghostPartition.top]}
                stroke="#3b82f6" strokeWidth={0.75} dash={[4, 4]}
              />
              {/* mm label above box */}
              <Text
                x={ghostPartition.canvasX - 16}
                y={boxCanvas.y - 46}
                text={`${ghostPartition.fromLeft}mm`}
                fontSize={12} fontStyle="bold" fill="#3b82f6"
              />
              <Text
                x={ghostPartition.canvasX - 16}
                y={boxCanvas.y - 34}
                text="from left"
                fontSize={9} fill="#3b82f6" opacity={0.7}
              />
            </Group>
          )}

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
                      const absY = e.target.absolutePosition().y
                      const newDrawerBottom = absY + drawerH
                      const fromBottom = Math.max(0, pxToMm(interiorBottom - newDrawerBottom))
                      setDragLive({ id: drawer.id, mm: fromBottom })
                    }}
                    onDragEnd={(e) => {
                      const absY = e.target.absolutePosition().y
                      const newDrawerBottom = absY + drawerH
                      const fromBottom = Math.max(0, pxToMm(interiorBottom - newDrawerBottom))
                      moveDrawer(drawer.id, fromBottom)
                      isDraggingElement.current = false
                      setDragLive(null)
                    }}
                    dragBoundFunc={(pos) => ({
                      x: rectX,
                      y: Math.max(
                        interiorTop,
                        Math.min(interiorBottom - drawerH, pos.y),
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
                    text={`${displayFromBottom}mm`}
                    fontSize={11}
                    fontStyle={isSelected ? 'bold' : 'normal'}
                    fill={isSelected || dragLive?.id === drawer.id ? '#3b82f6' : '#888'}
                    listening={false}
                  />
                  <Text
                    x={section.right - T / 2 + 8}
                    y={drawerTop + drawerH / 2 + 3}
                    text="from bottom"
                    fontSize={9}
                    fill={isSelected || dragLive?.id === drawer.id ? '#3b82f6' : '#aaa'}
                    listening={false}
                  />
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
                    text={`${ghostDrawer.fromBottomMm}mm from bottom`}
                    fontSize={9} fill="#3b82f6" opacity={0.7}
                  />
                </>
              )}
            </Group>
          )}

          {/* ── Ghost shelf preview (add_shelf mode) ── */}
          {ghostShelf && (
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
                text={`${ghostShelf.fromBottom}mm`}
                fontSize={12} fontStyle="bold" fill="#3b82f6"
              />
              <Text
                x={boxCanvas!.x + boxCanvas!.width + 8}
                y={ghostShelf.canvasY + 3}
                text="from bottom"
                fontSize={9} fill="#3b82f6" opacity={0.7}
              />
              {/* Height indicator on left */}
              <Text
                x={boxCanvas!.x - 60}
                y={ghostShelf.canvasY - 7}
                text={`${ghostShelf.fromBottom}mm`}
                fontSize={11} fontStyle="bold" fill="#3b82f6"
              />
            </Group>
          )}

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
                      const abs = e.target.absolutePosition()
                      const fromLeft   = Math.max(0, pxToMm(abs.x - iLeft))
                      const fromBottom = Math.max(0, pxToMm(iBottom - abs.y - cpH))
                      moveCustomPanel(cp.id, fromLeft, fromBottom)
                      isDraggingElement.current = false
                    }}
                    dragBoundFunc={(pos) => ({
                      x: Math.max(iLeft, Math.min(iLeft + mmToPx(iW) - cpW, pos.x)),
                      y: Math.max(boxCanvas.y + T, Math.min(iBottom - cpH, pos.y)),
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
        </Layer>
      </Stage>

      {/* ── Inline rename overlay (appears right after placing a custom panel) ── */}
      {renamingPanelId && pendingRenamePosRef.current && (
        <div
          style={{
            position: 'absolute',
            left: pendingRenamePosRef.current.x,
            top:  pendingRenamePosRef.current.y,
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
              width:      Math.max(130, pendingRenamePosRef.current.w),
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
    </div>
  )
}
