// this file has code for --> turn a saved quotation into a styled downloadable PDF. this file manages presentation on paper/PDF
package handlers

import (
	"bytes"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/phpdave11/gofpdf"

	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// ── Portrait A4 layout constants ──────────────────────────────────────────────

const (
	qpw = 210.0           // A4 portrait width mm
	qph = 297.0           // A4 portrait height mm
	qml = 14.0            // left margin
	qmr = 14.0            // right margin
	qcw = qpw - qml - qmr // 182mm content width
	qrH = 11.0            // item row height
	qhH = 7.0             // column header row height
	qsH = 9.5             // section header row height
	qpX = 3.0             // horizontal cell padding
)

// Quotation item columns  (x + widths sum to qcw = 182mm ✓)
//
//	7 + 61 + 20 + 18 + 13 + 29 + 34 = 182
var qCols = struct {
	idx, desc, size, sqft, qty, rate, amount col
}{
	idx:    col{qml, 7},
	desc:   col{qml + 7, 61},
	size:   col{qml + 68, 20},
	sqft:   col{qml + 88, 18},
	qty:    col{qml + 106, 13},
	rate:   col{qml + 119, 29},
	amount: col{qml + 148, 34},
}

// ── Handler ───────────────────────────────────────────────────────────────────

func exportQuotationPDF(c *gin.Context) {
	q, err := services.GetQuotation(c.Param("id"))
	if err != nil || q == nil {
		utils.NotFound(c, "quotation not found")
		return
	}

	buf, err := buildQuotationPDF(q)
	if err != nil {
		utils.InternalError(c, "pdf generation failed: "+err.Error())
		return
	}

	filename := fmt.Sprintf("%s-%s-%s.pdf",
		q.QuotationID,
		sanitizeFilename(q.ClientName),
		q.CreatedAt.Format("2006-01-02"),
	)
	c.Header("Content-Disposition", "attachment; filename="+filename)
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Length", fmt.Sprintf("%d", buf.Len()))
	c.Data(200, "application/pdf", buf.Bytes())
}

// ── Portrait writer init ──────────────────────────────────────────────────────

// this function basically builds a blank pdf.
func newPortraitPDFWriter() *pdfWriter {
	doc := gofpdf.NewCustom(&gofpdf.InitType{
		OrientationStr: "P",
		UnitStr:        "mm",
		SizeStr:        "A4",
	})
	doc.SetMargins(qml, 12, qmr)
	doc.SetAutoPageBreak(true, 14)
	p := &pdfWriter{doc: doc, font: "Helvetica", rupee: "Rs.", dash: "-"}
	p.loadFonts()
	p.findLogo()
	return p
}

// qhLine draws a horizontal rule across the full portrait content width at y.
func (p *pdfWriter) qhLine(y float64, c rgb, lw float64) {
	p.setDraw(c)
	p.doc.SetLineWidth(lw)
	p.doc.Line(qml, y, qml+qcw, y)
}

// ── PDF builder ───────────────────────────────────────────────────────────────

func buildQuotationPDF(q *models.Quotation) (*bytes.Buffer, error) {
	p := newPortraitPDFWriter()
	doc := p.doc

	doc.AddPage()
	y := p.drawQuotHeader(q)

	for _, sec := range q.Sections {
		// Ensure room for section header + col header + at least one item row
		if y+qsH+qhH+qrH > qph-14 {
			doc.AddPage()
			y = 14
		}
		y = p.drawQuotSectionHeader(y, sec.RoomName, quotSectionTotal(sec))
		y = p.drawQuotTableHeader(y)

		for i, item := range sec.Items {
			if y+qrH > qph-14 {
				doc.AddPage()
				y = 14
				y = p.drawQuotTableHeader(y)
			}
			y = p.drawQuotItemRow(y, i+1, item, i%2 == 1)
		}
		p.qhLine(y, cLINE, 0.3)
		y += 5
	}

	// Grand total
	if y+14 > qph-14 {
		doc.AddPage()
		y = 14
	}
	y = p.drawQuotGrandTotal(y, q.TotalAmount)

	// Notes
	if q.Notes != "" {
		if y+20 > qph-14 {
			doc.AddPage()
			y = 14
		}
		p.drawQuotNotes(y, q.Notes)
	}

	// Page footers
	doc.SetAutoPageBreak(false, 0)
	pageCount := doc.PageCount()
	for i := 1; i <= pageCount; i++ {
		doc.SetPage(i)
		p.setDraw(cLINE)
		doc.SetLineWidth(0.2)
		doc.Line(qml, qph-10, qml+qcw, qph-10)
		p.setFont("", 7)
		p.setColor(cINK4)
		doc.SetXY(qml, qph-8)
		doc.CellFormat(70, 4, "HouseXpert "+p.dash+" Confidential", "", 0, "L", false, 0, "")
		doc.CellFormat(qcw-70-50, 4, fmt.Sprintf("Page %d of %d", i, pageCount), "", 0, "C", false, 0, "")
		doc.CellFormat(50, 4, time.Now().Format("2 Jan 2006, 15:04"), "", 0, "R", false, 0, "")
	}

	var buf bytes.Buffer
	if err := doc.Output(&buf); err != nil {
		return nil, err
	}
	return &buf, nil
}

// ── Header ────────────────────────────────────────────────────────────────────
//
// Layout (y from page top):
//
//	y=12   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  2mm accent bar
//	y=17   [LOGO 20×20]  HouseXpert        │  QUOTATION   DRAFT
//	y=24                  Your Complete…   │  QT-001: …
//	                                       │  Client: …
//	                                       │  Phone: …
//	                                       │  Location: …
//	                                       │  Date: …
//	yB     ──────────────────────────────────────────────────
func (p *pdfWriter) drawQuotHeader(q *models.Quotation) float64 {
	doc := p.doc

	// Accent bar — royal blue instead of charcoal
	p.setFill(cINK)
	doc.Rect(qml, 12, qcw, 2, "F")

	y := 17.0

	// Logo + brand
	p.drawLogo(qml, y)
	const textOffsetY = (20.0 - 11.0) / 2
	p.setFont("B", 13)
	p.setColor(cINK)
	doc.SetXY(qml+23, y+textOffsetY)
	doc.CellFormat(60, 7, "HouseXpert", "", 0, "L", false, 0, "")
	p.setFont("", 7.5)
	p.setColor(cINK3)
	doc.SetXY(qml+23, y+textOffsetY+7)
	doc.CellFormat(60, 4, "Your Complete Home Solution", "", 0, "L", false, 0, "")

	// Right block
	const (
		divX   = 96.0
		rightX = divX + 5
		rightW = (qpw - qmr) - rightX // 95mm
	)

	// "QUOTATION" title + status on same line
	p.setFont("B", 10)
	p.setColor(cINK)
	doc.SetXY(rightX, y)
	doc.CellFormat(40, 7, "QUOTATION", "", 0, "L", false, 0, "")

	p.setFont("B", 7.5)
	p.setColor(cINK3)
	doc.SetXY(rightX+42, y+1.5)
	doc.CellFormat(rightW-42, 5, strings.ToUpper(string(q.Status)), "", 0, "L", false, 0, "")

	// Meta rows
	meta := [][2]string{
		{"Quotation ID", q.QuotationID},
		{"Client", q.ClientName},
	}
	if q.ClientPhone != "" {
		meta = append(meta, [2]string{"Phone", q.ClientPhone})
	}
	if q.ClientLocation != "" {
		meta = append(meta, [2]string{"Location", q.ClientLocation})
	}
	meta = append(meta, [2]string{"Date", q.CreatedAt.Format("2 Jan 2006")})

	const (
		metaLW = 24.0
		metaRH = 4.2
	)
	for i, row := range meta {
		ry := y + 7 + float64(i)*metaRH
		p.setFont("", 7)
		p.setColor(cINK4)
		doc.SetXY(rightX, ry)
		doc.CellFormat(metaLW, 4, row[0]+":", "", 0, "L", false, 0, "")
		p.setFont("B", 7)
		p.setColor(cINK2)
		doc.SetXY(rightX+metaLW, ry)
		doc.CellFormat(rightW-metaLW, 4, p.truncate(row[1], rightW-metaLW-1), "", 0, "L", false, 0, "")
	}

	yBottom := y + 7 + float64(len(meta))*metaRH + 3
	if yBottom < 44 {
		yBottom = 44
	}

	// Vertical separator between brand and report info
	p.setDraw(cLINE)
	doc.SetLineWidth(0.3)
	doc.Line(divX, y, divX, yBottom-3)

	// Bottom divider before table
	p.qhLine(yBottom, cLINE, 0.4)
	return yBottom + 5
}

// ── Section header ────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotSectionHeader(y float64, roomName string, total float64) float64 {
	doc := p.doc

	// Deep navy background spanning full content width
	p.setFill(cINK)
	doc.Rect(qml, y, qcw, qsH, "F")

	ty := y + (qsH-cellH)/2

	p.setFont("B", 9)
	p.setColor(rgb{255, 255, 255})
	doc.SetXY(qml+qpX, ty)
	doc.CellFormat(90, cellH, roomName, "", 0, "L", false, 0, "")

	p.setFont("B", 9)
	p.setColor(rgb{255, 255, 255})
	doc.SetXY(qml, ty)
	doc.CellFormat(qcw-qpX, cellH, p.rupee+" "+formatNum(total), "", 0, "R", false, 0, "")

	doc.SetXY(qml, y+qsH)
	return y + qsH
}

// ── Table column header ───────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotTableHeader(y float64) float64 {
	doc := p.doc

	p.setFill(cINK5)
	doc.Rect(qml, y, qcw, qhH, "F")
	p.qhLine(y, cLINE, 0.3)
	p.qhLine(y+qhH, cLINE, 0.4)

	ty := y + (qhH-cellH)/2

	type thDef struct {
		c     col
		label string
		align string
	}
	headers := []thDef{
		{qCols.idx, "#", "L"},
		{qCols.desc, "DESCRIPTION / NOTE", "L"},
		{qCols.size, "SIZE", "L"},
		{qCols.sqft, "SQ.FT", "R"},
		{qCols.qty, "QTY", "R"},
		{qCols.rate, "RATE", "R"},
		{qCols.amount, "AMOUNT", "R"},
	}

	p.setFont("B", 7)
	p.setColor(cINK)

	for _, h := range headers {
		if h.align == "R" {
			p.cell(h.c.x, ty, h.c.w-qpX, h.label, "R")
		} else {
			p.cell(h.c.x+qpX, ty, h.c.w-qpX, h.label, "L")
		}
	}

	doc.SetXY(qml, y+qhH)
	return y + qhH
}

// ── Item row ──────────────────────────────────────────────────────────────────
//
// Two-line layout when item has a note:
//
//	line1Y = y+1   → description (bold)
//	line2Y = y+6   → note (small, ink-4)
//
// Single-line layout otherwise: vertically centred.
func (p *pdfWriter) drawQuotItemRow(y float64, idx int, item models.QuotationItem, shade bool) float64 {
	doc := p.doc

	if shade {
		p.setFill(cBGSUN)
		doc.Rect(qml, y, qcw, qrH, "F")
	}
	p.qhLine(y+qrH, cLINE2, 0.15)

	line1Y := y + 1.0
	line2Y := y + 1.0 + cellH
	singleY := y + (qrH-cellH)/2.0
	hasNote := item.Note != ""

	// Index
	p.setFont("", 7.5)
	p.setColor(cINK4)
	p.cell(qCols.idx.x+qpX, singleY, qCols.idx.w-qpX*2, fmt.Sprintf("%d", idx), "L")

	// Description (line1 or vertically centred)
	descY := singleY
	if hasNote {
		descY = line1Y
	}
	p.setFont("B", 8.5)
	p.setColor(cINK)
	p.cell(qCols.desc.x+qpX, descY, qCols.desc.w-qpX*2,
		p.truncate(item.Description, qCols.desc.w-qpX*2), "L")

	if hasNote {
		p.setFont("", 7)
		p.setColor(cINK4)
		p.cell(qCols.desc.x+qpX, line2Y, qCols.desc.w-qpX*2,
			p.truncate("Note: "+item.Note, qCols.desc.w-qpX*2), "L")
	}

	// Size
	p.setFont("", 8)
	if item.Size != "" {
		p.setColor(cINK3)
		p.cell(qCols.size.x+qpX, singleY, qCols.size.w-qpX, item.Size, "L")
	} else {
		p.setColor(cINK5)
		p.cell(qCols.size.x+qpX, singleY, qCols.size.w-qpX, p.dash, "L")
	}

	// Sq.ft
	p.setFont("", 8)
	if item.Sqft != nil && *item.Sqft > 0 {
		p.setColor(cINK2)
		p.cell(qCols.sqft.x, singleY, qCols.sqft.w-qpX, formatNum(*item.Sqft), "R")
	} else {
		p.setColor(cINK5)
		p.cell(qCols.sqft.x, singleY, qCols.sqft.w-qpX, p.dash, "R")
	}

	// Qty
	p.setFont("B", 8)
	p.setColor(cINK2)
	p.cell(qCols.qty.x, singleY, qCols.qty.w-qpX, formatNum(item.Qty), "R")

	// Rate
	p.setFont("", 8)
	p.setColor(cINK2)
	p.cell(qCols.rate.x, singleY, qCols.rate.w-qpX, p.rupee+" "+formatNum(item.Rate), "R")

	// Amount
	if item.Amount > 0 {
		p.setFont("B", 8.5)
		p.setColor(cINK)
	} else {
		p.setFont("", 8)
		p.setColor(cINK5)
	}
	amtText := p.dash
	if item.Amount > 0 {
		amtText = p.rupee + " " + formatNum(item.Amount)
	}
	p.cell(qCols.amount.x, singleY, qCols.amount.w-qpX, amtText, "R")

	doc.SetXY(qml, y+qrH)
	return y + qrH
}

// ── Grand total ───────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotGrandTotal(y float64, total float64) float64 {
	doc := p.doc
	const rowH = 11.0

	p.setFill(cINK)
	doc.Rect(qml, y, qcw, rowH, "F")

	ty := y + (rowH-cellH)/2

	p.setFont("B", 9)
	p.setColor(rgb{255, 255, 255})
	doc.SetXY(qml+qpX, ty)
	doc.CellFormat(80, cellH, "GRAND TOTAL", "", 0, "L", false, 0, "")

	p.setFont("B", 11)
	p.setColor(rgb{255, 255, 255})
	doc.SetXY(qml, ty)
	doc.CellFormat(qcw-qpX, cellH, p.rupee+" "+formatNum(total), "", 0, "R", false, 0, "")

	return y + rowH + 4
}

// ── Notes block ───────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotNotes(y float64, notes string) {
	doc := p.doc

	p.setFont("B", 8.5)
	p.setColor(cINK)
	doc.SetXY(qml, y)
	doc.CellFormat(qcw, 5, "Notes", "", 1, "L", false, 0, "")

	p.setFont("", 8)
	p.setColor(cINK3)
	doc.SetXY(qml, doc.GetY()+1)
	doc.MultiCell(qcw, 4.5, notes, "", "L", false)
}

// ── Helper ────────────────────────────────────────────────────────────────────

// sanitizeFilename replaces spaces with hyphens and strips characters that are
// unsafe in filenames, so client names like "Rahul Sharma" become "Rahul-Sharma".
func sanitizeFilename(s string) string {
	s = strings.ReplaceAll(s, " ", "-")
	var out []rune
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return "client"
	}
	return string(out)
}

func quotSectionTotal(sec models.QuotationSection) float64 {
	total := 0.0
	for _, item := range sec.Items {
		total += item.Amount
	}
	return total
}
