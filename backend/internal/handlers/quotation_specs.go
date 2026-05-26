// Specifications & Terms appendix — drop-in replacement for
// backend/internal/handlers/quotation_specs.go.
//
// Redesigned to match the editorial walnut + amber + cream identity used by
// the quotation_export_handler.go template.
package handlers

import (
	"fmt"
	"strings"

	"housexpert/backend/internal/models"
)

type quotationSpecSection struct {
	Title string
	Items []string
}

var quotationSpecSections = []quotationSpecSection{
	{
		Title: "Selections Included",
		Items: []string{
			"Laminate selection: Designer, Carvers, Crafters, Plain, Unique, wooden and similar finishes.",
			"Cabinet handle selection.",
			"Sofa and headboard design plus fabric selection.",
			"Internal wardrobe partition and CNC design selection.",
			"LED light selection: Syska or Crompton, round or square, white or warm, 15W.",
		},
	},
	{
		Title: "Payment Milestones",
		Items: []string{
			"10% token amount.",
			"50% on material unloading.",
			"25% at laminate stage start.",
			"10% before paint work.",
			"5% at the time of sofa material selection.",
		},
	},
	{
		Title: "Material Specifications",
		Items: []string{
			"Ply: termite-proof, 10-year warranty, IS.303 / MR grade, Magic Ply.",
			"Inner mica: 0.8 mm, off-white or white, Durian.",
			"Laminate: 1 mm imported laminate with 10-year warranty, including Honest, One Touch, Latitude Gold and Premium Lam ranges.",
			"Electrical wiring: RR Cables.",
			"Kitchen baskets: tandem baskets with auto-close system, heavy quality, up to 12-year warranty, Excellence / Blandox.",
			"LED lights: standard company fittings such as Syska / Crompton.",
			"Electric switches: Hi-Fi.",
			"Hardware: ISI marked, including Blandox / Spenza.",
			"Paint: Asian Paint Royale.",
			"POP / gypsum: 10-year warranty sheet options such as Indigyp, Oman, Khushbu and Atlantica.",
		},
	},
	{
		Title: "Electrical And Site Scope",
		Items: []string{
			"35 lights included.",
			"Main hall rope light included.",
			"Main hall and all room pelmet work included.",
			"All-house colour in Royale range included where applicable.",
			"All-house POP included where applicable.",
		},
	},
	{
		Title: "Exclusions And Conditions",
		Items: []string{
			"Electronic items are not included, such as fan, AC, TV and similar appliances.",
			"Curtains and mattress are not included.",
			"Only 4 drawers are included in an 84 x 84 wardrobe. Extra drawers are chargeable at Rs. 2000 per drawer.",
			"Design is included in the quote and can be changed up to 3 times after the designer meeting. Further revisions are chargeable.",
			"Decorative lights are excluded, including jhumar, magnetic lights, sensor-based lights, AC wiring/fittings and Wi-Fi or internet wire.",
			"Centre table, aluminium section work, door laminates, glass partitions, bird net and all civil work are excluded unless specifically mentioned in the quotation.",
			"Paint / colour is not included in bathroom, lobby foyer area, washyard, balcony, doors and chaukhat unless specifically mentioned in the quotation.",
		},
	},
}

// ── Appendix notice block (sits at end of main quotation) ─────────────────────
//
// A subtle outlined cream card pointing the reader to the appendix that follows.
func (p *pdfWriter) drawQuotationAppendixNotice(y float64) float64 {
	doc := p.doc
	const (
		boxH = 15.4
		icon = 7.4
	)

	// HTML notice: tinted card, square walnut icon, text block.
	p.setFill(cQPaper2)
	p.setDraw(cQRule)
	doc.SetLineWidth(0.25)
	doc.Rect(qml, y, qcw, boxH, "FD")

	p.setFill(cQInk)
	doc.RoundedRect(qml+4.2, y+4.0, icon, icon, 1.6, "1234", "F")
	p.sans("B", 11)
	p.setColor(cQAmberSoft)
	doc.SetXY(qml+4.2, y+4.8)
	doc.CellFormat(icon, 5.0, p.text("i"), "", 0, "C", false, 0, "")

	p.sans("B", 9.4)
	p.setColor(cQInk)
	doc.SetXY(qml+15.8, y+3.4)
	doc.CellFormat(qcw-18, 4, p.text("Specifications & Terms Appendix Included"), "", 0, "L", false, 0, "")

	p.sans("", 8.2)
	p.setColor(cQInk3)
	doc.SetXY(qml+15.8, y+8.4)
	doc.CellFormat(qcw-18, 4,
		p.text("Material standards, payment milestones and exclusions are attached on the following pages as part of this quotation."),
		"", 0, "L", false, 0, "")

	return y + boxH + 4
}

// ── Appendix orchestrator ─────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotationSpecificationsAppendix(q *models.Quotation) {
	y := p.drawQuotationAppendixHeader(q, false, 1)
	pageSeq := 1

	for i, section := range quotationSpecSections {
		if y+p.measureQuotationSpecSection(section) > qph-20 {
			pageSeq++
			y = p.drawQuotationAppendixHeader(q, true, pageSeq)
		}
		y = p.drawQuotationSpecSection(y, i+1, section)
	}

	if y+quotationSignatureCardHeight+quotationClosingCardHeight+5 > qph-20 {
		pageSeq++
		y = p.drawQuotationAppendixHeader(q, true, pageSeq)
	}
	y = p.drawQuotationClientSignatureCard(y, q)

	if y+quotationClosingCardHeight > qph-20 {
		pageSeq++
		y = p.drawQuotationAppendixHeader(q, true, pageSeq)
	}
	p.drawQuotationClosingCard(y, q)
}

// ── Appendix page header (acts as a cover for the first appendix page) ────────

func (p *pdfWriter) drawQuotationAppendixHeader(q *models.Quotation, continued bool, seq int) float64 {
	doc := p.doc
	doc.AddPage()

	y := 13.8
	const logoSize = 11.1

	p.drawBrandLogo(qml, y, logoSize)
	p.serif("", 16.5)
	p.setColor(cQInk)
	doc.SetXY(qml+logoSize+3.7, y+0.5)
	doc.CellFormat(80, 6, p.text("HousExpert"), "", 0, "L", false, 0, "")

	tag := "Quotation  ·  " + q.QuotationID
	if continued {
		tag = "Specifications & Terms  ·  continued"
	}
	p.sans("", 6.8)
	p.setColor(cQInk3)
	doc.SetXY(qml+logoSize+3.7, y+6.6)
	doc.CellFormat(100, 3.6, p.text(tag), "", 0, "L", false, 0, "")

	// Appendix badge top-right
	badgeText := "APPENDIX"
	if continued {
		badgeText = fmt.Sprintf("APPENDIX  ·  %02d", seq)
	}
	const badgeW = 34.0
	badgeX := qml + qcw - badgeW
	p.setFill(cQPaper)
	p.setDraw(cQRule)
	doc.SetLineWidth(0.2)
	doc.Rect(badgeX, y+1.2, badgeW, 7.2, "FD")
	p.mono("", 7.5)
	p.setColor(cQInk3)
	doc.SetXY(badgeX, y+3.1)
	doc.CellFormat(badgeW, 3.8, p.text(badgeText), "", 0, "C", false, 0, "")

	headerBottom := y + logoSize + 3.7
	p.qhLine(headerBottom, cQRule, 0.25)

	if continued {
		return headerBottom + 4.8
	}

	heroY := headerBottom + 6.4
	p.sans("", 7.5)
	p.setColor(cQAmberDeep)
	doc.SetXY(qml, heroY)
	doc.CellFormat(100, 3.8, p.text("PART  OF  QUOTATION  "+q.QuotationID), "", 0, "L", false, 0, "")

	p.serif("I", 27.5)
	p.setColor(cQInk)
	doc.SetXY(qml, heroY+5.0)
	doc.CellFormat(112, 11, p.text("Specifications & Terms"), "", 0, "L", false, 0, "")

	p.mono("", 7.5)
	p.setColor(cQInk3)
	sideX := qml + qcw - 58
	indexRows := []string{
		"SECTION I · INCLUSIONS",
		"SECTION II · MILESTONES",
		"SECTION III · MATERIAL SPEC",
		"SECTION IV · SITE SCOPE",
		"SECTION V · EXCLUSIONS",
	}
	for i, row := range indexRows {
		doc.SetXY(sideX, heroY+1+float64(i)*4.1)
		doc.CellFormat(58, 3.4, p.text(row), "", 0, "R", false, 0, "")
	}

	heroBottom := heroY + 21.0
	p.qhLine(heroBottom, cQRule, 0.25)

	p.sans("", 9.4)
	p.setColor(cQInk2)
	doc.SetXY(qml, heroBottom+4.7)
	doc.MultiCell(qcw*0.72, 4.9,
		p.text("This appendix forms part of the quotation and captures the standard material specifications, inclusions and exclusions shared with the client. Any changes to scope, finishes or quantities will be re-quoted in writing before execution."),
		"", "L", false)

	return doc.GetY() + 5.3
}

// ── Spec card measurement ─────────────────────────────────────────────────────

func (p *pdfWriter) measureQuotationSpecSection(section quotationSpecSection) float64 {
	doc := p.doc
	const (
		titleBandH   = 11.4
		lineH        = 4.5
		bulletIndent = 5.8
		bulletGap    = 1.4
		contentPadX  = 4.8
		bodyPadV     = 7.9
	)

	prevSize, _ := doc.GetFontSize()
	p.sans("", 8.25)
	height := titleBandH + bodyPadV
	for _, item := range section.Items {
		lines := doc.SplitText(item, qcw-contentPadX*2-bulletIndent)
		if len(lines) == 0 {
			lines = []string{item}
		}
		height += float64(len(lines))*lineH + bulletGap + 3
	}
	doc.SetFontSize(prevSize)

	return height + 2
}

// ── Spec card render ──────────────────────────────────────────────────────────

func (p *pdfWriter) drawQuotationSpecSection(y float64, idx int, section quotationSpecSection) float64 {
	doc := p.doc
	const (
		titleBandH   = 11.4
		lineH        = 4.5
		bulletGap    = 1.4
		contentPadX  = 4.8
		bulletIndent = 5.8
		bodyPadTop   = 3.9
	)

	totalH := p.measureQuotationSpecSection(section)

	// Card frame — cream paper with rule.
	p.setFill(cQPaper)
	p.setDraw(cQRule)
	doc.SetLineWidth(0.25)
	doc.Rect(qml, y, qcw, totalH, "FD")

	// Walnut title band.
	p.setFill(cQInk)
	doc.Rect(qml, y, qcw, titleBandH, "F")

	roman := toRoman(idx)
	title := fmt.Sprintf("%s  ·  %s", roman, section.Title)
	p.serif("I", 13.5)
	p.setColor(cQWhite)
	doc.SetXY(qml+4.2, y+3.2)
	doc.CellFormat(qcw-56, 5.8, p.text(title), "", 0, "L", false, 0, "")

	// Right-side count chip.
	count := quotationSpecCountLabel(idx, len(section.Items))
	p.mono("", 7.5)
	p.setColor(cQAmberSoft)
	doc.SetXY(qml+qcw-45, y+4.0)
	doc.CellFormat(40, 3.8, p.text(count), "", 0, "R", false, 0, "")

	// Body — bullets as short amber dashes, like editorial article bullets.
	cursorY := y + titleBandH + bodyPadTop
	for i, item := range section.Items {
		// dash bullet (small horizontal line in amber-deep)
		p.setDraw(cQAmberDeep)
		doc.SetLineWidth(0.55)
		doc.Line(qml+contentPadX+1.1, cursorY+2.8, qml+contentPadX+3.2, cursorY+2.8)

		p.sans("", 8.25)
		p.setColor(cQInk2)
		doc.SetXY(qml+contentPadX+bulletIndent, cursorY)
		doc.MultiCell(qcw-contentPadX*2-bulletIndent, lineH, p.text(item), "", "L", false)

		nextY := doc.GetY() + bulletGap
		// Dashed separator between bullets (skip after the last)
		if i < len(section.Items)-1 {
			p.setDraw(cQRule2)
			doc.SetLineWidth(0.15)
			drawDashed(doc, qml+contentPadX, nextY-0.6, qml+qcw-contentPadX, nextY-0.6, 0.8, 0.8)
		}
		cursorY = nextY + 1.4
	}

	return y + totalH + 5
}

const (
	quotationClosingCardHeight   = 26.0
	quotationSignatureCardHeight = 46.0
)

func (p *pdfWriter) drawQuotationClosingCard(y float64, q *models.Quotation) float64 {
	doc := p.doc
	const h = quotationClosingCardHeight

	p.setFill(cQPaper2)
	p.setDraw(cQRule)
	doc.SetLineWidth(0.25)
	doc.Rect(qml, y, qcw, h, "FD")

	p.sans("", 6.8)
	p.setColor(cQInk3)
	doc.SetXY(qml+5.3, y+4.2)
	doc.CellFormat(70, 3.4, p.text("THANK  YOU"), "", 0, "L", false, 0, "")

	p.serif("I", 16.5)
	p.setColor(cQInk)
	doc.SetXY(qml+5.3, y+8.0)
	doc.CellFormat(90, 6.8, p.text("From all of us at HousExpert."), "", 0, "L", false, 0, "")

	p.sans("", 7.9)
	p.setColor(cQInk3)
	doc.SetXY(qml+5.3, y+15.1)
	doc.MultiCell(qcw-33, 4.2,
		p.text(fmt.Sprintf("For any clarification on scope, finishes or this quotation, reach us at %s or %s, %s. This quotation is valid for 30 days from the date of issue.", qContactEmail, qContactPhone1, qContactPhone2)),
		"", "L", false)

	p.drawBrandLogo(qml+qcw-21, y+5.0, 15.9)

	return y + h + 5
}

func (p *pdfWriter) drawQuotationClientSignatureCard(y float64, q *models.Quotation) float64 {
	doc := p.doc
	const (
		h          = quotationSignatureCardHeight
		titleH     = 10.4
		padX       = 5.3
		signatureW = 78.0
		dateW      = 38.0
	)

	p.setFill(cQPaper)
	p.setDraw(cQRule)
	doc.SetLineWidth(0.25)
	doc.Rect(qml, y, qcw, h, "FD")

	p.setFill(cQInk)
	doc.Rect(qml, y, qcw, titleH, "F")
	p.setFill(cQAmber)
	doc.Rect(qml, y, 1.05, titleH, "F")

	p.sans("B", 7.4)
	p.setColor(cQAmberSoft)
	doc.SetXY(qml+padX, y+3.3)
	doc.CellFormat(72, 3.8, p.text("CLIENT  ACCEPTANCE"), "", 0, "L", false, 0, "")

	p.mono("", 7.2)
	p.setColor(cQTagText)
	doc.SetXY(qml+qcw-58, y+3.35)
	doc.CellFormat(53, 3.8, p.text(q.QuotationID), "", 0, "R", false, 0, "")

	bodyY := y + titleH
	p.sans("", 8.3)
	p.setColor(cQInk2)
	doc.SetXY(qml+padX, bodyY+4.2)
	doc.MultiCell(qcw-padX*2, 4.4,
		p.text("I have reviewed the quotation, specifications, payment milestones, exclusions and conditions, and approve the proposal to proceed as agreed in writing."),
		"", "L", false)

	lineY := y + h - 11.6
	signX := qml + padX
	nameX := signX + signatureW + 9.0
	dateX := qml + qcw - padX - dateW

	p.setDraw(cQInk4)
	doc.SetLineWidth(0.35)
	doc.Line(signX, lineY, signX+signatureW, lineY)
	doc.Line(dateX, lineY, dateX+dateW, lineY)

	p.sans("", 6.8)
	p.setColor(cQInk3)
	doc.SetXY(signX, lineY+1.8)
	doc.CellFormat(signatureW, 3.4, p.text("Client signature"), "", 0, "L", false, 0, "")

	clientLabel := q.ClientName
	if strings.TrimSpace(clientLabel) == "" {
		clientLabel = "Client name"
	}
	p.setColor(cQInk4)
	doc.SetXY(nameX, lineY+1.8)
	doc.CellFormat(dateX-nameX-6, 3.4, p.text(p.truncate(clientLabel, 34)), "", 0, "L", false, 0, "")

	p.setColor(cQInk3)
	doc.SetXY(dateX, lineY+1.8)
	doc.CellFormat(dateW, 3.4, p.text("Date"), "", 0, "L", false, 0, "")

	return y + h + 5
}

// drawDashed strokes a horizontal dashed line. gofpdf has SetDashPattern but
// resetting it is fiddly; this is simpler and stays local to this file.
func drawDashed(doc interface {
	Line(x1, y1, x2, y2 float64)
}, x1, y, x2, y2, dash, gap float64) {
	_ = y2
	for x := x1; x < x2; x += dash + gap {
		end := x + dash
		if end > x2 {
			end = x2
		}
		doc.Line(x, y, end, y)
	}
}

// toRoman returns a small uppercase Roman numeral for 1..20.
func toRoman(n int) string {
	if n < 1 || n > 20 {
		return strings.ToUpper(fmt.Sprintf("%d", n))
	}
	rom := []string{"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
		"XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"}
	return rom[n-1]
}

func quotationSpecCountLabel(idx, count int) string {
	word := "entries"
	if idx == 1 {
		word = "items"
	}
	if idx == 2 {
		word = "stages"
	}
	if count == 1 {
		switch idx {
		case 1:
			word = "item"
		case 2:
			word = "stage"
		default:
			word = "entry"
		}
	}
	return fmt.Sprintf("%02d %s", count, word)
}
