import { jsPDF } from 'jspdf'
import type { LogEntry } from '../services/logService'
import type { Project } from '../services/projectService'

// ── Color palette — matches frontend CSS variables (oklch → RGB approx) ───────
const INK:    [number, number, number] = [30,  28,  40]   // --ink
const INK2:   [number, number, number] = [74,  72,  90]   // --ink-2
const INK3:   [number, number, number] = [120, 118, 132]  // --ink-3
const INK4:   [number, number, number] = [170, 168, 180]  // --ink-4
const INK5:   [number, number, number] = [216, 215, 220]  // --ink-5
const BG_SUN: [number, number, number] = [244, 243, 247]  // --bg-sunken
const LINE:   [number, number, number] = [230, 229, 234]  // --line
const LINE2:  [number, number, number] = [239, 238, 243]  // --line-2

// ── Layout — A4 Landscape ────────────────────────────────────────────────────
const PW = 297   // page width  mm
const PH = 210   // page height mm
const ML = 14    // left margin
const MR = 14    // right margin
const MT = 14    // top margin (for content pages after header)
const CW = PW - ML - MR   // 269 mm usable content width

// ── Table column definitions ─────────────────────────────────────────────────
//   x positions are absolute (from page left)
const COLS = {
  type:      { x: ML,       w: 46 },
  entry:     { x: ML + 46,  w: 54 },
  qty:       { x: ML + 100, w: 20 },
  cost:      { x: ML + 120, w: 30 },
  keyValues: { x: ML + 150, w: 62 },
  notes:     { x: ML + 212, w: 40 },
  loggedBy:  { x: ML + 252, w: 17 },
}

const ROW_H     = 10.5   // normal data row height
const HEADER_H  = 7      // column-header row height
const DATE_H    = 6.5    // date-group row height
const PAD_X     = 3      // horizontal cell padding
const BASE_OFF  = 3.8    // y offset from row top to first text baseline

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateKey(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v.slice(0, 10) : d.toISOString().slice(0, 10)
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtLongDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtNow(): string {
  return new Date().toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtMoney(n: number): string {
  if (_hasRupee) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR',
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n)
  }
  // Helvetica can't render ₹ — use "Rs." instead
  return 'Rs. ' + new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(n)
}

function displayVal(v: unknown): string {
  if (v === true)  return 'Yes'
  if (v === false) return 'No'
  if (v == null || v === '') return '—'
  return String(v)
}

function isNameLike(label: string): boolean {
  const l = label.toLowerCase().trim()
  return l === 'name' || l.includes('name') || l.includes('item') || l.includes('material')
}

function buildPrimary(entry: LogEntry): string {
  if (entry.item_name) return entry.item_name
  const hit = entry.fields.find((f) =>
    /(item|material|name|activity|task|description)/.test((f.label || '').toLowerCase()),
  )
  if (hit && hit.value != null && hit.value !== '') return displayVal(hit.value)
  return entry.category_name
}

function buildSecondary(entry: LogEntry): string {
  return entry.item_name
    ? `Catalog item · ${entry.category_name}`
    : `Manual · ${entry.category_name}`
}

function buildKeyValues(entry: LogEntry): string {
  return entry.fields
    .filter((f) => f.value != null && f.value !== '' && !isNameLike(f.label))
    .slice(0, 3)
    .map((f) => `${f.label}: ${displayVal(f.value)}`)
    .join('  ·  ')
}

// ── Font — module-level state set once per export call ───────────────────────
// If NotoSans TTF is found in /public/fonts/, it is registered with jsPDF
// (supports the ₹ glyph). Otherwise falls back to Helvetica with "Rs.".
let _font     = 'helvetica'
let _hasRupee = false

async function loadFont(doc: jsPDF): Promise<void> {
  try {
    const toBase64 = async (buf: ArrayBuffer): Promise<string> => {
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i += 8192)
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return btoa(bin)
    }

    const [regRes, boldRes] = await Promise.all([
      fetch('/fonts/NotoSans-Regular.ttf'),
      fetch('/fonts/NotoSans-Bold.ttf'),
    ])
    if (!regRes.ok) return   // font not available — keep Helvetica

    const regB64 = await toBase64(await regRes.arrayBuffer())
    doc.addFileToVFS('NotoSans-Regular.ttf', regB64)
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')

    if (boldRes.ok) {
      const boldB64 = await toBase64(await boldRes.arrayBuffer())
      doc.addFileToVFS('NotoSans-Bold.ttf', boldB64)
      doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold')
    } else {
      // no bold file — register regular as bold fallback
      doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'bold')
    }

    _font     = 'NotoSans'
    _hasRupee = true
  } catch {
    // keep defaults
  }
}

// ── Logo loader — normalises any image to JPEG via canvas ─────────────────────

interface LogoData { dataUrl: string; format: string }

async function loadLogo(): Promise<LogoData | null> {
  try {
    const res = await fetch('/logo.png')
    if (!res.ok) return null
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    return await new Promise<LogoData | null>((resolve) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) { URL.revokeObjectURL(objectUrl); resolve(null); return }
          ctx.drawImage(img, 0, 0)
          URL.revokeObjectURL(objectUrl)
          resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.95), format: 'JPEG' })
        } catch {
          URL.revokeObjectURL(objectUrl); resolve(null)
        }
      }
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null) }
      img.src = objectUrl
    })
  } catch { return null }
}

// ── Page break ────────────────────────────────────────────────────────────────

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PH - 12) { doc.addPage(); return MT }
  return y
}

// ── Draw a single data row ────────────────────────────────────────────────────

function drawDataRow(doc: jsPDF, y: number, entry: LogEntry, shade: boolean): void {
  // Row background
  if (shade) {
    doc.setFillColor(...BG_SUN)
    doc.rect(ML, y, CW, ROW_H, 'F')
  }

  // Top border
  doc.setDrawColor(...LINE2)
  doc.setLineWidth(0.1)
  doc.line(ML, y, ML + CW, y)

  const mid1 = y + BASE_OFF          // baseline for primary/first line
  const mid2 = y + BASE_OFF + 4.2    // baseline for secondary/second line

  // ── Type column ───────────────────────────────────────────────────────────
  const tc = COLS.type
  doc.setFontSize(8.5)
  doc.setFont(_font, 'bold')
  doc.setTextColor(...INK)
  doc.text(
    doc.splitTextToSize(entry.log_type_name, tc.w - PAD_X * 2)[0],
    tc.x + PAD_X, mid1,
  )
  doc.setFontSize(7.5)
  doc.setFont(_font, 'normal')
  doc.setTextColor(...INK4)
  doc.text(
    doc.splitTextToSize(entry.category_name, tc.w - PAD_X * 2)[0],
    tc.x + PAD_X, mid2,
  )

  // ── Entry column ──────────────────────────────────────────────────────────
  const ec = COLS.entry
  const primary   = buildPrimary(entry)
  const secondary = buildSecondary(entry)
  doc.setFontSize(8.5)
  doc.setFont(_font, 'bold')
  doc.setTextColor(...INK)
  doc.text(doc.splitTextToSize(primary, ec.w - PAD_X * 2)[0], ec.x + PAD_X, mid1)
  doc.setFontSize(7.5)
  doc.setFont(_font, 'normal')
  doc.setTextColor(...INK4)
  doc.text(doc.splitTextToSize(secondary, ec.w - PAD_X * 2)[0], ec.x + PAD_X, mid2)

  // ── Quantity ──────────────────────────────────────────────────────────────
  const qc = COLS.qty
  const qty = entry.quantity
  doc.setFontSize(8.5)
  doc.setFont(_font, 'normal')
  doc.setTextColor(...(qty != null ? INK2 : INK5))
  doc.text(qty != null ? String(qty) : '—', qc.x + qc.w - PAD_X, mid1, { align: 'right' })

  // ── Total cost ────────────────────────────────────────────────────────────
  const cc = COLS.cost
  const cost = entry.total_cost
  doc.setFontSize(8.5)
  doc.setFont(_font, 'normal')
  doc.setTextColor(...(cost != null && cost > 0 ? INK2 : INK5))
  doc.text(
    cost != null && cost > 0 ? fmtMoney(cost) : '—',
    cc.x + cc.w - PAD_X, mid1, { align: 'right' },
  )

  // ── Key values ────────────────────────────────────────────────────────────
  const kc = COLS.keyValues
  const kv = buildKeyValues(entry)
  doc.setFontSize(8)
  doc.setFont(_font, 'normal')
  doc.setTextColor(...(kv ? INK2 : INK5))
  doc.text(
    doc.splitTextToSize(kv || 'No extra values', kc.w - PAD_X * 2)[0],
    kc.x + PAD_X, mid1,
  )

  // ── Notes ─────────────────────────────────────────────────────────────────
  const nc = COLS.notes
  doc.setFontSize(8)
  doc.setFont(_font, 'normal')
  doc.setTextColor(...INK3)
  doc.text(
    doc.splitTextToSize(entry.notes || '—', nc.w - PAD_X * 2)[0],
    nc.x + PAD_X, mid1,
  )

  // ── Logged by ─────────────────────────────────────────────────────────────
  const lb = COLS.loggedBy
  doc.setFontSize(7.5)
  doc.setFont(_font, 'normal')
  doc.setTextColor(...INK3)
  doc.text(
    doc.splitTextToSize(entry.created_by || '—', lb.w - PAD_X)[0],
    lb.x + PAD_X, mid1,
  )
}

// ── Draw table column header row ──────────────────────────────────────────────

function drawTableHeader(doc: jsPDF, y: number): void {
  doc.setFillColor(...BG_SUN)
  doc.rect(ML, y, CW, HEADER_H, 'F')

  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.2)
  doc.line(ML, y, ML + CW, y)
  doc.line(ML, y + HEADER_H, ML + CW, y + HEADER_H)

  const ty = y + HEADER_H / 2 + 1.3

  const headers: [keyof typeof COLS, string, 'left' | 'right'][] = [
    ['type',      'TYPE',       'left'],
    ['entry',     'ENTRY',      'left'],
    ['qty',       'QTY',        'right'],
    ['cost',      'TOTAL COST', 'right'],
    ['keyValues', 'KEY VALUES', 'left'],
    ['notes',     'NOTES',      'left'],
    ['loggedBy',  'LOGGED BY',  'left'],
  ]

  doc.setFontSize(7)
  doc.setFont(_font, 'bold')
  doc.setTextColor(...INK4)

  for (const [key, label, align] of headers) {
    const col = COLS[key]
    if (align === 'right') {
      doc.text(label, col.x + col.w - PAD_X, ty, { align: 'right' })
    } else {
      doc.text(label, col.x + PAD_X, ty)
    }
  }
}

// ── Draw date group header row ────────────────────────────────────────────────

function drawDateRow(doc: jsPDF, y: number, dateKey: string, count: number): void {
  doc.setFillColor(...BG_SUN)
  doc.rect(ML, y, CW, DATE_H, 'F')

  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.2)
  doc.line(ML, y, ML + CW, y)

  const ty = y + DATE_H / 2 + 1.2

  doc.setFontSize(8)
  doc.setFont(_font, 'bold')
  doc.setTextColor(...INK3)
  doc.text(fmtLongDate(dateKey), ML + PAD_X, ty)

  doc.setFont(_font, 'normal')
  doc.setTextColor(...INK4)
  doc.text(`· ${count} ${count === 1 ? 'entry' : 'entries'}`, ML + PAD_X + 70, ty)
}

// ── Public exports ────────────────────────────────────────────────────────────

export interface ExportFilters {
  logTypeName?: string
  date?: string
  q?: string
}

export async function exportLogReport(
  project: Project,
  entries: LogEntry[],
  filters: ExportFilters,
): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })

  // Reset font state, then try to load NotoSans for ₹ support
  _font     = 'helvetica'
  _hasRupee = false
  await loadFont(doc)

  const logo = await loadLogo()
  let y = ML

  // ── PAGE 1 HEADER ──────────────────────────────────────────────────────────
  if (logo) {
    doc.addImage(logo.dataUrl, logo.format, ML, y, 18, 18)
    doc.setFontSize(15)
    doc.setFont(_font, 'bold')
    doc.setTextColor(...INK)
    doc.text('HousExpert', ML + 22, y + 6)
    doc.setFontSize(8)
    doc.setFont(_font, 'normal')
    doc.setTextColor(...INK4)
    doc.text('Your Complete Home Solution', ML + 22, y + 11.5)
    y += 22
  } else {
    doc.setFontSize(15)
    doc.setFont(_font, 'bold')
    doc.setTextColor(...INK)
    doc.text('HousExpert', ML, y + 6)
    doc.setFontSize(8)
    doc.setFont(_font, 'normal')
    doc.setTextColor(...INK4)
    doc.text('Your Complete Home Solution', ML, y + 11)
    y += 16
  }

  // Top divider
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.4)
  doc.line(ML, y, PW - MR, y)
  y += 5

  // Report title
  doc.setFontSize(11)
  doc.setFont(_font, 'bold')
  doc.setTextColor(...INK)
  doc.text('DAILY LOG REPORT', ML, y)

  // Meta block — right side
  const metaLines: [string, string][] = [
    ['Project',  project.name],
    ['Location', `${project.address.city}, ${project.address.state}`],
    ['Generated', fmtNow()],
    ['Entries', String(entries.length)],
  ]
  if (filters.logTypeName) metaLines.push(['Log type', filters.logTypeName])
  if (filters.date)        metaLines.push(['Date filter', fmtDate(filters.date)])
  if (filters.q)           metaLines.push(['Search', filters.q])

  const metaStartY = y
  const META_COL = PW - MR - 110   // x where label ends (right-aligned to this)
  const META_VAL = META_COL + 4    // x where value starts
  doc.setFontSize(7.5)
  for (let i = 0; i < metaLines.length; i++) {
    const [label, value] = metaLines[i]
    const rowY = metaStartY + i * 4.8
    doc.setFont(_font, 'bold')
    doc.setTextColor(...INK4)
    doc.text(label + ':', META_COL, rowY, { align: 'right' })
    doc.setFont(_font, 'normal')
    doc.setTextColor(...INK2)
    doc.text(doc.splitTextToSize(value, PW - MR - META_VAL)[0], META_VAL, rowY)
  }

  y += 8

  // Bottom divider
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.line(ML, y, PW - MR, y)
  y += 6

  // ── TABLE ──────────────────────────────────────────────────────────────────

  // Group entries by date (newest first)
  const grouped = new Map<string, LogEntry[]>()
  for (const entry of entries) {
    const key = toDateKey(entry.log_date)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(entry)
  }
  const sortedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a))

  // Draw the column header once
  y = ensureSpace(doc, y, HEADER_H + DATE_H + ROW_H)
  drawTableHeader(doc, y)
  y += HEADER_H

  let globalRowIndex = 0

  for (const dateKey of sortedDates) {
    const dayEntries = grouped.get(dateKey)!

    // Date group row
    y = ensureSpace(doc, y, DATE_H + ROW_H)
    if (y === MT) {
      drawTableHeader(doc, y)
      y += HEADER_H
    }
    drawDateRow(doc, y, dateKey, dayEntries.length)
    y += DATE_H

    // Entry rows
    for (const entry of dayEntries) {
      y = ensureSpace(doc, y, ROW_H)
      if (y === MT) {
        drawTableHeader(doc, y)
        y += HEADER_H
        drawDateRow(doc, y, dateKey, dayEntries.length)
        y += DATE_H
      }

      drawDataRow(doc, y, entry, globalRowIndex % 2 === 1)
      globalRowIndex++
      y += ROW_H
    }
  }

  // Bottom border of table
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.2)
  doc.line(ML, y, ML + CW, y)

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 20)
  y += 5

  doc.setFontSize(8.5)
  doc.setFont(_font, 'bold')
  doc.setTextColor(...INK)
  doc.text('Summary', ML, y)
  y += 5

  const totalCost = entries.reduce((s, e) => s + (e.total_cost ?? 0), 0)
  const summaryItems: [string, string][] = [
    ['Total entries', String(entries.length)],
    ...(totalCost > 0 ? [['Total cost', fmtMoney(totalCost)] as [string, string]] : []),
  ]

  for (const [label, value] of summaryItems) {
    doc.setFontSize(8)
    doc.setFont(_font, 'normal')
    doc.setTextColor(...INK3)
    doc.text(label + ':', ML, y)
    doc.setFont(_font, 'bold')
    doc.setTextColor(...INK)
    doc.text(value, ML + 30, y)
    y += 5
  }

  // ── PAGE FOOTERS ───────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setFont(_font, 'normal')
    doc.setTextColor(...INK4)
    doc.text('HousExpert — Confidential', ML, PH - 6)
    doc.text(`Page ${p} of ${pageCount}`, PW / 2, PH - 6, { align: 'center' })
    doc.text(fmtNow(), PW - MR, PH - 6, { align: 'right' })
  }

  // ── SAVE ───────────────────────────────────────────────────────────────────
  const filename = `${project.project_id}-logs-${new Date().toISOString().slice(0, 10)}.pdf`
  doc.save(filename)
}
