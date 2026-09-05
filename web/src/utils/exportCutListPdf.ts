import jsPDF from 'jspdf'
import type { CutListSummary } from './cutListCalculator'
import type { OuterBox } from '../stores/furnitureStore'
import { formatCalculationStep, type CalculationBlock } from './furnitureCalculations'
import type { FurnitureView } from './furnitureDrawings'
import { renderDrawingSheet } from './renderFurnitureDrawings'

export function exportCutListPdf(
  designName: string,
  furnitureType: string,
  outerBox: OuterBox,
  summary: CutListSummary,
  calculations: CalculationBlock[] = [],
  views: FurnitureView[] = [],
) {
  const doc  = new jsPDF({ unit: 'mm', format: 'a4' })
  const pw   = 210   // page width
  const lm   = 15    // left margin
  const rm   = 15    // right margin
  const cw   = pw - lm - rm  // content width

  let y = 20

  const line = () => {
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.line(lm, y, pw - rm, y)
    y += 4
  }

  // ── Header ──────────────────────────────────────────────────────────────

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text('Cut List', lm, y)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), pw - rm, y, { align: 'right' })

  y += 7

  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text(designName, lm, y)

  y += 5
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.text(
    `${furnitureType}  ·  ${outerBox.width} × ${outerBox.height} × ${outerBox.depth} mm  ·  ${summary.totalPieces} pieces`,
    lm, y,
  )

  y += 5
  line()

  // ── Allowances that had to be reduced to fit ────────────────────────────

  if (summary.warnings.length > 0) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(180, 90, 20)
    doc.text('CHECK BEFORE CUTTING', lm, y)
    y += 4.5

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 80, 30)
    summary.warnings.forEach((warning) => {
      if (y > 265) { doc.addPage(); y = 20 }
      doc.splitTextToSize(warning, cw).forEach((row: string) => {
        doc.text(row, lm, y)
        y += 4
      })
    })

    y += 2
    line()
  }

  // ── Drawings ────────────────────────────────────────────────────────────
  // Dimensioned orthographic views, so the parts list can be read against the
  // thing it builds.

  if (views.length > 0) {
    doc.addPage()
    y = 20

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(50, 50, 50)
    doc.text('DRAWINGS', lm, y)

    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(140, 140, 140)
    doc.text('All dimensions in mm', pw - rm, y, { align: 'right' })
    doc.setTextColor(120, 120, 120)
    doc.text(designName, lm + 26, y)

    // Two rows filling the page; each view is fitted to its own cell and
    // carries its own scale, so nothing is shrunk to match its neighbours.
    renderDrawingSheet(doc, views, lm, y + 5, cw, 122)

    doc.addPage()
    y = 20
  }

  // ── Calculations ────────────────────────────────────────────────────────
  // The workshop wants the working, not just the answer.

  if (calculations.length > 0) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(50, 50, 50)
    doc.text('CALCULATIONS', lm, y)
    y += 5.5

    calculations.forEach((block) => {
      if (block.steps.length === 0 && block.outcomes.length === 0) return
      if (y > 250) { doc.addPage(); y = 20 }

      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(70, 70, 70)
      doc.text(block.title, lm, y)
      y += 4.5

      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'normal')
      block.steps.forEach((step) => {
        if (y > 268) { doc.addPage(); y = 20 }
        doc.setTextColor(40, 40, 40)
        doc.text(formatCalculationStep(step), lm + 3, y)
        doc.setTextColor(150, 150, 150)
        doc.text(step.note, lm + cw * 0.45, y)
        y += 4.2
      })

      if (block.note) {
        if (y > 268) { doc.addPage(); y = 20 }
        doc.setFontSize(7.5)
        doc.setTextColor(150, 150, 150)
        doc.text(block.note, lm + 3, y)
        y += 4.2
      }

      if (block.outcomes.length > 0) {
        if (y > 268) { doc.addPage(); y = 20 }
        doc.setFontSize(8.5)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(40, 40, 40)
        const summaryLine = block.outcomes
          .map((outcome) => `${outcome.label} ${outcome.value}`)
          .join('   ')
        doc.splitTextToSize(summaryLine, cw - 3).forEach((row: string) => {
          doc.text(row, lm + 3, y)
          y += 4.2
        })
        doc.setFont('helvetica', 'normal')
      }

      y += 3
    })

    line()
  }

  // ── Groups ───────────────────────────────────────────────────────────────

  const COL = {
    name: lm,
    len:  lm + cw * 0.42,
    wid:  lm + cw * 0.54,
    thk:  lm + cw * 0.66,
    qty:  lm + cw * 0.78,
    note: lm + cw * 0.86,
  }

  const tableHeader = () => {
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(140, 140, 140)
    doc.text('Panel',     COL.name, y)
    doc.text('Length',    COL.len,  y)
    doc.text('Width',     COL.wid,  y)
    doc.text('Thickness', COL.thk,  y)
    doc.text('Qty',       COL.qty,  y)
    y += 4
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.2)
    doc.line(lm, y, pw - rm, y)
    y += 3
  }

  summary.groups.forEach((group) => {
    // Page break check
    if (y > 260) { doc.addPage(); y = 20 }

    // Group heading
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(50, 50, 50)
    doc.text(group.label.toUpperCase(), lm, y)
    y += 5

    tableHeader()

    group.items.forEach((item, idx) => {
      if (y > 265) { doc.addPage(); y = 20; tableHeader() }

      // Alternating row bg
      if (idx % 2 === 0) {
        doc.setFillColor(248, 248, 248)
        doc.rect(lm, y - 3.5, cw, 6, 'F')
      }

      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(40, 40, 40)
      doc.text(item.name,                COL.name, y)

      doc.setTextColor(60, 60, 60)
      doc.text(`${item.length} mm`,      COL.len,  y)
      doc.text(`${item.width} mm`,       COL.wid,  y)
      doc.text(`${item.thickness} mm`,   COL.thk,  y)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(40, 40, 40)
      doc.text(`${item.qty}`,            COL.qty,  y)
      doc.setFont('helvetica', 'normal')

      y += 6
    })

    y += 4
  })

  // ── Summary footer ────────────────────────────────────────────────────

  if (y > 255) { doc.addPage(); y = 20 }

  line()
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(40, 40, 40)
  doc.text(`Total pieces: ${summary.totalPieces}`, lm, y)
  doc.text(
    `Total board area: ${summary.totalAreaM2.toFixed(2)} m²`,
    pw - rm, y, { align: 'right' },
  )

  y += 6
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(160, 160, 160)
  doc.text('Generated by HouseXpert · Furniture Designer', lm, y)

  // ── Save ──────────────────────────────────────────────────────────────

  const safeName = designName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  doc.save(`${safeName}_cut_list.pdf`)
}
