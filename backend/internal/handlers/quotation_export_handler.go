// this file has code for --> turn a saved quotation into a styled downloadable PDF.
// this file manages presentation on paper/PDF.
//
// REDESIGN: matches the Quotation Redesign.html A4 artboard:
// walnut + amber + cream palette, serif display type, mono numerals,
// cover watermark, running headers, meta grid, section rules and appendix cards.
package handlers

import (
	"bytes"
	"fmt"
	"math"
	"strings"

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
	qml = 14.8            // 56px frame inset from HTML preview
	qmr = 14.8            // right margin
	qcw = qpw - qml - qmr // 180.4mm content width
	qrH = 9.6             // base item row height: 11px/8px table padding from HTML
	qhH = 7.5             // column header row height
	qsH = 10.6            // section header row height
	qpX = 2.1             // horizontal cell padding
)

const (
	qContactEmail  = "housexperts.in@gmail.com"
	qContactPhone1 = "+91-9726957423"
	qContactPhone2 = "+91-9426516058"
)

// ── Brand palette ─────────────────────────────────────────────────────────────
//
// Sampled from the HousExpert logo (warm walnut + amber gold + cream). Names are
// prefixed `cQ` so they don't collide with the cINK/cLINE family in export_handler.go.

var (
	cQInk       = rgb{42, 24, 16}    // #2A1810 deep walnut
	cQInk2      = rgb{74, 46, 28}    // #4A2E1C
	cQInk3      = rgb{122, 99, 83}   // #7A6353 muted brown text
	cQInk4      = rgb{168, 150, 132} // #A89684 secondary labels
	cQInk5      = rgb{214, 203, 188} // #D6CBBC disabled / dashes
	cQPaper     = rgb{251, 247, 241} // #FBF7F1 warm cream background
	cQPaper2    = rgb{244, 236, 223} // #F4ECDF tinted cream
	cQRowShade  = rgb{248, 242, 233} // rgba(232,221,199,0.18) over paper
	cQRule      = rgb{229, 217, 197} // #E5D9C5 page rules
	cQRule2     = rgb{239, 230, 213} // #EFE6D5 row dividers
	cQAmber     = rgb{208, 138, 60}  // #D08A3C primary accent
	cQAmberDeep = rgb{182, 112, 30}  // #B6701E accent (text)
	cQAmberSoft = rgb{242, 212, 164} // #F2D4A4 highlight text on dark
	cQTagText   = rgb{241, 228, 208} // #F1E4D0
	cQWatermark = rgb{243, 238, 231} // approximates rgba(74,46,28,0.04)
	cQWhite     = rgb{255, 255, 255}
)

// Quotation item columns, mapped from the HTML colgroup:
// 30 / auto / 70 / 56 / 50 / 88 / 100 px inside a 682px frame.
//
//	7.94 + 76.19 + 18.52 + 14.82 + 13.23 + 23.28 + 26.42 ≈ 180.4
var qCols = struct {
	idx, desc, size, sqft, qty, rate, amount col
}{
	idx:    col{qml, 7.94},
	desc:   col{qml + 7.94, 76.19},
	size:   col{qml + 84.13, 18.52},
	sqft:   col{qml + 102.65, 14.82},
	qty:    col{qml + 117.47, 13.23},
	rate:   col{qml + 130.70, 23.28},
	amount: col{qml + 153.98, 26.42},
}

// ── Font helpers ──────────────────────────────────────────────────────────────
//
// The HTML preview uses Cormorant Garamond, Hanken Grotesk and JetBrains Mono.
// Built-in PDF core fonts keep the export dependency-free while preserving the
// same three-part hierarchy: Times display, Helvetica body, Courier numerals.

func (p *pdfWriter) serif(style string, size float64) {
	p.doc.SetFont("Times", style, size)
}

func (p *pdfWriter) sans(style string, size float64) {
	p.doc.SetFont("Helvetica", style, size)
}

func (p *pdfWriter) mono(style string, size float64) {
	p.doc.SetFont("Courier", style, size)
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

// newPortraitPDFWriter builds a blank A4 portrait PDF, paints the cream page
// background once, and primes the brand fonts + logo.
func newPortraitPDFWriter() *pdfWriter {
	doc := gofpdf.NewCustom(&gofpdf.InitType{
		OrientationStr: "P",
		UnitStr:        "mm",
		SizeStr:        "A4",
	})
	doc.SetMargins(qml, 14, qmr)
	doc.SetAutoPageBreak(true, 16)

	p := &pdfWriter{doc: doc, font: "Helvetica", rupee: "Rs.", dash: "-"}
	p.translate = doc.UnicodeTranslatorFromDescriptor("")
	p.findLogo()

	// Cream page background, drawn on every new page via header hook.
	doc.SetHeaderFunc(func() {
		p.setFill(cQPaper)
		doc.Rect(0, 0, qpw, qph, "F")
		// HTML brand rule: 2px at 96dpi ≈ 0.53mm.
		p.setFill(cQInk)
		doc.Rect(qml, 9.5, qcw*0.60, 0.55, "F")
		p.setFill(cQAmber)
		doc.Rect(qml+qcw*0.60, 9.5, qcw*0.40, 0.55, "F")
	})

	return p
}

// drawBrandLogo renders the logo at (x, y) within a `size` mm square.
// Falls back to a walnut box with amber initials when no image is present.
func (p *pdfWriter) drawBrandLogo(x, y, size float64) {
	doc := p.doc
	if p.logoPath != "" {
		doc.ImageOptions(p.logoPath, x, y, size, size, false, gofpdf.ImageOptions{}, 0, "")
		return
	}
	p.setFill(cQInk)
	doc.Rect(x, y, size, size, "F")
	p.serif("B", 10)
	p.setColor(cQAmberSoft)
	doc.SetXY(x, y+size/2-2.4)
	doc.CellFormat(size, 5, p.text("HX"), "", 0, "C", false, 0, "")
	p.setColor(cQInk) // restore
}

// qhLine — horizontal rule across full portrait content width at y.
func (p *pdfWriter) qhLine(y float64, c rgb, lw float64) {
	p.setDraw(c)
	p.doc.SetLineWidth(lw)
	p.doc.Line(qml, y, qml+qcw, y)
}

func (p *pdfWriter) drawCoverWatermark() {
	doc := p.doc
	p.serif("I", 345)
	p.setColor(cQWatermark)
	doc.SetXY(qpw-60, qph-122)
	doc.CellFormat(80, 95, p.text("Q"), "", 0, "L", false, 0, "")
}

func (p *pdfWriter) drawQuotRunningHeader(q *models.Quotation, kicker, title string) float64 {
	doc := p.doc
	y := 13.8
	const logoSize = 10.1

	p.drawBrandLogo(qml, y, logoSize)
	p.serif("", 15)
	p.setColor(cQInk)
	doc.SetXY(qml+logoSize+3.7, y+0.4)
	doc.CellFormat(72, 5.8, p.text("HousExpert"), "", 0, "L", false, 0, "")

	p.sans("", 6.8)
	p.setColor(cQInk3)
	doc.SetXY(qml+logoSize+3.7, y+6.4)
	doc.CellFormat(94, 3.5,
		p.text(fmt.Sprintf("Quotation  ·  %s  ·  %s", q.QuotationID, p.truncate(q.ClientName, 58))),
		"", 0, "L", false, 0, "")

	p.sans("B", 6.8)
	p.setColor(cQInk3)
	doc.SetXY(qml+qcw-62, y+0.4)
	doc.CellFormat(62, 3.5, p.text(strings.ToUpper(kicker)), "", 0, "R", false, 0, "")

	p.serif("I", 16.5)
	p.setColor(cQInk)
	doc.SetXY(qml+qcw-76, y+5.6)
	doc.CellFormat(76, 6.5, p.text(title), "", 0, "R", false, 0, "")

	bottom := y + logoSize + 3.7
	p.qhLine(bottom, cQRule, 0.3)
	return bottom + 4.8
}

// ── PDF builder ───────────────────────────────────────────────────────────────

func buildQuotationPDF(q *models.Quotation) (*bytes.Buffer, error) {
	p := newPortraitPDFWriter()
	doc := p.doc

	doc.AddPage()
	p.drawCoverWatermark()
	y := p.drawQuotHeader(q)
	y = p.drawQuotMetaGrid(y, q)
	y = p.drawQuotTagline(y)

	for i, sec := range q.Sections {
		// Ensure room for section header + col header + at least one item row
		if y+qsH+qhH+qrH+6 > qph-18 {
			doc.AddPage()
			y = p.drawQuotRunningHeader(q, "Continued", "Sections & Totals")
		}
		y = p.drawQuotSectionHeader(y, i+1, sec.RoomName, len(sec.Items), quotSectionTotal(sec))
		y = p.drawQuotTableHeader(y)

		for j, item := range sec.Items {
			rowH := quotItemRowHeight(item)
			if y+rowH > qph-18 {
				doc.AddPage()
				y = p.drawQuotRunningHeader(q, "Continued", sec.RoomName)
				y = p.drawQuotTableHeader(y)
			}
			y = p.drawQuotItemRow(y, j+1, item, j%2 == 1)
		}
		y += 6.4
	}

	// Grand total
	if y+34 > qph-18 {
		doc.AddPage()
		y = p.drawQuotRunningHeader(q, "Continued", "Sections & Totals")
	}
	y = p.drawQuotGrandTotal(y, q.SubtotalAmount, q.ApplyGST, q.GSTPercent, q.GSTAmount, q.TotalAmount)

	// Appendix notice
	if y+22 > qph-18 {
		doc.AddPage()
		y = p.drawQuotRunningHeader(q, "Continued", "Sections & Totals")
	}
	y = p.drawQuotationAppendixNotice(y)

	// Notes
	if q.Notes != "" {
		if y+24 > qph-18 {
			doc.AddPage()
			y = p.drawQuotRunningHeader(q, "Continued", "Notes")
		}
		p.drawQuotNotes(y, q.Notes)
	}

	// Specifications & terms appendix (always)
	p.drawQuotationSpecificationsAppendix(q)

	// Page footers
	doc.SetAutoPageBreak(false, 0)
	pageCount := doc.PageCount()
	for i := 1; i <= pageCount; i++ {
		doc.SetPage(i)
		p.qhLine(qph-10.1, cQRule, 0.25)
		p.sans("", 7.1)
		p.setColor(cQInk3)
		doc.SetXY(qml, qph-7.9)
		doc.CellFormat(70, 4, p.text("HousExpert  ·  Confidential"), "", 0, "L", false, 0, "")
		doc.CellFormat(qcw-70-30, 4,
			p.text(fmt.Sprintf("%s  —  %s", q.QuotationID, p.truncate(q.ClientName, 60))),
			"", 0, "C", false, 0, "")
		p.mono("", 7.1)
		p.setColor(cQInk2)
		doc.SetXY(qml+qcw-30, qph-7.9)
		doc.CellFormat(30, 4, p.text(fmt.Sprintf("%02d / %02d", i, pageCount)), "", 0, "R", false, 0, "")
	}

	var buf bytes.Buffer
	if err := doc.Output(&buf); err != nil {
		return nil, err
	}
	return &buf, nil
}

// ── Page 1 header (cover-style) ───────────────────────────────────────────────
//
// Layout (y from page top):
//
//	y=10   ▓▓▓▓▓▓ walnut ▓▓▓▓ amber ▓▓ — brand rule (drawn by header func)
//	y=18   [LOGO 16×16]  HousExpert          │  PROPOSAL NO. QT-014
//	y=24                 Your Complete…      │  Quotation     (serif italic, large)
//	                                         │  ● Draft · For Review
//	y≈48   ───────────────────────────────────────────────
func (p *pdfWriter) drawQuotHeader(q *models.Quotation) float64 {
	doc := p.doc

	y := 13.8
	const logoSize = 14.3

	// Brand block (left)
	p.drawBrandLogo(qml, y, logoSize)
	p.serif("", 21)
	p.setColor(cQInk)
	doc.SetXY(qml+logoSize+3.7, y+0.6)
	doc.CellFormat(80, 8, p.text("HousExpert"), "", 0, "L", false, 0, "")

	p.sans("", 7.4)
	p.setColor(cQInk3)
	doc.SetXY(qml+logoSize+3.7, y+8.6)
	doc.CellFormat(80, 4, p.text("YOUR  COMPLETE  HOME  SOLUTION"), "", 0, "L", false, 0, "")

	// Proposal block (right)
	const rightX = qml + qcw - 78
	const rightW = 78.0

	p.sans("", 7.1)
	p.setColor(cQInk3)
	doc.SetXY(rightX, y)
	doc.CellFormat(rightW, 3.5, p.text("PROPOSAL  NO.  "+q.QuotationID), "", 0, "R", false, 0, "")

	// Big serif "Quotation" wordmark — italic for editorial feel.
	p.serif("I", 34.5)
	p.setColor(cQInk)
	doc.SetXY(rightX, y+2.2)
	doc.CellFormat(rightW, 13.5, p.text("Quotation"), "", 0, "R", false, 0, "")

	// Status pill
	statusUpper := strings.ToUpper(string(q.Status))
	statusLabel := statusUpper
	if statusUpper == "DRAFT" {
		statusLabel = "DRAFT  ·  FOR REVIEW"
	} else if statusUpper == "SENT" {
		statusLabel = "SENT  ·  AWAITING CLIENT"
	}
	p.sans("B", 6.7)
	pillW := p.measureText(statusLabel, 6.7) + 11
	pillX := rightX + rightW - pillW
	pillY := y + 18.6
	p.setFill(cQPaper2)
	p.setDraw(cQRule)
	doc.SetLineWidth(0.2)
	doc.RoundedRect(pillX, pillY, pillW, 5.5, 2.75, "1234", "FD")
	// amber dot
	p.setFill(cQAmber)
	doc.Circle(pillX+3.2, pillY+2.75, 0.95, "F")
	p.sans("B", 6.7)
	p.setColor(cQInk2)
	doc.SetXY(pillX+5.5, pillY+0.8)
	doc.CellFormat(pillW-6, 4, p.text(statusLabel), "", 0, "L", false, 0, "")

	yBottom := y + 28.6
	if yBottom < 42.4 {
		yBottom = 42.4
	}
	p.qhLine(yBottom, cQRule, 0.25)
	return yBottom + 5.8
}

// ── Meta grid (Prepared For / Issued By / Schedule) ───────────────────────────

func (p *pdfWriter) drawQuotMetaGrid(y float64, q *models.Quotation) float64 {
	doc := p.doc
	const (
		gridH        = 41.0
		colW         = qcw / 3.0
		padTop       = 3.8 // 14px in the HTML design
		padX         = 4.2 // 16px in the HTML design
		afterLabel   = 5.1 // label line + 8px margin-bottom
		afterPrimary = 6.7 // strong line-height + 6px margin before secondary copy
	)

	// The HTML preview keeps this almost paper-white; the border carries it.
	p.setFill(cQPaper)
	p.setDraw(cQRule)
	doc.SetLineWidth(0.25)
	doc.Rect(qml, y, qcw, gridH, "FD")

	// Full-height column dividers, matching the browser grid.
	for i := 1; i <= 2; i++ {
		x := qml + float64(i)*colW
		p.setDraw(cQRule)
		doc.SetLineWidth(0.25)
		doc.Line(x, y, x, y+gridH)
	}

	drawCell := func(idx int, label, primary string, primarySize float64, lines []string) {
		x := qml + float64(idx)*colW
		// Label
		p.sans("", 7.0)
		p.setColor(cQInk3)
		doc.SetXY(x+padX, y+padTop)
		doc.CellFormat(colW-padX*2, 3.4, p.text(spacedCaps(label)), "", 0, "L", false, 0, "")

		// Primary text wraps instead of shrinking, like the HTML card.
		p.serif("", primarySize)
		p.setColor(cQInk)
		primaryY := y + padTop + afterLabel
		primaryW := colW - padX*2 - 3
		doc.SetXY(x+padX, primaryY)
		if doc.GetStringWidth(p.text(primary)) > primaryW {
			doc.MultiCell(primaryW, 7.1, p.text(primary), "", "L", false)
		} else {
			doc.CellFormat(primaryW, 7.1, p.text(primary), "", 0, "L", false, 0, "")
		}
		secondaryY := doc.GetY()
		if secondaryY < primaryY+afterPrimary {
			secondaryY = primaryY + afterPrimary
		}
		secondaryY += 0.7

		// Secondary lines
		p.sans("", 9.4)
		p.setColor(cQInk2)
		for _, line := range lines {
			doc.SetXY(x+padX, secondaryY)
			if doc.GetStringWidth(p.text(line)) > colW-padX*2-1 {
				doc.MultiCell(colW-padX*2-2, 4.8, p.text(line), "", "L", false)
				secondaryY = doc.GetY() + 0.1
			} else {
				doc.CellFormat(colW-padX*2, 4.8, p.text(line), "", 0, "L", false, 0, "")
				secondaryY += 5.0
			}
		}
	}

	// Cell 1 — Prepared For
	clientLines := []string{}
	if q.ClientPhone != "" {
		clientLines = append(clientLines, q.ClientPhone)
	}
	if q.ClientLocation != "" {
		clientLines = append(clientLines, q.ClientLocation)
	}
	primary := q.ClientName
	if primary == "" {
		primary = p.dash
	}
	drawCell(0, "Prepared For", primary, 16.5, clientLines)

	// Cell 2 — Issued By
	drawCell(1, "Issued By", "HousExpert", 16.0,
		[]string{qContactEmail, qContactPhone1, qContactPhone2})

	// Cell 3 — Schedule (label/value pairs, slightly different shape)
	x := qml + 2*colW
	p.sans("", 7.0)
	p.setColor(cQInk3)
	doc.SetXY(x+padX, y+padTop)
	doc.CellFormat(colW-padX*2, 3.4, p.text(spacedCaps("Schedule")), "", 0, "L", false, 0, "")

	rows := [][2]string{
		{"Issued", q.CreatedAt.Format("2 Jan 2006")},
		{"Valid until", q.CreatedAt.AddDate(0, 1, 0).Format("2 Jan 2006")},
		{"Reference", q.QuotationID},
	}
	for i, row := range rows {
		ry := y + padTop + afterLabel + float64(i)*4.8
		if i == 2 {
			ry += 1.6 // HTML margin-top: 6px before Reference
		}
		p.sans("B", 9.4)
		p.setColor(cQInk3)
		doc.SetXY(x+padX, ry)
		doc.CellFormat(24, 4.8, p.text(row[0]), "", 0, "L", false, 0, "")
		p.mono("", 8.8)
		p.setColor(cQInk2)
		doc.SetXY(x+padX+24, ry+0.05)
		doc.CellFormat(colW-padX*2-24, 4.8,
			p.text(p.truncate(row[1], colW-padX*2-25)), "", 0, "L", false, 0, "")
	}

	return y + gridH + 5.8
}

// ── Tagline strip ─────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotTagline(y float64) float64 {
	doc := p.doc
	const h = 16.2

	// Dark walnut band with amber edge.
	p.setFill(cQInk)
	doc.Rect(qml, y, qcw, h, "F")
	p.setFill(cQAmber)
	doc.Rect(qml, y, 1.05, h, "F")

	const (
		fontSize = 7.6
		tracking = 0.66
		lineH    = 4.6
	)
	x := qml + 4.8
	line1Y := y + 4.3
	line2Y := y + 8.9

	p.sans("", fontSize)
	lead := "FACTORY-FINISHED INTERIORS THAT ALIGN WITH YOUR DESIGN STANDARDS."
	p.drawTrackedText(x, line1Y, lead, lineH, tracking, cQTagText)

	xDelivery := x + p.trackedWidth(lead+" ", tracking)
	p.sans("B", fontSize)
	delivered := "DELIVERED"
	if xDelivery+p.trackedWidth(delivered, tracking) > qml+qcw-4.8 {
		xDelivery = x
		line2Y = y + 8.9
	}
	p.drawTrackedText(xDelivery, line1Y, delivered, lineH, tracking, cQAmberSoft)
	p.drawTrackedText(x, line2Y, "WITH SPEED AND PRECISION.", lineH, tracking, cQAmberSoft)

	return y + h + 7.6
}

// ── Section header ────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotSectionHeader(y float64, idx int, roomName string, itemCount int, total float64) float64 {
	doc := p.doc

	// Bottom rule under the section heading, walnut.
	p.setDraw(cQInk)
	doc.SetLineWidth(0.55)
	doc.Line(qml, y+qsH-0.35, qml+qcw, y+qsH-0.35)

	// Section number in amber mono-feeling type.
	p.mono("", 7.5)
	p.setColor(cQAmberDeep)
	doc.SetXY(qml, y+3.0)
	doc.CellFormat(10, 4.5, p.text(fmt.Sprintf("%02d", idx)), "", 0, "L", false, 0, "")

	// Room name — large italic serif, with item count on the same baseline.
	p.serif("I", 18.0)
	p.setColor(cQInk)
	titleX := qml + 9.7
	roomTitleW := doc.GetStringWidth(p.text(roomName))
	doc.SetXY(titleX, y+0.45)
	doc.CellFormat(90, 8.0, p.text(roomName), "", 0, "L", false, 0, "")

	// Item count meta
	itemsLbl := fmt.Sprintf("%d  LINE  ITEMS", itemCount)
	if itemCount == 1 {
		itemsLbl = "1  LINE  ITEM"
	}
	p.sans("", 7.1)
	p.setColor(cQInk3)
	countX := titleX + roomTitleW + 6.2
	doc.SetXY(countX, y+4.2)
	doc.CellFormat(56, 3.8, p.text(spacedCaps(itemsLbl)), "", 0, "L", false, 0, "")

	// Section total — right aligned
	amountText := p.rupee + " " + formatNum(total)
	p.serif("", 13.5)
	amountW := doc.GetStringWidth(p.text(amountText)) + 1.5
	amountRight := qml + qcw
	amountX := amountRight - amountW

	p.sans("", 6.8)
	p.setColor(cQInk3)
	labelW := 49.0
	labelGap := 4.0
	labelX := amountX - labelGap - labelW
	doc.SetXY(labelX, y+4.0)
	doc.CellFormat(labelW, 3.5, p.text(spacedCaps("Section Total")), "", 0, "R", false, 0, "")

	p.serif("", 13.5)
	p.setColor(cQInk)
	doc.SetXY(amountX, y+1.95)
	doc.CellFormat(amountW, 6.0, p.text(amountText), "", 0, "R", false, 0, "")

	return y + qsH + 0.9
}

// ── Table column header ───────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotTableHeader(y float64) float64 {
	doc := p.doc

	ty := y + (qhH-cellH)/2

	type thDef struct {
		c     col
		label string
		align string
	}
	headers := []thDef{
		{qCols.idx, "#", "L"},
		{qCols.desc, "DESCRIPTION", "L"},
		{qCols.size, "SIZE", "L"},
		{qCols.sqft, "SQ.FT", "R"},
		{qCols.qty, "QTY", "R"},
		{qCols.rate, "RATE", "R"},
		{qCols.amount, "AMOUNT", "R"},
	}

	p.sans("B", 6.35)
	p.setColor(cQInk3)

	for _, h := range headers {
		label := h.label
		if label != "#" {
			label = spacedCaps(label)
		}
		if h.align == "R" {
			p.cell(h.c.x, ty, h.c.w-qpX, label, "R")
		} else {
			p.cell(h.c.x+qpX, ty, h.c.w-qpX, label, "L")
		}
	}

	p.qhLine(y+qhH, cQRule, 0.25)
	doc.SetXY(qml, y+qhH)
	return y + qhH
}

// ── Item row ──────────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotItemRow(y float64, idx int, item models.QuotationItem, shade bool) float64 {
	doc := p.doc
	rowH := quotItemRowHeight(item)

	if shade {
		p.setFill(cQRowShade)
		doc.Rect(qml, y, qcw, rowH, "F")
	}
	p.qhLine(y+rowH, cQRule2, 0.2)

	hasNote := item.Note != ""
	line1Y := y + 2.55
	line2Y := y + 6.95
	valueY := line1Y

	// Index — mono-feeling, muted
	p.mono("", 7.5)
	p.setColor(cQInk4)
	p.cell(qCols.idx.x+qpX, valueY, qCols.idx.w-qpX*2, fmt.Sprintf("%02d", idx), "L")

	// Description
	p.sans("", 8.25)
	p.setColor(cQInk)
	p.cell(qCols.desc.x+qpX, line1Y, qCols.desc.w-qpX*2,
		p.truncate(item.Description, qCols.desc.w-qpX*2), "L")

	if hasNote {
		p.sans("I", 7.5)
		p.setColor(cQInk3)
		p.cell(qCols.desc.x+qpX, line2Y, qCols.desc.w-qpX*2,
			p.truncate(item.Note, qCols.desc.w-qpX*2), "L")
	}

	// Size
	p.mono("", 7.85)
	if item.Size != "" {
		p.setColor(cQInk2)
		p.cell(qCols.size.x+qpX, valueY, qCols.size.w-qpX, item.Size, "L")
	} else {
		p.setColor(cQInk5)
		p.cell(qCols.size.x+qpX, valueY, qCols.size.w-qpX, p.dash, "L")
	}

	// Sq.ft
	p.mono("", 7.85)
	if item.Sqft != nil && *item.Sqft > 0 {
		p.setColor(cQInk2)
		p.cell(qCols.sqft.x, valueY, qCols.sqft.w-qpX, formatNum(*item.Sqft), "R")
	} else {
		p.setColor(cQInk5)
		p.cell(qCols.sqft.x, valueY, qCols.sqft.w-qpX, p.dash, "R")
	}

	// Qty
	p.mono("", 7.85)
	p.setColor(cQInk2)
	p.cell(qCols.qty.x, valueY, qCols.qty.w-qpX, formatNum(item.Qty), "R")

	// Rate
	p.mono("", 7.85)
	p.setColor(cQInk2)
	p.cell(qCols.rate.x, valueY, qCols.rate.w-qpX, p.rupee+" "+formatNum(item.Rate), "R")

	// Amount — bold ink for non-zero, faded dash for zero
	if item.Amount > 0 {
		p.serif("B", 9.75)
		p.setColor(cQInk)
	} else {
		p.serif("", 8)
		p.setColor(cQInk5)
	}
	amtText := p.dash
	if item.Amount > 0 {
		amtText = p.rupee + " " + formatNum(item.Amount)
	}
	p.cell(qCols.amount.x, valueY, qCols.amount.w-qpX, amtText, "R")

	doc.SetXY(qml, y+rowH)
	return y + rowH
}

// ── Grand total ───────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotGrandTotal(y float64, subtotal float64, applyGST bool, gstPercent float64, gstAmount float64, total float64) float64 {
	doc := p.doc
	const (
		rowH   = 8.5
		grandH = 14.3
		labelW = 46.0
		valueW = 44.0
		tableW = labelW + valueW
	)
	startX := qml + qcw - tableW

	if subtotal == 0 {
		subtotal = total - gstAmount
	}

	rows := []struct {
		label string
		value string
	}{
		{label: "Subtotal", value: p.rupee + " " + formatNum(subtotal)},
	}
	if applyGST {
		rows = append(rows, struct {
			label string
			value string
		}{
			label: fmt.Sprintf("GST (%.2f%%)", gstPercent),
			value: p.rupee + " " + formatNum(gstAmount),
		})
	}

	// Outer frame box
	totalRowsH := float64(len(rows))*rowH + grandH
	p.setDraw(cQRule)
	doc.SetLineWidth(0.25)
	doc.Rect(startX, y, tableW, totalRowsH, "D")

	cy := y
	for i, row := range rows {
		// Dashed-ish divider between rows
		if i > 0 {
			p.setDraw(cQRule2)
			doc.SetLineWidth(0.15)
			doc.Line(startX+3, cy, startX+tableW-3, cy)
		}
		p.sans("", 9)
		p.setColor(cQInk3)
		doc.SetXY(startX+4.2, cy+2.0)
		doc.CellFormat(labelW, 4.5, p.text(row.label), "", 0, "L", false, 0, "")
		p.mono("", 9)
		p.setColor(cQInk)
		doc.SetXY(startX+labelW, cy+2.0)
		doc.CellFormat(valueW-4.2, 4.5, p.text(row.value), "", 0, "R", false, 0, "")
		cy += rowH
	}

	// Walnut grand-total band with amber edge.
	p.setFill(cQInk)
	doc.Rect(startX, cy, tableW, grandH, "F")
	p.setFill(cQAmber)
	doc.Rect(startX, cy, 1.05, grandH, "F")

	p.sans("B", 7.5)
	p.setColor(cQAmberSoft)
	doc.SetXY(startX+4.2, cy+4.7)
	doc.CellFormat(labelW, 3.5, p.text("GRAND  TOTAL"), "", 0, "L", false, 0, "")

	p.serif("B", 18)
	p.setColor(cQWhite)
	doc.SetXY(startX+labelW-4, cy+3.0)
	doc.CellFormat(valueW, 8, p.text(p.rupee+" "+formatNum(roundGrandTotal(total))), "", 0, "R", false, 0, "")

	return cy + grandH + 5.8
}

// ── Notes block ───────────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotNotes(y float64, notes string) {
	doc := p.doc

	p.sans("", 6.8)
	p.setColor(cQAmberDeep)
	doc.SetXY(qml, y)
	doc.CellFormat(qcw, 3.5, p.text("NOTES"), "", 1, "L", false, 0, "")

	p.serif("I", 16.5)
	p.setColor(cQInk)
	doc.SetXY(qml, y+3.6)
	doc.CellFormat(qcw, 5, p.text("From the designer"), "", 1, "L", false, 0, "")

	p.sans("", 8.5)
	p.setColor(cQInk2)
	doc.SetXY(qml, doc.GetY()+1.5)
	doc.MultiCell(qcw, 4.6, p.text(notes), "", "L", false)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// measureText returns the approximate width in mm of `s` at the given point size,
// using the currently selected font. Used to size pills around their text.
func (p *pdfWriter) measureText(s string, size float64) float64 {
	prev, _ := p.doc.GetFontSize()
	p.doc.SetFontSize(size)
	w := p.doc.GetStringWidth(p.text(s))
	p.doc.SetFontSize(prev)
	return w
}

func (p *pdfWriter) trackedWidth(s string, tracking float64) float64 {
	w := 0.0
	runes := []rune(s)
	for i, r := range runes {
		w += p.doc.GetStringWidth(p.text(string(r)))
		if i < len(runes)-1 {
			w += tracking
		}
	}
	return w
}

func (p *pdfWriter) drawTrackedText(x, y float64, s string, cellHeight float64, tracking float64, color rgb) {
	p.setColor(color)
	cx := x
	runes := []rune(s)
	for i, r := range runes {
		ch := p.text(string(r))
		w := p.doc.GetStringWidth(ch)
		p.doc.SetXY(cx, y)
		p.doc.CellFormat(w, cellHeight, ch, "", 0, "L", false, 0, "")
		cx += w
		if i < len(runes)-1 {
			cx += tracking
		}
	}
}

func spacedCaps(s string) string {
	parts := strings.Fields(strings.ToUpper(s))
	for i, part := range parts {
		parts[i] = strings.Join(strings.Split(part, ""), " ")
	}
	return strings.Join(parts, "   ")
}

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

func quotItemRowHeight(item models.QuotationItem) float64 {
	if item.Note != "" {
		return 13.6
	}
	return qrH
}

func roundGrandTotal(total float64) float64 {
	return math.Round(total)
}
